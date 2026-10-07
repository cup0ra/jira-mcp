import { it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config/config.js';
import { JiraClient } from '../src/jira/jira-client.js';
import { createServer } from '../src/server.js';
it('gets the PAT user through MCP, strips private metadata and sanitizes failures', async () => {
  const config = loadConfig({
    JIRA_BASE_URL: 'https://jira.example.com/jira',
    JIRA_PAT: 'secret-token',
  });
  const fetcher = vi.fn().mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        name: 'jsmith',
        displayName: 'John Smith',
        active: true,
        timeZone: 'Europe/Warsaw',
        emailAddress: 'private@example.com',
        self: 'internal',
        groups: { items: ['admins'] },
      }),
    ),
  );
  const server = createServer(
    config,
    new JiraClient(config, { fetch: fetcher }),
  );
  const client = new Client({ name: 'current-user-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const tool = (await client.listTools()).tools.find(
      (t) => t.name === 'jira_get_current_user',
    );
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.inputSchema.properties).toEqual({});
    const result = await client.callTool({
      name: 'jira_get_current_user',
      arguments: {},
    });
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          name: 'jsmith',
          displayName: 'John Smith',
          active: true,
          timeZone: 'Europe/Warsaw',
        }),
      },
    ]);
    expect(fetcher.mock.calls[0]![0]).toBe(
      'https://jira.example.com/jira/rest/api/2/myself',
    );
    expect(fetcher.mock.calls[0]![1].headers.get('Authorization')).toBe(
      'Bearer secret-token',
    );
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'inactive', active: false })),
    );
    expect(
      (await client.callTool({ name: 'jira_get_current_user' })).content,
    ).toEqual([
      {
        type: 'text',
        text: JSON.stringify({
          name: 'inactive',
          displayName: null,
          active: false,
          timeZone: null,
        }),
      },
    ]);
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ errorMessages: ['secret-token'] }), {
        status: 401,
      }),
    );
    const failed = await client.callTool({ name: 'jira_get_current_user' });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).toContain('401');
    expect(JSON.stringify(failed)).not.toContain('secret-token');
  } finally {
    await client.close();
    await server.close();
  }
});
