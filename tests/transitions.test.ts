import { it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config/config.js';
import { JiraClient } from '../src/jira/jira-client.js';
import { createServer } from '../src/server.js';
const config = loadConfig({
  JIRA_BASE_URL: 'https://jira.example.com/jira',
  JIRA_PAT: 'secret',
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
it('lists compact transitions including an empty list', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      json({
        transitions: [
          { id: '31', name: 'Start', to: { name: 'In Progress' }, extra: true },
        ],
      }),
    )
    .mockResolvedValueOnce(json({ transitions: [] }));
  const jira = new JiraClient(config, { fetch: fetcher });
  expect(await jira.getTransitions('ABC-1')).toEqual([
    { id: '31', name: 'Start' },
  ]);
  expect(fetcher.mock.calls[0]![0]).toBe(
    'https://jira.example.com/jira/rest/api/2/issue/ABC-1/transitions',
  );
  expect(await jira.getTransitions('ABC-1')).toEqual([]);
});
it('resolves names case-insensitively and reads the actual resulting status', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      json({ transitions: [{ id: '31', name: 'Start Work' }] }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(
      json({ fields: { status: { name: 'In Progress' } } }),
    );
  const result = await new JiraClient(config, {
    fetch: fetcher,
  }).transitionIssue('ABC-1', { transitionName: ' START work ' });
  expect(result).toEqual({
    key: 'ABC-1',
    transitioned: true,
    transitionId: '31',
    status: 'In Progress',
  });
  expect(fetcher.mock.calls[1]![1].method).toBe('POST');
  expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({
    transition: { id: '31' },
  });
  expect(fetcher.mock.calls[2]![0]).toContain('?fields=status');
});
it.each([
  {},
  { transitionId: '31', transitionName: 'Start' },
  { transitionId: '' },
  { transitionName: ' ' },
])('rejects invalid selectors before HTTP: %j', async (input) => {
  const fetcher = vi.fn();
  await expect(
    new JiraClient(config, { fetch: fetcher }).transitionIssue('ABC-1', input),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  [[], 'No available transition'],
  [
    [
      { id: '31', name: 'Start' },
      { id: '32', name: 'START' },
    ],
    'Multiple available transitions',
  ],
])(
  'does not write for missing or ambiguous names',
  async (transitions, message) => {
    const fetcher = vi.fn().mockResolvedValue(json({ transitions }));
    await expect(
      new JiraClient(config, { fetch: fetcher }).transitionIssue('ABC-1', {
        transitionName: 'Start',
      }),
    ).rejects.toThrow(message as string);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it('preserves success when the follow-up status read fails', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(json({}, 403));
  const result = await new JiraClient(config, {
    fetch: fetcher,
  }).transitionIssue('ABC-1', { transitionId: '31' });
  expect(result.transitioned).toBe(true);
  expect(result.status).toBeNull();
  expect(result).toHaveProperty('warning');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it.each([400, 409, 429, 503])(
  'does not retry failed transition or fetch status after HTTP %i',
  async (status) => {
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(json({ errors: { resolution: 'Required' } }, status)),
      );
    await expect(
      new JiraClient(config, { fetch: fetcher }).transitionIssue('ABC-1', {
        transitionId: '31',
      }),
    ).rejects.toThrow('resolution: Required');
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it('registers transition tools, validates MCP inputs, and returns results', async () => {
  const fetcher = vi.fn();
  const server = createServer(
    config,
    new JiraClient(config, { fetch: fetcher }),
  );
  const client = new Client({ name: 'transitions-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const tools = (await client.listTools()).tools;
    expect(
      tools.find((t) => t.name === 'jira_get_transitions')?.annotations
        ?.readOnlyHint,
    ).toBe(true);
    expect(
      tools.find((t) => t.name === 'jira_transition_issue')?.annotations
        ?.idempotentHint,
    ).toBe(false);
    expect(
      (
        await client.callTool({
          name: 'jira_transition_issue',
          arguments: { issueKey: 'ABC-1' },
        })
      ).isError,
    ).toBe(true);
    expect(
      (
        await client.callTool({
          name: 'jira_transition_issue',
          arguments: {
            issueKey: 'ABC-1',
            transitionId: '31',
            transitionName: 'Start',
          },
        })
      ).isError,
    ).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValueOnce(
      json({ transitions: [{ id: '31', name: 'Start' }] }),
    );
    const list = await client.callTool({
      name: 'jira_get_transitions',
      arguments: { issueKey: 'ABC-1' },
    });
    expect(list.content).toEqual([
      { type: 'text', text: '[{"id":"31","name":"Start"}]' },
    ]);
    fetcher
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        json({ fields: { status: { name: 'In Progress' } } }),
      );
    const result = await client.callTool({
      name: 'jira_transition_issue',
      arguments: { issueKey: 'ABC-1', transitionId: '31' },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain('In Progress');
  } finally {
    await client.close();
    await server.close();
  }
});
