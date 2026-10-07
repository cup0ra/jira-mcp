import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../../config/config.js';
import type { AttachmentService } from '../../services/attachment.service.js';
import { toolError } from '../../utils/errors.js';
export function registerDownloadAttachment(
  server: McpServer,
  service: AttachmentService,
  config: Config,
) {
  server.registerTool(
    'jira_download_attachment',
    {
      description:
        'LOCAL WRITE: download a Jira attachment. Omit destinationPath to create a private temporary directory automatically; returns savedTo, mimeType, size and cleanupPath. Read savedTo with your local file/image tool; remove cleanupPath when finished. Each automatic download creates a new directory. Explicit destinations must be inside JIRA_MCP_ALLOWED_PATHS with an existing parent; overwrite must be true to replace a file. Rejects destination symlinks. Does not modify Jira.',
      inputSchema: {
        attachmentId: z.string().regex(/^[0-9]+$/),
        destinationPath: z.string().min(1).optional(),
        overwrite: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ attachmentId, destinationPath, overwrite }) => {
      try {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                await service.download(
                  attachmentId,
                  destinationPath,
                  overwrite,
                ),
              ),
            },
          ],
        };
      } catch (error) {
        return toolError(error, config.pat);
      }
    },
  );
}
