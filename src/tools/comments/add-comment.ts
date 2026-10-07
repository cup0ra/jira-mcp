import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../../config/config.js';
import type { JiraClient } from '../../jira/jira-client.js';
import { toolError } from '../../utils/errors.js';
import { issueKeySchema } from '../issues/write-schemas.js';
export function registerAddComment(
  server: McpServer,
  client: JiraClient,
  config: Config,
) {
  server.registerTool(
    'jira_add_comment',
    {
      description:
        'WRITE: add a comment to a Jira issue using text/wiki markup. No additional visibility restriction is applied; users with access to the issue can read it. Never retry blindly after a timeout because duplicate comments may result.',
      inputSchema: {
        issueKey: issueKeySchema,
        body: z
          .string()
          .refine(
            (value) => value.trim().length > 0,
            'Comment must not be blank',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ issueKey, body }) => {
      try {
        const comment = await client.addComment(issueKey, body);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                issueKey,
                id: comment.id,
                author:
                  comment.author?.displayName ?? comment.author?.name ?? null,
                created: comment.created ?? null,
                updated: comment.updated ?? null,
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
