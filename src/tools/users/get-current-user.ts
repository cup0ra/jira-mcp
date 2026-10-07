import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../../config/config.js';
import type { JiraClient } from '../../jira/jira-client.js';
import { toolError } from '../../utils/errors.js';
export function registerGetCurrentUser(
  server: McpServer,
  client: JiraClient,
  config: Config,
) {
  server.registerTool(
    'jira_get_current_user',
    {
      description:
        'Read-only: get the authenticated Jira Server/Data Center user for the configured PAT. Takes no arguments. Returns name (username for assignee), displayName, active, and timeZone. Use to check authentication or assign an issue to yourself. Does not return email or internal metadata.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      try {
        const user = await client.getCurrentUser();
        const result = {
          name: user.name ?? null,
          displayName: user.displayName ?? null,
          active: user.active ?? null,
          timeZone: user.timeZone ?? null,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (error) {
        return toolError(error, config.pat);
      }
    },
  );
}
