import type { JiraIssue, JiraUser, JiraComment } from './jira-api.types.js';
const userName = (user?: JiraUser | null) =>
  user?.displayName ?? user?.name ?? null;
export function normalizeComment(c: JiraComment) {
  return {
    id: c.id,
    body: c.body ?? '',
    author: userName(c.author),
    created: c.created,
    updated: c.updated,
  };
}
export function commentPagination(
  startAt: number,
  returned: number,
  total?: number,
) {
  const next = startAt + returned;
  const hasMore = total === undefined ? returned > 0 : next < total;
  return {
    startAt,
    returned,
    total: total ?? null,
    hasMore,
    nextStartAt: hasMore && returned > 0 ? next : null,
  };
}
export function normalizeIssue(issue: JiraIssue, baseUrl: string) {
  const f = issue.fields;
  return {
    key: issue.key,
    summary: f.summary ?? null,
    status: f.status?.name ?? null,
    issueType: f.issuetype?.name ?? null,
    priority: f.priority?.name ?? null,
    assignee: userName(f.assignee),
    reporter: userName(f.reporter),
    labels: f.labels ?? [],
    updated: f.updated ?? null,
    url: `${baseUrl}/browse/${encodeURIComponent(issue.key)}`,
  };
}
export function normalizeIssueDetail(issue: JiraIssue, baseUrl: string) {
  const f = issue.fields;
  const comments = f.comment?.comments ?? [];
  return {
    ...normalizeIssue(issue, baseUrl),
    description: f.description ?? null,
    components: f.components?.map((c) => c.name) ?? [],
    created: f.created ?? null,
    customFields: Object.entries(f)
      .filter(
        ([id, value]) =>
          /^customfield_[0-9]+$/.test(id) &&
          value !== null &&
          value !== undefined,
      )
      .map(([id, value]) => ({ id, name: issue.names?.[id] ?? id, value })),
    comments: comments.map(normalizeComment),
    commentsPagination: commentPagination(
      f.comment?.startAt ?? 0,
      comments.length,
      f.comment?.total,
    ),
    issueLinks: (f.issuelinks ?? []).flatMap((link) => {
      const linkedIssue = link.outwardIssue ?? link.inwardIssue;
      if (!linkedIssue) return [];
      const direction = link.outwardIssue ? 'outward' : 'inward';
      return [
        {
          id: link.id,
          type: link.type.name,
          direction,
          relationship: link.type[direction],
          key: linkedIssue.key,
          summary: linkedIssue.fields?.summary ?? null,
          status: linkedIssue.fields?.status?.name ?? null,
          issueType: linkedIssue.fields?.issuetype?.name ?? null,
          url: `${baseUrl}/browse/${encodeURIComponent(linkedIssue.key)}`,
        },
      ];
    }),
    attachments: (f.attachment ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      size: a.size,
      mimeType: a.mimeType,
      author: userName(a.author),
      created: a.created,
    })),
  };
}
