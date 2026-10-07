import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  rm,
  readdir,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAccess } from '../src/security/file-access.js';
import { JiraClient } from '../src/jira/jira-client.js';
import { AttachmentService } from '../src/services/attachment.service.js';
let root: string;
let allowed: string;
let outside: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'jira-files-')));
  allowed = join(root, 'allowed');
  outside = join(root, 'allowed-other');
  await mkdir(allowed);
  await mkdir(outside);
  await writeFile(join(allowed, 'a.txt'), 'hello');
  await writeFile(join(outside, 'secret'), 'private');
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const config = { baseUrl: 'https://jira.example.com/jira', pat: 'secret' };
it('allows regular files, in-root symlinks and canonical allowlist aliases', async () => {
  await symlink(join(allowed, 'a.txt'), join(allowed, 'alias'));
  await symlink(allowed, join(root, 'root-alias'));
  const files = new FileAccess([join(root, 'root-alias')], 5);
  expect((await files.read(join(allowed, 'alias'))).data.toString()).toBe(
    'hello',
  );
});
it('denies outside paths, sibling prefixes, traversal, missing files, directories and empty allowlists', async () => {
  const files = new FileAccess([allowed], 20);
  for (const path of [
    join(outside, 'secret'),
    `${allowed}/../allowed/a.txt`,
    join(allowed, 'missing'),
    allowed,
  ]) {
    await expect(files.read(path)).rejects.toThrow();
  }
  await expect(
    new FileAccess([], 20).read(join(allowed, 'a.txt')),
  ).rejects.toThrow('outside');
});
it('rejects source and destination symlink escapes, including dangling targets', async () => {
  await symlink(outside, join(allowed, 'escape'));
  await symlink(join(outside, 'secret'), join(allowed, 'file-link'));
  await symlink(join(outside, 'missing'), join(allowed, 'dangling'));
  const files = new FileAccess([allowed], 20);
  await expect(files.read(join(allowed, 'file-link'))).rejects.toThrow(
    'outside',
  );
  await expect(files.read(join(allowed, 'escape/secret'))).rejects.toThrow(
    'outside',
  );
  for (const path of ['file-link', 'dangling', 'escape/new']) {
    await expect(
      files.write(join(allowed, path), new Uint8Array([1]), true),
    ).rejects.toThrow();
  }
  expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('private');
});
it('enforces file size for uploads and downloads', async () => {
  const files = new FileAccess([allowed], 4);
  await expect(files.read(join(allowed, 'a.txt'))).rejects.toThrow('exceeds');
  await expect(
    files.write(join(allowed, 'new'), new Uint8Array(5), false),
  ).rejects.toThrow('exceeds');
});
it('writes atomically without clobbering unless explicitly requested', async () => {
  const files = new FileAccess([allowed], 20);
  const target = join(allowed, 'a.txt');
  await expect(files.write(target, Buffer.from('new'), false)).rejects.toThrow(
    'already exists',
  );
  expect(await readFile(target, 'utf8')).toBe('hello');
  await files.write(target, Buffer.from('new'), true);
  expect(await readFile(target, 'utf8')).toBe('new');
  const results = await Promise.allSettled([
    files.write(join(allowed, 'race'), Buffer.from('one'), false),
    files.write(join(allowed, 'race'), Buffer.from('two'), false),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await readdir(allowed)).some((p) => p.endsWith('.tmp'))).toBe(false);
});
it('uploads multipart files in one request with no manual boundary and compact metadata', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    json([
      {
        id: '1',
        filename: 'a.txt',
        size: 5,
        content: 'private',
        author: { displayName: 'Jane', emailAddress: 'private' },
      },
    ]),
  );
  const service = new AttachmentService(
    new JiraClient(config, { fetch: fetcher }),
    { allowedPaths: [allowed], maxFileSizeBytes: 20 },
  );
  const result = await service.upload('ABC-1', [
    join(allowed, 'a.txt'),
    join(allowed, 'a.txt'),
  ]);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toContain('/issue/ABC-1/attachments');
  expect(init.headers.get('X-Atlassian-Token')).toBe('no-check');
  expect(init.headers.has('Content-Type')).toBe(false);
  expect(init.headers.get('Authorization')).toBe('Bearer secret');
  const files = (init.body as FormData).getAll('file') as File[];
  expect(files).toHaveLength(2);
  expect(files[0]!.name).toBe('a.txt');
  expect(await files[0]!.text()).toBe('hello');
  expect(result[0]).not.toHaveProperty('content');
  expect(JSON.stringify(result)).not.toContain('private');
});
it('validates every upload and aggregate size before contacting Jira', async () => {
  const fetcher = vi.fn();
  const service = new AttachmentService(
    new JiraClient(config, { fetch: fetcher }),
    { allowedPaths: [allowed], maxFileSizeBytes: 6 },
  );
  await expect(
    service.upload('ABC-1', [join(allowed, 'a.txt'), join(outside, 'secret')]),
  ).rejects.toThrow();
  await expect(
    service.upload('ABC-1', [join(allowed, 'a.txt'), join(allowed, 'a.txt')]),
  ).rejects.toThrow('exceeds');
  expect(fetcher).not.toHaveBeenCalled();
});
it('downloads via metadata content URL to an explicit destination', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      json({
        id: '1',
        filename: '../../remote.txt',
        size: 5,
        content: 'https://jira.example.com/jira/secure/attachment/1/a.txt',
      }),
    )
    .mockResolvedValueOnce(new Response('hello'));
  const service = new AttachmentService(
    new JiraClient(config, { fetch: fetcher }),
    { allowedPaths: [allowed], maxFileSizeBytes: 20 },
  );
  const target = join(allowed, 'download.txt');
  expect(await service.download('1', target)).toMatchObject({
    attachmentId: '1',
    savedTo: target,
    size: 5,
  });
  expect(await readFile(target, 'utf8')).toBe('hello');
  expect(fetcher.mock.calls[1]![1].redirect).toBe('error');
  expect(fetcher.mock.calls[1]![1].headers.get('Accept')).toBe(
    'application/octet-stream',
  );
});
it('blocks unsafe destinations before contacting Jira', async () => {
  const fetcher = vi.fn();
  const service = new AttachmentService(
    new JiraClient(config, { fetch: fetcher }),
    { allowedPaths: [allowed], maxFileSizeBytes: 20 },
  );
  await expect(service.download('1', join(outside, 'new'))).rejects.toThrow();
  await expect(service.download('1', join(allowed, 'a.txt'))).rejects.toThrow(
    'already exists',
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  'https://evil.example/file',
  'http://jira.example.com/jira/file',
  'https://jira.example.com/other/file',
  'https://user:password@jira.example.com/jira/file',
])('rejects unsafe content URL %s without sending PAT', async (url) => {
  const fetcher = vi.fn();
  await expect(
    new JiraClient(config, { fetch: fetcher }).downloadAttachment(url, 20),
  ).rejects.toThrow('origin');
  expect(fetcher).not.toHaveBeenCalled();
});
it('enforces actual streamed download size even without content-length', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('too large'));
  await expect(
    new JiraClient(config, { fetch: fetcher }).downloadAttachment(
      'https://jira.example.com/jira/file',
      3,
    ),
  ).rejects.toThrow('exceeds');
});
it('does not retry upload on temporary errors', async () => {
  const fetcher = vi.fn().mockResolvedValue(json({}, 503));
  await expect(
    new JiraClient(config, { fetch: fetcher }).uploadAttachment('ABC-1', [
      { filename: 'a', data: new Uint8Array([1]) },
    ]),
  ).rejects.toThrow('503');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('leaves existing destination untouched when a download fails or exceeds the limit', async () => {
  for (const content of [
    () => json({}, 403),
    () => new Response('a payload larger than the limit'),
  ]) {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          id: '1',
          filename: 'remote.txt',
          size: 3,
          content: 'https://jira.example.com/jira/file',
        }),
      )
      .mockResolvedValueOnce(content());
    const service = new AttachmentService(
      new JiraClient(config, { fetch: fetcher }),
      { allowedPaths: [allowed], maxFileSizeBytes: 10 },
    );
    await expect(
      service.download('1', join(allowed, 'a.txt'), true),
    ).rejects.toThrow();
    expect(await readFile(join(allowed, 'a.txt'), 'utf8')).toBe('hello');
    expect(await readdir(allowed)).toEqual(['a.txt']);
  }
});
it('rejects oversized content-length before reading the body', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response('abc', { headers: { 'Content-Length': '9999' } }),
    );
  await expect(
    new JiraClient(config, { fetch: fetcher }).downloadAttachment(
      'https://jira.example.com/jira/file',
      10,
    ),
  ).rejects.toThrow('exceeds');
});
it('lists metadata without allowing internal download URLs or emails into output', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    json({
      key: 'ABC-1',
      fields: {
        attachment: [
          {
            id: '1',
            filename: 'a.txt',
            size: 5,
            mimeType: 'text/plain',
            content: 'private',
            author: { displayName: 'Jane', emailAddress: 'private' },
          },
        ],
      },
    }),
  );
  const service = new AttachmentService(
    new JiraClient(config, { fetch: fetcher }),
    { allowedPaths: [], maxFileSizeBytes: 20 },
  );
  expect(await service.list('ABC-1')).toEqual([
    {
      id: '1',
      filename: 'a.txt',
      size: 5,
      mimeType: 'text/plain',
      author: 'Jane',
      created: undefined,
    },
  ]);
  expect(fetcher.mock.calls[0]![0]).toContain('?fields=attachment');
});
it('automatically downloads into a private unique directory without broadening the allowlist', async () => {
  const fetcher = vi.fn().mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('/rest/api/2/attachment/')
        ? json({
            id: '1',
            filename: '../../screenshot.PNG',
            mimeType: 'image/png',
            size: 5,
            content: 'https://jira.example.com/jira/file',
          })
        : new Response('hello'),
    ),
  );
  const service = new AttachmentService(
    new JiraClient(config, { fetch: fetcher }),
    { allowedPaths: [], maxFileSizeBytes: 20 },
  );
  const results: Awaited<ReturnType<typeof service.download>>[] = [];
  try {
    results.push(await service.download('1'));
    results.push(await service.download('1'));
    const first = results[0]!;
    expect(first.cleanupPath).toBeTruthy();
    expect(first.savedTo).toBe(join(first.cleanupPath!, '1.png'));
    expect(first.mimeType).toBe('image/png');
    expect(await readFile(first.savedTo, 'utf8')).toBe('hello');
    const { stat } = await import('node:fs/promises');
    expect((await stat(first.cleanupPath!)).mode & 0o777).toBe(0o700);
    expect((await stat(first.savedTo)).mode & 0o777).toBe(0o600);
    expect(results[1]!.cleanupPath).not.toBe(first.cleanupPath);
    await expect(service.download('1', first.savedTo, true)).rejects.toThrow(
      'outside',
    );
    await expect(service.upload('ABC-1', [first.savedTo])).rejects.toThrow(
      'outside',
    );
  } finally {
    for (const result of results)
      if (result.cleanupPath)
        await rm(result.cleanupPath, { recursive: true, force: true });
  }
});
it('uses a safe fallback extension and rejects path-like attachment IDs', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      json({
        id: '1',
        filename: '../../file',
        size: 0,
        content: 'https://jira.example.com/jira/file',
      }),
    )
    .mockResolvedValueOnce(new Response(''));
  const service = new AttachmentService(
    new JiraClient(config, { fetch: fetcher }),
    { allowedPaths: [], maxFileSizeBytes: 20 },
  );
  await expect(service.download('../1')).rejects.toThrow('numeric');
  expect(fetcher).not.toHaveBeenCalled();
  const result = await service.download('1');
  try {
    expect(result.savedTo).toBe(join(result.cleanupPath!, '1.bin'));
  } finally {
    await rm(result.cleanupPath!, { recursive: true, force: true });
  }
});
