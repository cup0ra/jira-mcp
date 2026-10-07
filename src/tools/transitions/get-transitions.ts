import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JiraClient } from '../../jira/jira-client.js';
import type { Config } from '../../config/config.js';
import { issueKeySchema } from '../issues/write-schemas.js';
import { toolError } from '../../utils/errors.js';
export function registerGetTransitions(
  server: McpServer,
  client: JiraClient,
  config: Config,
) {
  server.registerTool(
    'jira_get_transitions',
    {
      description:
        'Read-only: list currently available workflow transitions for a Jira issue as IDs and names. Transition names may differ from destination status names. An empty list means no transitions are available to the current user.',
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
              text: JSON.stringify(await client.getTransitions(issueKey)),
            },
          ],
        };
      } catch (error) {
        return toolError(error, config.pat);
      }
    },
  );
}
