import { constants } from 'node:fs';
import {
  realpath,
  stat,
  lstat,
  open,
  link,
  rename,
  unlink,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
  join,
} from 'node:path';
import { randomUUID } from 'node:crypto';

export class FileAccessDeniedError extends Error {}
export class FileTooLargeError extends FileAccessDeniedError {}
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return (
    rel === '' ||
    (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  );
};
export class FileAccess {
  private roots?: Promise<string[]>;
  constructor(
    private readonly allowedPaths: string[],
    readonly maxBytes: number,
  ) {}
  private async allowed(path: string) {
    this.roots ??= Promise.all(
      this.allowedPaths.map(async (root) => {
        const canonical = await realpath(root);
        if (!(await stat(canonical)).isDirectory())
          throw new FileAccessDeniedError(
            'Allowed paths must be existing directories.',
          );
        return canonical;
      }),
    );
    if (!(await this.roots).some((root) => inside(root, path))) {
      throw new FileAccessDeniedError(
        'File access denied: path is outside JIRA_MCP_ALLOWED_PATHS.',
      );
    }
  }
  private absolute(path: string) {
    if (!path || path.includes('\0') || path.split(/[\\/]/).includes('..')) {
      throw new FileAccessDeniedError(
        'File access denied: empty paths, NUL bytes, and .. traversal are not allowed.',
      );
    }
    return resolve(path);
  }
  checkSize(size: number) {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.maxBytes)
      throw new FileTooLargeError(
        'File exceeds JIRA_MCP_MAX_FILE_SIZE_MB or has an invalid size.',
      );
  }
  private async guard<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (error instanceof FileAccessDeniedError) throw error;
      throw new FileAccessDeniedError(
        'File access failed: check that the file and allowed directories exist and permissions permit access.',
      );
    }
  }
  async read(path: string) {
    return this.guard(async () => {
      const canonical = await realpath(this.absolute(path));
      await this.allowed(canonical);
      const initial = await stat(canonical);
      if (!initial.isFile())
        throw new FileAccessDeniedError(
          'Upload source must be a regular file.',
        );
      this.checkSize(initial.size);
      const handle = await open(
        canonical,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          opened.dev !== initial.dev ||
          opened.ino !== initial.ino
        )
          throw new FileAccessDeniedError(
            'Upload source changed during validation.',
          );
        await this.allowed(await realpath(canonical));
        this.checkSize(opened.size);
        const chunks: Buffer[] = [];
        let size = 0;
        for (;;) {
          const buffer = Buffer.alloc(
            Math.min(65536, this.maxBytes - size + 1),
          );
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.length,
            null,
          );
          if (!bytesRead) break;
          size += bytesRead;
          this.checkSize(size);
          chunks.push(buffer.subarray(0, bytesRead));
        }
        return { filename: basename(path), data: Buffer.concat(chunks, size) };
      } finally {
        await handle.close();
      }
    });
  }
  async destination(path: string, overwrite: boolean) {
    return this.guard(async () => {
      const absolute = this.absolute(path);
      const parent = await realpath(dirname(absolute));
      await this.allowed(parent);
      const target = join(parent, basename(absolute));
      await this.allowed(target);
      try {
        const existing = await lstat(target);
        if (!existing.isFile() || existing.isSymbolicLink())
          throw new FileAccessDeniedError(
            'Destination must not be a symlink or special file.',
          );
        if (!overwrite)
          throw new FileAccessDeniedError(
            'Destination already exists. Set overwrite: true to replace it.',
          );
      } catch (error) {
        if (!missing(error)) throw error;
      }
      return target;
    });
  }
  async write(path: string, data: Uint8Array, overwrite: boolean) {
    return this.guard(async () => {
      this.checkSize(data.byteLength);
      const target = await this.destination(path, overwrite);
      const parent = dirname(target);
      const before = await stat(parent);
      const temporary = join(parent, `.jira-mcp-${randomUUID()}.tmp`);
      const handle = await open(
        temporary,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await handle.writeFile(data);
        await handle.sync();
        await handle.close();
        const checked = await this.destination(path, overwrite);
        const after = await stat(parent);
        if (
          checked !== target ||
          before.dev !== after.dev ||
          before.ino !== after.ino
        )
          throw new FileAccessDeniedError(
            'Destination directory changed during download.',
          );
        if (overwrite) await rename(temporary, target);
        else await link(temporary, target); // Atomic no-clobber commit, including concurrent creation.
        return target;
      } finally {
        await handle.close();
        await unlink(temporary).catch((error: unknown) => {
          if (!missing(error)) throw error;
        });
      }
    });
  }
}
