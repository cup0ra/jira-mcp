import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JiraClient } from '../../jira/jira-client.js';
import type { Config } from '../../config/config.js';
import { normalizeIssueDetail } from '../../jira/jira-normalizer.js';
import { toolError } from '../../utils/errors.js';
export function registerGetIssue(
  server: McpServer,
  client: JiraClient,
  config: Config,
) {
  server.registerTool(
    'jira_get_issue',
    {
      description:
        'Read-only: get a Jira issue by key, including description, comments, issue links (with relationships relative to this issue), and attachment metadata. Includes nonempty custom fields with IDs, names and original values (including acceptance criteria where available). Comments may be partial: use jira_get_comments from startAt=0 and follow nextStartAt to read the full discussion. Set includeCustomFields=false for compact output. Does not read or download attachment contents.',
      inputSchema: {
        includeCustomFields: z.boolean().default(true),
        issueKey: z
          .string()
          .regex(/^[A-Za-z][A-Za-z0-9_]*-[1-9][0-9]*$/)
          .max(255),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ issueKey, includeCustomFields }) => {
      try {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                normalizeIssueDetail(
                  await client.getIssue(issueKey, includeCustomFields),
                  config.baseUrl,
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
