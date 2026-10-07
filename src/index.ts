#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigurationError, loadConfig } from './config/config.js';
import { createServer } from './server.js';
import { createLogger } from './utils/logger.js';

async function main() {
  const config = loadConfig();
  const log = createLogger(config);
  const server = createServer(config);
  await server.connect(new StdioServerTransport());
  log('info', 'Jira MCP server connected over stdio.');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void server.close().finally(() => process.exit(0));
    });
  }
}
main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof ConfigurationError
      ? `Jira MCP startup failed. ${error.message}\n`
      : 'Jira MCP startup failed. Check stdio transport.\n',
  );
  process.exitCode = 1;
});
