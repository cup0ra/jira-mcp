import { FileTooLargeError } from '../security/file-access.js';
import { issueFields } from './issue-fields.js';
import type {
  JiraAttachment,
  AttachmentUpload,
  CreateIssueInput,
  CreatedIssue,
  IssueFieldsInput,
  JiraComment,
  JiraCommentPage,
  JiraCurrentUser,
  JiraTransition,
  TransitionInput,
} from './jira-api.types.js';
import { JiraValidationError } from './jira-error.js';
import {
  summaryFields,
  detailFields,
  type JiraIssue,
  type JiraSearchResult,
  type SearchInput,
} from './jira-api.types.js';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Config } from '../config/config.js';
import { apiError, JiraError } from './jira-error.js';
import { redact } from '../utils/errors.js';

type Dependencies = {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<unknown>;
  timeoutMs?: number;
};
export class JiraClient {
  private readonly fetcher: typeof fetch;
  private readonly pause: (ms: number) => Promise<unknown>;
  private readonly timeoutMs: number;
  constructor(
    private readonly config: Pick<Config, 'baseUrl' | 'pat'>,
    deps: Dependencies = {},
  ) {
    this.fetcher = deps.fetch ?? fetch;
    this.pause = deps.sleep ?? sleep;
    this.timeoutMs = deps.timeoutMs ?? 30_000;
  }
  getCurrentUser(): Promise<JiraCurrentUser> {
    return this.request('/myself');
  }
  searchIssues(input: SearchInput): Promise<JiraSearchResult> {
    return this.request('/search', {
      method: 'POST',
      body: JSON.stringify({
        jql: input.jql,
        maxResults: input.maxResults ?? 25,
        startAt: input.startAt ?? 0,
        fields: input.fields ?? summaryFields,
      }),
    });
  }
  getIssue(issueKey: string, includeCustomFields = true): Promise<JiraIssue> {
    return this.request(
      `/issue/${encodeURIComponent(issueKey)}?fields=${includeCustomFields ? '*all' : detailFields.join(',')}${includeCustomFields ? '&expand=names' : ''}`,
    );
  }
  getComments(
    issueKey: string,
    startAt = 0,
    maxResults = 50,
  ): Promise<JiraCommentPage> {
    return this.request(
      `/issue/${encodeURIComponent(issueKey)}/comment?startAt=${startAt}&maxResults=${maxResults}&orderBy=created`,
    );
  }
  createIssue(input: CreateIssueInput): Promise<CreatedIssue> {
    return this.request('/issue', {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          ...issueFields(input),
          project: { key: input.projectKey },
          issuetype: { name: input.issueType },
        },
      }),
    });
  }
  async updateIssue(issueKey: string, input: IssueFieldsInput): Promise<void> {
    const fields = issueFields(input);
    if (Object.keys(fields).length === 0)
      throw new JiraValidationError('Provide at least one field to update.');
    await this.request(`/issue/${encodeURIComponent(issueKey)}`, {
      method: 'PUT',
      body: JSON.stringify({ fields }),
    });
  }
  addComment(issueKey: string, body: string): Promise<JiraComment> {
    return this.request(`/issue/${encodeURIComponent(issueKey)}/comment`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }
  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const result = await this.request<{ transitions: JiraTransition[] }>(
      `/issue/${encodeURIComponent(issueKey)}/transitions`,
    );
    return result.transitions.map(({ id, name }) => ({ id, name }));
  }
  async transitionIssue(issueKey: string, input: TransitionInput) {
    if (
      (input.transitionId !== undefined) ===
      (input.transitionName !== undefined)
    ) {
      throw new JiraValidationError(
        'Provide exactly one of transitionId or transitionName.',
      );
    }
    let transitionId = input.transitionId?.trim();
    if (input.transitionName !== undefined) {
      const name = input.transitionName.trim();
      if (!name)
        throw new JiraValidationError('Transition name must not be blank.');
      const transitions = await this.getTransitions(issueKey);
      const matches = transitions.filter(
        (transition) => transition.name.toLowerCase() === name.toLowerCase(),
      );
      if (matches.length === 0)
        throw new JiraValidationError(
          'No available transition matches that name. Use jira_get_transitions to see available transition names and IDs.',
        );
      if (matches.length > 1)
        throw new JiraValidationError(
          'Multiple available transitions match that name. Use jira_get_transitions and select a transitionId.',
        );
      transitionId = matches[0]!.id;
    }
    if (!transitionId)
      throw new JiraValidationError('Transition ID must not be blank.');
    await this.request(`/issue/${encodeURIComponent(issueKey)}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
    // A failed status read must not misreport a confirmed write as failed.
    const result = {
      key: issueKey,
      transitioned: true,
      transitionId,
      status: null as string | null,
    };
    try {
      const issue = await this.request<JiraIssue>(
        `/issue/${encodeURIComponent(issueKey)}?fields=status`,
      );
      result.status = issue.fields.status?.name ?? null;
    } catch {
      // Transition succeeded; the current status is simply unavailable.
    }
    return result.status === null
      ? {
          ...result,
          warning:
            'Transition succeeded, but the current status could not be read. Do not repeat the transition; use jira_get_issue to check.',
        }
      : result;
  }
  async listAttachments(issueKey: string): Promise<JiraAttachment[]> {
    const issue = await this.request<JiraIssue>(
      `/issue/${encodeURIComponent(issueKey)}?fields=attachment`,
    );
    return issue.fields.attachment ?? [];
  }
  uploadAttachment(
    issueKey: string,
    files: AttachmentUpload[],
  ): Promise<JiraAttachment[]> {
    const form = new FormData();
    for (const file of files)
      form.append(
        'file',
        new Blob([new Uint8Array(file.data)], {
          type: file.mimeType ?? 'application/octet-stream',
        }),
        file.filename,
      );
    return this.request(`/issue/${encodeURIComponent(issueKey)}/attachments`, {
      method: 'POST',
      headers: { 'X-Atlassian-Token': 'no-check' },
      body: form,
    });
  }
  getAttachment(attachmentId: string): Promise<JiraAttachment> {
    return this.request(`/attachment/${encodeURIComponent(attachmentId)}`);
  }
  async downloadAttachment(
    contentUrl: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    let url: URL;
    try {
      url = new URL(contentUrl);
    } catch {
      throw new JiraValidationError('Jira returned an invalid attachment URL.');
    }
    const base = new URL(this.config.baseUrl);
    const context = base.pathname.replace(/\/$/, '');
    if (
      url.origin !== base.origin ||
      url.username ||
      url.password ||
      url.hash ||
      !url.pathname.startsWith(`${context}/`)
    ) {
      throw new JiraValidationError(
        'Attachment URL must be within the configured Jira origin and context path.',
      );
    }
    return this.perform(
      url.toString(),
      { headers: { Accept: 'application/octet-stream' } },
      true,
      async (response) => {
        const declared = response.headers.get('content-length');
        if (declared !== null && Number(declared) > maxBytes) {
          await response.body?.cancel();
          throw new FileTooLargeError(
            'Download exceeds JIRA_MCP_MAX_FILE_SIZE_MB.',
          );
        }
        if (!response.body)
          throw new JiraError('Jira returned no attachment content.');
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes)
              throw new FileTooLargeError(
                'Download exceeds JIRA_MCP_MAX_FILE_SIZE_MB.',
              );
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return result;
      },
    );
  }
  protected async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    // Only relative API paths are accepted; credentials never follow redirects.
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('..') ||
      path.includes('\\')
    )
      throw new JiraError('Invalid Jira API path.');
    const method = (options.method ?? 'GET').toUpperCase();
    const retryable =
      method === 'GET' || (method === 'POST' && path === '/search');
    return this.perform(
      `${this.config.baseUrl}/rest/api/2${path}`,
      options,
      retryable,
      async (response) => {
        if (response.status === 204) return undefined as T;
        return (await response.json()) as T;
      },
    );
  }
  private async perform<T>(
    url: string,
    options: RequestInit,
    retryable: boolean,
    decode: (response: Response) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        const headers = new Headers(options.headers);
        headers.set('Authorization', `Bearer ${this.config.pat}`);
        if (!headers.has('Accept')) headers.set('Accept', 'application/json');
        if (typeof options.body === 'string')
          headers.set('Content-Type', 'application/json');
        response = await this.fetcher(url, {
          ...options,
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (
          retryable &&
          attempt < 2 &&
          [429, 502, 503, 504].includes(response.status)
        ) {
          const header = response.headers.get('retry-after');
          const seconds = header === null ? NaN : Number(header);
          const delay = Number.isFinite(seconds)
            ? seconds * 1000
            : header
              ? Date.parse(header) - Date.now()
              : NaN;
          await response.body?.cancel();
          await this.pause(
            Math.min(
              30_000,
              Math.max(0, Number.isFinite(delay) ? delay : 250 * 2 ** attempt),
            ),
          );
          continue;
        }
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          let detail = '';
          if (body && typeof body === 'object') {
            const data = body as Record<string, unknown>;
            const messages = Array.isArray(data.errorMessages)
              ? data.errorMessages.filter((x) => typeof x === 'string')
              : [];
            if (data.errors && typeof data.errors === 'object') {
              messages.push(
                ...Object.entries(data.errors)
                  .filter(([, v]) => typeof v === 'string')
                  .map(([k, v]) => `${k}: ${v}`),
              );
            }
            detail = redact(messages.join(' '), this.config.pat).slice(0, 2000);
          }
          throw apiError(response.status, detail);
        }
        return await decode(response);
      } catch (error) {
        if (error instanceof JiraError || error instanceof FileTooLargeError)
          throw error;
        const timedOut =
          error instanceof Error &&
          ['TimeoutError', 'AbortError'].includes(error.name);
        throw new JiraError(
          timedOut
            ? retryable
              ? 'Jira request timed out. Try again.'
              : 'Jira request timed out. The change may have been applied. Check the issue before retrying.'
            : 'Unable to read a valid Jira response. Check the base URL, network, TLS, and proxy settings. Redirects are not followed.' +
                (retryable
                  ? ''
                  : ' The change may have been applied. Check the issue before retrying.'),
        );
      }
    }
  }
}
