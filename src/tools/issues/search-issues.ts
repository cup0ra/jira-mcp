import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JiraClient } from '../../jira/jira-client.js';
import type { Config } from '../../config/config.js';
import { normalizeIssue } from '../../jira/jira-normalizer.js';
import { toolError } from '../../utils/errors.js';
export function registerSearchIssues(
  server: McpServer,
  client: JiraClient,
  config: Config,
) {
  server.registerTool(
    'jira_search_issues',
    {
      description:
        'Read-only: search Jira Server/Data Center using JQL. Returns compact issue summaries and pagination. fields limits fields fetched; custom fields are not emitted in this version.',
      inputSchema: {
        jql: z.string().trim().min(1).max(20000),
        maxResults: z.number().int().min(1).max(100).optional(),
        startAt: z.number().int().min(0).optional(),
        fields: z.array(z.string().min(1).max(100)).max(50).optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const result = await client.searchIssues(input);
        const output = {
          startAt: result.startAt,
          maxResults: result.maxResults,
          total: result.total ?? null,
          issues: result.issues.map((issue) =>
            normalizeIssue(issue, config.baseUrl),
          ),
        };
        return { content: [{ type: 'text', text: JSON.stringify(output) }] };
      } catch (error) {
        return toolError(error, config.pat);
      }
    },
  );
}
