import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../config/config.js';
import type {
  JiraAttachment,
  AttachmentUpload,
} from '../jira/jira-api.types.js';
import type { JiraClient } from '../jira/jira-client.js';
import { JiraValidationError } from '../jira/jira-error.js';
import { FileAccess, FileAccessDeniedError } from '../security/file-access.js';
export function attachmentMetadata(a: JiraAttachment) {
  return {
    id: a.id,
    filename: a.filename,
    size: a.size,
    mimeType: a.mimeType ?? 'application/octet-stream',
    author: a.author?.displayName ?? a.author?.name,
    created: a.created,
  };
}
export class AttachmentService {
  private readonly files: FileAccess;
  constructor(
    private readonly client: JiraClient,
    config: Pick<Config, 'allowedPaths' | 'maxFileSizeBytes'>,
  ) {
    this.files = new FileAccess(config.allowedPaths, config.maxFileSizeBytes);
  }
  async list(issueKey: string) {
    return (await this.client.listAttachments(issueKey)).map(
      attachmentMetadata,
    );
  }
  async upload(issueKey: string, filePaths: string[]) {
    if (!filePaths.length || filePaths.length > 10)
      throw new JiraValidationError('Provide 1–10 filePaths.');
    const files: AttachmentUpload[] = [];
    let total = 0;
    for (const path of filePaths) {
      const file = await this.files.read(path);
      total += file.data.byteLength;
      this.files.checkSize(total); // Bound multipart memory as well as individual files.
      files.push(file);
    }
    return (await this.client.uploadAttachment(issueKey, files)).map(
      attachmentMetadata,
    );
  }
  async download(
    attachmentId: string,
    destinationPath?: string,
    overwrite = false,
  ) {
    if (!/^[0-9]+$/.test(attachmentId))
      throw new JiraValidationError('Attachment ID must be numeric.');
    if (destinationPath !== undefined)
      await this.files.destination(destinationPath, overwrite);
    const attachment = await this.client.getAttachment(attachmentId);
    this.files.checkSize(attachment.size);
    if (!attachment.content)
      throw new JiraValidationError(
        'Jira did not provide an attachment content URL.',
      );
    const data = await this.client.downloadAttachment(
      attachment.content,
      this.files.maxBytes,
    );
    let savedTo: string;
    let cleanupPath: string | undefined;
    if (destinationPath !== undefined) {
      savedTo = await this.files.write(destinationPath, data, overwrite);
    } else {
      let created: string | undefined;
      try {
        created = await mkdtemp(join(tmpdir(), 'jira-mcp-attachments-'));
        cleanupPath = await realpath(created);
        // Jira's original filename is metadata only; use a numeric ID and safe extension.
        const extension =
          /\.([a-zA-Z0-9]{1,10})$/
            .exec(attachment.filename)?.[1]
            ?.toLowerCase() ?? 'bin';
        const target = join(cleanupPath, `${attachmentId}.${extension}`);
        const temporaryFiles = new FileAccess(
          [cleanupPath],
          this.files.maxBytes,
        );
        savedTo = await temporaryFiles.write(target, data, false);
      } catch (error) {
        if (created) await rm(created, { recursive: true, force: true });
        if (error instanceof FileAccessDeniedError) throw error;
        throw new FileAccessDeniedError(
          'Unable to save attachment in a private temporary directory. Check temporary directory permissions.',
        );
      }
    }
    return {
      attachmentId,
      filename: attachment.filename,
      savedTo,
      size: data.byteLength,
      mimeType: attachment.mimeType ?? 'application/octet-stream',
      ...(cleanupPath ? { cleanupPath } : {}),
    };
  }
}
