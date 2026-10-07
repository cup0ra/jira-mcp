import { issueKeySchema } from '../issues/write-schemas.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../../config/config.js';
import type { AttachmentService } from '../../services/attachment.service.js';
import { toolError } from '../../utils/errors.js';
export function registerListAttachments(
  server: McpServer,
  service: AttachmentService,
  config: Config,
) {
  server.registerTool(
    'jira_list_attachments',
    {
      description:
        'Read-only: list compact attachment metadata for a Jira issue; does not access local files.',
      inputSchema: { issueKey: issueKeySchema },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ issueKey }) => {
      try {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(await service.list(issueKey)),
            },
          ],
        };
      } catch (error) {
        return toolError(error, config.pat);
      }
    },
  );
}
