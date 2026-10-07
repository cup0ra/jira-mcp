import { it, expect, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../src/config/config.js';
import { JiraClient } from '../src/jira/jira-client.js';
import { createServer } from '../src/server.js';
it('exposes attachment tools and returns useful file-policy errors over MCP', async () => {
  const config = loadConfig({
    JIRA_BASE_URL: 'https://jira.example.com',
    JIRA_PAT: 'secret',
  });
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ fields: { attachment: [] } })),
    );
  const server = createServer(
    config,
    new JiraClient(config, { fetch: fetcher }),
  );
  const client = new Client({ name: 'attachments', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  try {
    const tools = (await client.listTools()).tools;
    expect(
      tools.find((t) => t.name === 'jira_list_attachments')?.annotations
        ?.readOnlyHint,
    ).toBe(true);
    expect(
      tools.find((t) => t.name === 'jira_download_attachment')?.annotations
        ?.readOnlyHint,
    ).toBe(false);
    expect(
      tools.find((t) => t.name === 'jira_upload_attachment')?.annotations
        ?.idempotentHint,
    ).toBe(false);
    expect(
      (
        await client.callTool({
          name: 'jira_list_attachments',
          arguments: { issueKey: 'ABC-1' },
        })
      ).content,
    ).toEqual([{ type: 'text', text: '[]' }]);
    for (const [name, args] of [
      ['jira_upload_attachment', { issueKey: 'ABC-1', filePaths: [] }],
      [
        'jira_upload_attachment',
        { issueKey: 'ABC-1', filePaths: ['../secret'] },
      ],
      [
        'jira_download_attachment',
        { attachmentId: '1', destinationPath: '../secret' },
      ],
      [
        'jira_download_attachment',
        { attachmentId: '../1', destinationPath: 'file' },
      ],
    ] as const) {
      const result = await client.callTool({ name, arguments: args });
      expect(result.isError).toBe(true);
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    await client.close();
    await server.close();
  }
});
it('downloads through MCP with only attachmentId', async () => {
  const config = loadConfig({
    JIRA_BASE_URL: 'https://jira.example.com',
    JIRA_PAT: 'secret',
  });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: '42',
          filename: 'log.txt',
          size: 3,
          mimeType: 'text/plain',
          content: 'https://jira.example.com/file',
        }),
      ),
    )
    .mockResolvedValueOnce(new Response('log'));
  const server = createServer(
    config,
    new JiraClient(config, { fetch: fetcher }),
  );
  const client = new Client({ name: 'temporary-download', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
  let cleanupPath: string | undefined;
  try {
    const result = await client.callTool({
      name: 'jira_download_attachment',
      arguments: { attachmentId: '42' },
    });
    expect(result.isError).not.toBe(true);
    const content = result.content as { type: string; text: string }[];
    const output = JSON.parse(content[0]!.text);
    cleanupPath = output.cleanupPath;
    expect(output).toMatchObject({
      attachmentId: '42',
      mimeType: 'text/plain',
      size: 3,
    });
    expect(output.savedTo).toContain('/42.txt');
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(output.savedTo, 'utf8')).toBe('log');
    expect(output.downloadId).toBeTruthy();
    const cleanup = await client.callTool({
      name: 'jira_cleanup_attachments',
      arguments: { downloadIds: [output.downloadId] },
    });
    expect(
      JSON.parse((cleanup.content as { text: string }[])[0]!.text).results[0]
        .status,
    ).toBe('deleted');
    await expect(readFile(output.savedTo)).rejects.toThrow();
    expect(
      (
        await client.callTool({
          name: 'jira_cleanup_attachments',
          arguments: { downloadIds: [output.cleanupPath] },
        })
      ).isError,
    ).toBe(true);
  } finally {
    await client.close();
    await server.close();
    if (cleanupPath) {
      const { rm } = await import('node:fs/promises');
      await rm(cleanupPath, { recursive: true, force: true });
    }
  }
});
