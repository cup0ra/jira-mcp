import type { IssueFieldsInput } from './jira-api.types.js';
import { JiraValidationError } from './jira-error.js';

/** Map agent-friendly values to Jira Server field payloads. */
export function issueFields(input: IssueFieldsInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(input.customFields ?? {})) {
    if (!/^customfield_[0-9]+$/.test(id)) {
      throw new JiraValidationError(
        'customFields keys must be Jira IDs such as customfield_12345. Field-name resolution is not available yet.',
      );
    }
    if (value !== undefined) fields[id] = value;
  }
  if (input.summary !== undefined) fields.summary = input.summary;
  if (input.description !== undefined) fields.description = input.description;
  if (input.priority !== undefined) fields.priority = { name: input.priority };
  if (input.assignee !== undefined) fields.assignee = { name: input.assignee };
  if (input.labels !== undefined) fields.labels = input.labels;
  if (input.components !== undefined)
    fields.components = input.components.map((name) => ({ name }));
  return fields;
}
