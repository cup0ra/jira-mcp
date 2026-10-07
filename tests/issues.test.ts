import { it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config/config.js';
import { JiraClient } from '../src/jira/jira-client.js';
import {
  normalizeIssue,
  normalizeIssueDetail,
} from '../src/jira/jira-normalizer.js';
import { createServer } from '../src/server.js';
const config = loadConfig({
  JIRA_BASE_URL: 'https://jira.example.com/jira',
  JIRA_PAT: 'test-secret',
});
const issue = {
  key: 'ABC-1',
  fields: {
    summary: 'Example',
    status: { name: 'Open' },
    assignee: null,
    comment: { comments: [{ id: '1', body: 'Hello' }], total: 10 },
    attachment: [
      { id: '2', filename: 'a.png', size: 100, mimeType: 'image/png' },
    ],
  },
};
it('normalizes missing fields without internal metadata', () => {
  expect(normalizeIssue(issue, config.baseUrl)).toMatchObject({
    key: 'ABC-1',
    summary: 'Example',
    assignee: null,
    url: 'https://jira.example.com/jira/browse/ABC-1',
  });
  const detail = normalizeIssueDetail(issue, config.baseUrl);
  expect(detail.commentsPagination).toEqual({
    startAt: 0,
    returned: 1,
    total: 10,
    hasMore: true,
    nextStartAt: 1,
  });
  expect(detail.attachments[0]).toMatchObject({ id: '2', filename: 'a.png' });
  expect(detail).not.toHaveProperty('self');
  expect(detail.issueLinks).toEqual([]);
});
it('sends POST JQL with defaults and requests explicit issue fields', async () => {
  const fetcher = vi
    .fn()
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(issue))),
    );
  const jira = new JiraClient(config, { fetch: fetcher });
  await jira.searchIssues({ jql: 'assignee = currentUser()' });
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toMatchObject({
    maxResults: 25,
    startAt: 0,
    jql: 'assignee = currentUser()',
  });
  await jira.getIssue('ABC-1');
  expect(fetcher.mock.calls[1]![0]).toContain('/issue/ABC-1?fields=');
  expect(
    new URL(fetcher.mock.calls[1]![0]).searchParams.get('fields')?.split(','),
  ).toContain('*all');
});
it('exposes validated read-only tools and sanitized MCP errors', async () => {
  const fetcher = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          startAt: 0,
          maxResults: 25,
          total: 1,
          issues: [issue],
        }),
      ),
    ),
  );
  const server = createServer(
    config,
    new JiraClient(config, { fetch: fetcher }),
  );
  const client = new Client({ name: 'test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual([
      'jira_search_issues',
      'jira_get_issue',
      'jira_create_issue',
      'jira_update_issue',
      'jira_add_comment',
      'jira_get_transitions',
      'jira_transition_issue',
      'jira_list_attachments',
      'jira_upload_attachment',
      'jira_download_attachment',
      'jira_get_current_user',
      'jira_get_comments',
    ]);
    expect(
      tools.tools
        .filter((t) =>
          ['jira_search_issues', 'jira_get_issue'].includes(t.name),
        )
        .every((t) => t.annotations?.readOnlyHint),
    ).toBe(true);
    const result = await client.callTool({
      name: 'jira_search_issues',
      arguments: { jql: 'project = ABC' },
    });
    expect(JSON.stringify(result)).toContain('ABC-1');
    const invalid = await client.callTool({
      name: 'jira_search_issues',
      arguments: { jql: 'x', maxResults: 101 },
    });
    expect(invalid.isError).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(issue))),
    );
    expect(
      JSON.stringify(
        await client.callTool({
          name: 'jira_get_issue',
          arguments: { issueKey: 'ABC-1' },
        }),
      ),
    ).toContain('a.png');
    fetcher.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ errorMessages: ['test-secret'] }), {
          status: 401,
        }),
      ),
    );
    const failed = await client.callTool({
      name: 'jira_get_issue',
      arguments: { issueKey: 'ABC-1' },
    });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).not.toContain('test-secret');
  } finally {
    await client.close();
    await server.close();
  }
});

it('preserves relationship direction and handles sparse linked issues', () => {
  const type = { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' };
  const result = normalizeIssueDetail(
    {
      key: 'ABC-1',
      fields: {
        issuelinks: [
          {
            id: '10',
            type,
            outwardIssue: {
              key: 'ABC-2',
              fields: {
                summary: 'Downstream',
                status: { name: 'Open' },
                issuetype: { name: 'Bug' },
              },
            },
          },
          { id: '11', type, inwardIssue: { key: 'ABC-3' } },
          { id: '12', type },
        ],
      },
    },
    config.baseUrl,
  );
  expect(result.issueLinks).toEqual([
    {
      id: '10',
      type: 'Blocks',
      direction: 'outward',
      relationship: 'blocks',
      key: 'ABC-2',
      summary: 'Downstream',
      status: 'Open',
      issueType: 'Bug',
      url: 'https://jira.example.com/jira/browse/ABC-2',
    },
    {
      id: '11',
      type: 'Blocks',
      direction: 'inward',
      relationship: 'is blocked by',
      key: 'ABC-3',
      summary: null,
      status: null,
      issueType: null,
      url: 'https://jira.example.com/jira/browse/ABC-3',
    },
  ]);
});
