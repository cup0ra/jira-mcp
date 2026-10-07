import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { JiraClient } from '../../jira/jira-client.js';
import type { Config } from '../../config/config.js';
import { issueKeySchema } from '../issues/write-schemas.js';
import { toolError } from '../../utils/errors.js';
export function registerTransitionIssue(
  server: McpServer,
  client: JiraClient,
  config: Config,
) {
  server.registerTool(
    'jira_transition_issue',
    {
      description:
        'WRITE: execute one workflow transition. Supply exactly one of transitionId or transitionName. Names match available transition names case-insensitively, not status names; ambiguous names require an ID. Does not fill transition-screen fields. Returns observed status when possible. Never retry blindly after timeout.',
      inputSchema: {
        issueKey: issueKeySchema,
        transitionId: z.string().trim().min(1).max(255).optional(),
        transitionName: z.string().trim().min(1).max(255).optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ issueKey, ...input }) => {
      try {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                await client.transitionIssue(issueKey, input),
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
