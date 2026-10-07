import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../../config/config.js';
import type { AttachmentService } from '../../services/attachment.service.js';
import { toolError } from '../../utils/errors.js';
export function registerCleanupAttachments(
  server: McpServer,
  service: AttachmentService,
  config: Config,
) {
  server.registerTool(
    'jira_cleanup_attachments',
    {
      description:
        'LOCAL DELETE: clean up automatic temporary downloads after reading them. Pass downloadIds returned by jira_download_attachment in this server process. Never accepts paths or deletes explicit destination files. Returns per-ID deleted, not_found (unknown/already cleaned/previous process), or failed. Inspect failed entries and retry if appropriate. Does not modify Jira.',
      inputSchema: { downloadIds: z.array(z.string().uuid()).min(1).max(100) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ downloadIds }) => {
      try {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await service.cleanup(downloadIds)),
            },
          ],
        };
      } catch (error) {
        return toolError(error, config.pat);
      }
    },
  );
}
