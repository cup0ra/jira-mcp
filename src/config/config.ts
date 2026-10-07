import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const schema = z.object({
  JIRA_BASE_URL: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }),
  JIRA_PAT: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !/\s/.test(value)),
  JIRA_MCP_ALLOWED_PATHS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean),
    )
    .refine((paths) => paths.every(isAbsolute)),
  JIRA_MCP_MAX_FILE_SIZE_MB: z.coerce
    .number()
    .finite()
    .positive()
    .max(1024)
    .default(20),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export class ConfigurationError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Never include input values or Zod's potentially sensitive diagnostics.
    throw new ConfigurationError(
      `Invalid configuration: ${[...new Set(result.error.issues.map((issue) => issue.path[0]))].join(', ')}. Check the documented environment variables.`,
    );
  }
  const value = result.data;
  const url = new URL(value.JIRA_BASE_URL);
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '');
  return {
    baseUrl: url.toString().replace(/\/$/, ''),
    pat: value.JIRA_PAT,
    allowedPaths: value.JIRA_MCP_ALLOWED_PATHS.map((p) => resolve(p)),
    maxFileSizeBytes: Math.floor(value.JIRA_MCP_MAX_FILE_SIZE_MB * 1024 * 1024),
    logLevel: value.LOG_LEVEL,
  };
}
export type Config = ReturnType<typeof loadConfig>;
