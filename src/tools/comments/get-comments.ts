import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../../config/config.js';
import type { JiraClient } from '../../jira/jira-client.js';
import {
  normalizeComment,
  commentPagination,
} from '../../jira/jira-normalizer.js';
import { issueKeySchema } from '../issues/write-schemas.js';
import { toolError } from '../../utils/errors.js';
export function registerGetComments(
  server: McpServer,
  client: JiraClient,
  config: Config,
) {
  server.registerTool(
    'jira_get_comments',
    {
      description:
        'Read-only: read one page of Jira issue comments in ascending creation order, including full bodies. To read the full discussion, start at 0 and repeat with nextStartAt until null. Only comments visible to the PAT user are returned. If hasMore is true but nextStartAt is null, Jira returned an empty intermediate page; refresh rather than assuming the discussion is complete.',
      inputSchema: {
        issueKey: issueKeySchema,
        startAt: z.number().int().min(0).default(0),
        maxResults: z.number().int().min(1).max(100).default(50),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ issueKey, startAt, maxResults }) => {
      try {
        const page = await client.getComments(issueKey, startAt, maxResults);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                issueKey,
                ...commentPagination(
                  page.startAt,
                  page.comments.length,
                  page.total,
                ),
                maxResults: page.maxResults,
                comments: page.comments.map(normalizeComment),
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
