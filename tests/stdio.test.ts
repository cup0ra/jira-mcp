import { it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawnSync } from 'node:child_process';
it('starts the built entrypoint and lists tools over stdio', async () => {
  const client = new Client({ name: 'smoke-test', version: '1' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    env: { JIRA_BASE_URL: 'https://jira.example.com', JIRA_PAT: 'test-only' },
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools).toHaveLength(13);
  } finally {
    await client.close();
  }
});
it('exits cleanly with no stdout or secrets on invalid config', () => {
  const result = spawnSync(process.execPath, ['dist/index.js'], {
    env: { JIRA_PAT: 'do-not-leak' },
    encoding: 'utf8',
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Invalid configuration: JIRA_BASE_URL');
  expect(result.stderr).not.toContain('do-not-leak');
});
