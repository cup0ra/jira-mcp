export interface JiraUser {
  displayName?: string;
  name?: string;
}
export interface JiraAttachment {
  content?: string;
  id: string;
  filename: string;
  size: number;
  mimeType?: string;
  author?: JiraUser;
  created?: string;
}
export interface JiraComment {
  id: string;
  body?: string;
  author?: JiraUser;
  created?: string;
  updated?: string;
}
export interface JiraLinkedIssue {
  key: string;
  fields?: {
    summary?: string;
    status?: { name: string };
    issuetype?: { name: string };
  };
}
export interface JiraIssueLink {
  id: string;
  type: { name: string; inward: string; outward: string };
  inwardIssue?: JiraLinkedIssue;
  outwardIssue?: JiraLinkedIssue;
}
export interface JiraIssue {
  key: string;
  names?: Record<string, string>;
  fields: {
    [key: string]: unknown;
    summary?: string;
    description?: string | null;
    status?: { name: string };
    issuetype?: { name: string };
    priority?: { name: string } | null;
    assignee?: JiraUser | null;
    reporter?: JiraUser | null;
    labels?: string[];
    components?: { name: string }[];
    created?: string;
    updated?: string;
    comment?: {
      comments: JiraComment[];
      total?: number;
      startAt?: number;
      maxResults?: number;
    };
    attachment?: JiraAttachment[];
    issuelinks?: JiraIssueLink[];
  };
}
export interface JiraSearchResult {
  startAt: number;
  maxResults: number;
  total?: number;
  issues: JiraIssue[];
}
export interface SearchInput {
  jql: string;
  maxResults?: number;
  startAt?: number;
  fields?: string[];
}
export const summaryFields = [
  'summary',
  'status',
  'issuetype',
  'priority',
  'assignee',
  'reporter',
  'labels',
  'updated',
];
export const detailFields = [
  ...summaryFields,
  'description',
  'components',
  'created',
  'comment',
  'attachment',
  'issuelinks',
];

export interface IssueFieldsInput {
  summary?: string;
  description?: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
  components?: string[];
  customFields?: Record<string, unknown>;
}
export interface CreateIssueInput extends IssueFieldsInput {
  projectKey: string;
  issueType: string;
  summary: string;
}
export interface CreatedIssue {
  id: string;
  key: string;
}

export interface JiraTransition {
  id: string;
  name: string;
}
export interface TransitionInput {
  transitionId?: string;
  transitionName?: string;
}

export interface AttachmentUpload {
  filename: string;
  data: Uint8Array;
  mimeType?: string;
}

export interface JiraCurrentUser extends JiraUser {
  active?: boolean;
  timeZone?: string;
}

export interface JiraCommentPage {
  comments: JiraComment[];
  startAt: number;
  maxResults: number;
  total?: number;
}
