import { it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config/config.js';
import { JiraClient } from '../src/jira/jira-client.js';
import { createServer } from '../src/server.js';
const config = loadConfig({
  JIRA_BASE_URL: 'https://jira.example.com/jira',
  JIRA_PAT: 'private-token',
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
it('maps all create fields to Jira Server payloads', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(json({ id: '1', key: 'ABC-1' }, 201));
  const jira = new JiraClient(config, { fetch: fetcher });
  await jira.createIssue({
    projectKey: 'ABC',
    issueType: 'Bug',
    summary: 'Example',
    description: 'Details',
    priority: 'High',
    assignee: 'jsmith',
    labels: ['frontend'],
    components: ['UI'],
    customFields: { customfield_12345: 5 },
  });
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe('https://jira.example.com/jira/rest/api/2/issue');
  expect(init.method).toBe('POST');
  expect(init.headers.get('Content-Type')).toBe('application/json');
  expect(JSON.parse(init.body)).toEqual({
    fields: {
      project: { key: 'ABC' },
      issuetype: { name: 'Bug' },
      summary: 'Example',
      description: 'Details',
      priority: { name: 'High' },
      assignee: { name: 'jsmith' },
      labels: ['frontend'],
      components: [{ name: 'UI' }],
      customfield_12345: 5,
    },
  });
});
it('updates only supplied fields, preserving explicit clears and 204 success', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 204 }));
  const jira = new JiraClient(config, { fetch: fetcher });
  await jira.updateIssue('ABC-1', {
    summary: undefined,
    description: '',
    labels: [],
    components: [],
    customFields: { customfield_12345: null },
  });
  expect(fetcher.mock.calls[0]![1].method).toBe('PUT');
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
    fields: {
      description: '',
      labels: [],
      components: [],
      customfield_12345: null,
    },
  });
  await expect(jira.updateIssue('ABC-1', { customFields: {} })).rejects.toThrow(
    'at least one field',
  );
  await expect(
    jira.updateIssue('ABC-1', { customFields: { summary: 'override' } }),
  ).rejects.toThrow('customFields keys');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('posts comments without altering text or adding visibility', async () => {
  const fetcher = vi.fn().mockResolvedValue(json({ id: '10' }, 201));
  await new JiraClient(config, { fetch: fetcher }).addComment(
    'ABC-1',
    '  Code\n{code}x{code}\n',
  );
  expect(fetcher.mock.calls[0]![0]).toContain('/issue/ABC-1/comment');
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({
    body: '  Code\n{code}x{code}\n',
  });
});
it.each([429, 503])('never retries any write on HTTP %i', async (status) => {
  const fetcher = vi
    .fn()
    .mockImplementation(() => Promise.resolve(json({}, status)));
  const jira = new JiraClient(config, { fetch: fetcher });
  await expect(
    jira.createIssue({ projectKey: 'ABC', issueType: 'Bug', summary: 'x' }),
  ).rejects.toThrow(`HTTP ${status}`);
  await expect(jira.updateIssue('ABC-1', { summary: 'x' })).rejects.toThrow(
    `HTTP ${status}`,
  );
  await expect(jira.addComment('ABC-1', 'x')).rejects.toThrow(`HTTP ${status}`);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it('explains uncertain write outcomes without exposing network errors', async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValue(new DOMException('private-token', 'TimeoutError'));
  await expect(
    new JiraClient(config, { fetch: fetcher }).addComment('ABC-1', 'x'),
  ).rejects.toThrow('Check the issue before retrying');
});
it('validates and executes all write tools over MCP with compact results and useful errors', async () => {
  const fetcher = vi.fn();
  const server = createServer(
    config,
    new JiraClient(config, { fetch: fetcher }),
  );
  const client = new Client({ name: 'write-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const tools = (await client.listTools()).tools.filter((t) =>
      ['jira_create_issue', 'jira_update_issue', 'jira_add_comment'].includes(
        t.name,
      ),
    );
    expect(tools).toHaveLength(3);
    expect(tools.every((t) => t.annotations?.readOnlyHint === false)).toBe(
      true,
    );
    for (const [name, args] of [
      [
        'jira_create_issue',
        { projectKey: 'ABC', issueType: 'Bug', summary: ' ' },
      ],
      ['jira_update_issue', { issueKey: 'ABC-1' }],
      [
        'jira_update_issue',
        { issueKey: 'ABC-1', customFields: { summary: 'override' } },
      ],
      ['jira_add_comment', { issueKey: '../secret', body: 'text' }],
      ['jira_add_comment', { issueKey: 'ABC-1', body: '  ' }],
    ] as const) {
      expect((await client.callTool({ name, arguments: args })).isError).toBe(
        true,
      );
    }
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(
      json({ id: '1', key: 'ABC-10', self: 'internal' }, 201),
    );
    const created = await client.callTool({
      name: 'jira_create_issue',
      arguments: { projectKey: 'ABC', issueType: 'Bug', summary: 'A bug' },
    });
    expect(created.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          key: 'ABC-10',
          url: 'https://jira.example.com/jira/browse/ABC-10',
        }),
      },
    ]);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(
      (
        await client.callTool({
          name: 'jira_update_issue',
          arguments: { issueKey: 'ABC-10', summary: 'New summary' },
        })
      ).isError,
    ).not.toBe(true);
    fetcher.mockResolvedValueOnce(
      json(
        {
          id: '20',
          body: 'text',
          author: { displayName: 'Jane', emailAddress: 'hidden' },
          created: 'today',
        },
        201,
      ),
    );
    const comment = await client.callTool({
      name: 'jira_add_comment',
      arguments: { issueKey: 'ABC-10', body: 'text' },
    });
    expect(comment.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          issueKey: 'ABC-10',
          id: '20',
          author: 'Jane',
          created: 'today',
          updated: null,
        }),
      },
    ]);
    fetcher.mockResolvedValueOnce(
      json(
        { errors: { fixVersions: 'Fix Version/s is required. private-token' } },
        400,
      ),
    );
    const failed = await client.callTool({
      name: 'jira_create_issue',
      arguments: { projectKey: 'ABC', issueType: 'Bug', summary: 'A bug' },
    });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).toContain('Fix Version/s is required');
    expect(JSON.stringify(failed)).not.toContain('private-token');
  } finally {
    await client.close();
    await server.close();
  }
});
