import { describe, it, expect, vi } from 'vitest';
import { loadConfig } from '../src/config/config.js';
import { JiraClient } from '../src/jira/jira-client.js';
import { redact } from '../src/utils/errors.js';
class TestClient extends JiraClient {
  call(path = '/issue/ABC-1', options?: RequestInit) {
    return this.request(path, options);
  }
}
const config = loadConfig({
  JIRA_BASE_URL: 'https://jira.example.com//jira///',
  JIRA_PAT: 'secret-token',
});
const json = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
describe('configuration', () => {
  it('normalizes context paths and uses safe defaults', () => {
    expect(config.baseUrl).toBe('https://jira.example.com/jira');
    expect(config.allowedPaths).toEqual([]);
    expect(config.maxFileSizeBytes).toBe(20 * 1024 * 1024);
  });
  it.each([
    { JIRA_PAT: '' },
    { JIRA_BASE_URL: 'ftp://host' },
    { JIRA_BASE_URL: 'https://user:secret@host' },
    { JIRA_MCP_ALLOWED_PATHS: './relative' },
    { JIRA_MCP_MAX_FILE_SIZE_MB: '0' },
    { LOG_LEVEL: 'trace' },
  ])('rejects invalid configuration %j', (override) => {
    expect(() =>
      loadConfig({
        JIRA_BASE_URL: 'https://jira.example.com',
        JIRA_PAT: 'secret-token',
        ...override,
      }),
    ).toThrow('Invalid configuration:');
  });
});
describe('Jira HTTP boundary', () => {
  it('sets bearer auth and preserves the Jira context path', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ key: 'ABC-1' }));
    await new TestClient(config, { fetch: fetcher }).call();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://jira.example.com/jira/rest/api/2/issue/ABC-1');
    expect(init.headers.get('Authorization')).toBe('Bearer secret-token');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
  it.each([400, 401, 403, 404, 409, 429, 500])(
    'reports HTTP %i without secrets',
    async (status) => {
      const fetcher = vi.fn().mockImplementation(() =>
        Promise.resolve(
          json(
            {
              errorMessages: ['secret-token'],
              errors: { field: 'Required' },
            },
            status,
          ),
        ),
      );
      const client = new TestClient(config, {
        fetch: fetcher,
        sleep: async () => {},
      });
      await expect(client.call()).rejects.toThrow(`HTTP ${status}`);
      await expect(client.call()).rejects.not.toThrow('secret-token');
    },
  );
  it('retries 429 and temporary failures with a bounded delay', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { 'Retry-After': '999' }))
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({ ok: true }));
    const pause = vi.fn().mockResolvedValue(undefined);
    await expect(
      new TestClient(config, { fetch: fetcher, sleep: pause }).call(),
    ).resolves.toEqual({ ok: true });
    expect(pause.mock.calls).toEqual([[30000], [500]]);
  });
  it('does not retry mutations', async () => {
    const fetcher = vi.fn().mockResolvedValue(json({}, 503));
    await expect(
      new TestClient(config, { fetch: fetcher }).call('/issue', {
        method: 'POST',
        body: '{}',
      }),
    ).rejects.toThrow('503');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('sanitizes network and timeout failures', async () => {
    for (const error of [
      new Error('secret-token'),
      new DOMException('secret-token', 'TimeoutError'),
    ]) {
      const client = new TestClient(config, {
        fetch: vi.fn().mockRejectedValue(error),
      });
      await expect(client.call()).rejects.not.toThrow('secret-token');
    }
  });
  it('redacts credentials', () => {
    expect(redact('secret-token Bearer another-token', config.pat)).toBe(
      '[REDACTED] Bearer [REDACTED]',
    );
  });
});
