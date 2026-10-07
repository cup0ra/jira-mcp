import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../../config/config.js';
import type { JiraClient } from '../../jira/jira-client.js';
import { toolError } from '../../utils/errors.js';
import { editableFields } from './write-schemas.js';
export function registerCreateIssue(
  server: McpServer,
  client: JiraClient,
  config: Config,
) {
  server.registerTool(
    'jira_create_issue',
    {
      description:
        'WRITE: create one Jira issue. Requires project key, exact issue type name, and summary. Optional assignee is a Server username. Custom fields use raw IDs. Jira validates required fields and create-screen permissions. Never retry blindly after a timeout.',
      inputSchema: {
        ...editableFields,
        projectKey: z
          .string()
          .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
          .max(255),
        issueType: z.string().trim().min(1).max(255),
        summary: z.string().trim().min(1).max(255),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const issue = await client.createIssue(input);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                key: issue.key,
                url: `${config.baseUrl}/browse/${encodeURIComponent(issue.key)}`,
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
