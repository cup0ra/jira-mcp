import { it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config/config.js';
import { editableFields } from '../src/tools/issues/write-schemas.js';
it('accepts nested JSON custom values and rejects non-JSON values', () => {
  const values = {
    customfield_1: 5,
    customfield_2: null,
    customfield_3: [{ value: 'Option', child: { value: 'Child' } }],
    customfield_4: false,
  };
  expect(editableFields.customFields.parse(values)).toEqual(values);
  for (const value of [undefined, Infinity, NaN, () => 1, new Date()]) {
    expect(
      editableFields.customFields.safeParse({ customfield_1: value }).success,
    ).toBe(false);
  }
});
it('publishes typed JSON alternatives instead of empty custom field schemas', async () => {
  const server = createServer(
    loadConfig({ JIRA_BASE_URL: 'https://jira.example.com', JIRA_PAT: 'test' }),
  );
  const client = new Client({ name: 'schema-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const tools = (await client.listTools()).tools;
    for (const name of ['jira_create_issue', 'jira_update_issue']) {
      const schema = tools.find((tool) => tool.name === name)!.inputSchema;
      const custom = schema.properties!.customFields as {
        additionalProperties: { anyOf: { type: string }[] };
      };
      expect(
        custom.additionalProperties.anyOf.map((branch) => branch.type),
      ).toEqual(['string', 'number', 'boolean', 'null', 'array', 'object']);
      expect(JSON.stringify(custom)).not.toContain('"additionalProperties":{}');
      expect(JSON.stringify(custom)).not.toContain('"items":{}');
    }
  } finally {
    await client.close();
    await server.close();
  }
});
