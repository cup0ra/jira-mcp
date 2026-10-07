export class JiraError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
export class JiraAuthenticationError extends JiraError {}
export class JiraPermissionError extends JiraError {}
export class JiraNotFoundError extends JiraError {}
export class JiraValidationError extends JiraError {}
export class JiraConflictError extends JiraError {}
export class JiraRateLimitError extends JiraError {}

export function apiError(status: number, detail: string): JiraError {
  const constructors: Record<number, typeof JiraError> = {
    400: JiraValidationError,
    401: JiraAuthenticationError,
    403: JiraPermissionError,
    404: JiraNotFoundError,
    409: JiraConflictError,
    429: JiraRateLimitError,
  };
  const hints: Record<number, string> = {
    400: 'Check the JQL or request fields.',
    401: 'Check JIRA_PAT and its expiration.',
    403: 'The Jira user lacks permission.',
    404: 'The issue or endpoint was not found or is not visible.',
    409: 'Jira reported a conflict. Refresh before retrying.',
    429: 'Jira rate limit reached. Try again later.',
  };
  return new (constructors[status] ?? JiraError)(
    `Jira HTTP ${status}: ${hints[status] ?? 'Jira request failed.'}${detail ? ` ${detail}` : ''}`,
    status,
  );
}
