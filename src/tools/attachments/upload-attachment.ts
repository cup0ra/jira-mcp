import { z } from 'zod';
import { issueKeySchema } from '../issues/write-schemas.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../../config/config.js';
import type { AttachmentService } from '../../services/attachment.service.js';
import { toolError } from '../../utils/errors.js';
export function registerUploadAttachment(
  server: McpServer,
  service: AttachmentService,
  config: Config,
) {
  server.registerTool(
    'jira_upload_attachment',
    {
      description:
        'WRITE: upload 1–10 local files to a Jira issue. filePaths must resolve inside JIRA_MCP_ALLOWED_PATHS. Rejects .. traversal and symlink escapes. The configured size limit applies per file and to the total batch. Relative paths use server working directory. Do not retry blindly after failure.',
      inputSchema: {
        issueKey: issueKeySchema,
        filePaths: z.array(z.string().min(1)).min(1).max(10),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ issueKey, filePaths }) => {
      try {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await service.upload(issueKey, filePaths)),
            },
          ],
        };
      } catch (error) {
        return toolError(error, config.pat);
      }
    },
  );
}
