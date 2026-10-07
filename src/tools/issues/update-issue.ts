import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../../config/config.js';
import type { JiraClient } from '../../jira/jira-client.js';
import { toolError } from '../../utils/errors.js';
import { editableFields, issueKeySchema } from './write-schemas.js';
export function registerUpdateIssue(
  server: McpServer,
  client: JiraClient,
  config: Config,
) {
  server.registerTool(
    'jira_update_issue',
    {
      description:
        'WRITE: update supplied fields on an existing Jira issue. Omitted fields stay unchanged. Labels and components replace entire lists; [] clears them. Requires at least one field. Does not change workflow status. Assignee is a Server username; custom fields use raw IDs.',
      inputSchema: { issueKey: issueKeySchema, ...editableFields },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ issueKey, ...fields }) => {
      try {
        await client.updateIssue(issueKey, fields);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                key: issueKey,
                updated: true,
                url: `${config.baseUrl}/browse/${encodeURIComponent(issueKey)}`,
              }),
            },
          ],
        };
      } catch (error) {
        return toolError(error, config.pat);
      }
    },
  );
}
