import { it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config/config.js';
import { JiraClient } from '../src/jira/jira-client.js';
import {
  normalizeIssueDetail,
  commentPagination,
} from '../src/jira/jira-normalizer.js';
import { createServer } from '../src/server.js';
it('preserves requirements, duplicate field names and structured values without losing false/zero', () => {
  const issue = {
    key: 'ABC-1',
    names: {
      customfield_1: 'Acceptance Criteria',
      customfield_2: 'Acceptance Criteria',
    },
    fields: {
      customfield_1: 'First\nSecond',
      customfield_2: { value: 'Option' },
      customfield_3: 0,
      customfield_4: false,
      customfield_5: null,
      unknown: 'internal',
    },
  };
  expect(normalizeIssueDetail(issue, 'https://jira').customFields).toEqual([
    {
      id: 'customfield_1',
      name: 'Acceptance Criteria',
      value: 'First\nSecond',
    },
    {
      id: 'customfield_2',
      name: 'Acceptance Criteria',
      value: { value: 'Option' },
    },
    { id: 'customfield_3', name: 'customfield_3', value: 0 },
    { id: 'customfield_4', name: 'customfield_4', value: false },
  ]);
});
it('handles last, unknown-total and empty intermediate pages without looping', () => {
  expect(commentPagination(2, 1, 3)).toMatchObject({
    hasMore: false,
    nextStartAt: null,
  });
  expect(commentPagination(0, 2)).toMatchObject({
    hasMore: true,
    nextStartAt: 2,
  });
  expect(commentPagination(2, 0)).toMatchObject({
    hasMore: false,
    nextStartAt: null,
  });
  expect(commentPagination(2, 0, 5)).toMatchObject({
    hasMore: true,
    nextStartAt: null,
  });
});
it('reads named custom fields and all comment pages via MCP, validating page bounds', async () => {
  const config = loadConfig({
    JIRA_BASE_URL: 'https://jira.example.com',
    JIRA_PAT: 'secret',
  });
  const fetcher = vi.fn().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        key: 'ABC-1',
        names: { customfield_1: 'Acceptance Criteria' },
        fields: { customfield_1: 'Must work' },
      }),
    ),
  );
  const jira = new JiraClient(config, { fetch: fetcher });
  const server = createServer(config, jira);
  const client = new Client({ name: 'requirements', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  const parse = (result: { content?: unknown }) =>
    JSON.parse((result.content as { text: string }[])[0]!.text);
  try {
    expect(
      parse(
        await client.callTool({
          name: 'jira_get_issue',
          arguments: { issueKey: 'ABC-1' },
        }),
      ).customFields[0].name,
    ).toBe('Acceptance Criteria');
    expect(fetcher.mock.calls[0]![0]).toContain('fields=*all&expand=names');
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ key: 'ABC-1', fields: {} })),
    );
    await client.callTool({
      name: 'jira_get_issue',
      arguments: { issueKey: 'ABC-1', includeCustomFields: false },
    });
    expect(fetcher.mock.calls[1]![0]).not.toContain('*all');
    for (const [startAt, comments] of [
      [
        0,
        [
          {
            id: '1',
            body: 'First',
            author: { displayName: 'A', emailAddress: 'private' },
          },
          { id: '2', body: 'Second' },
        ],
      ],
      [2, [{ id: '3', body: 'Last clarification' }]],
    ] as const) {
      fetcher.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ startAt, maxResults: 2, total: 3, comments }),
        ),
      );
      const page = parse(
        await client.callTool({
          name: 'jira_get_comments',
          arguments: { issueKey: 'ABC-1', startAt, maxResults: 2 },
        }),
      );
      expect(page.nextStartAt).toBe(startAt === 0 ? 2 : null);
      expect(page.comments.map((c: { body: string }) => c.body)).toEqual(
        comments.map((c) => c.body),
      );
      expect(JSON.stringify(page)).not.toContain('private');
      expect(fetcher.mock.lastCall![0]).toContain(
        `startAt=${startAt}&maxResults=2&orderBy=created`,
      );
    }
    const count = fetcher.mock.calls.length;
    expect(
      (
        await client.callTool({
          name: 'jira_get_comments',
          arguments: { issueKey: 'ABC-1', startAt: -1 },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: 'jira_get_comments',
          arguments: { issueKey: 'ABC-1', maxResults: 101 },
        })
      ).isError,
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(count);
  } finally {
    await client.close();
    await server.close();
  }
});
