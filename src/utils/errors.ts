import { FileAccessDeniedError } from '../security/file-access.js';
import { JiraError } from '../jira/jira-error.js';
export function redact(message: string, pat: string): string {
  let result = message;
  for (const secret of [pat, encodeURIComponent(pat)]) {
    if (secret) result = result.split(secret).join('[REDACTED]');
  }
  return result.replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, '$1 [REDACTED]');
}
export function toolError(error: unknown, pat: string) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: redact(
          error instanceof JiraError || error instanceof FileAccessDeniedError
            ? error.message
            : 'Unexpected error while processing the Jira response.',
          pat,
        ),
      },
    ],
  };
}
