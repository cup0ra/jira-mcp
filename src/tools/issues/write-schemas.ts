import { z } from 'zod';
export const issueKeySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]*-[1-9][0-9]*$/)
  .max(255);
type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(jsonValue),
  ]),
);
const name = z.string().trim().min(1).max(255);
export const editableFields = {
  summary: name.optional(),
  description: z
    .string()
    .optional()
    .describe('Jira text/wiki markup; empty string clears the description.'),
  priority: name.optional().describe('Exact Jira priority name.'),
  assignee: name
    .optional()
    .describe('Jira Server username, not display name or Cloud accountId.'),
  labels: z
    .array(name.regex(/^\S+$/, 'Labels cannot contain whitespace'))
    .max(100)
    .optional()
    .describe('Replaces all labels; [] clears them.'),
  components: z
    .array(name)
    .max(100)
    .optional()
    .describe('Component names. Replaces all components; [] clears them.'),
  customFields: z
    .record(
      z
        .string()
        .regex(/^customfield_[0-9]+$/, 'Use a raw customfield_12345 ID'),
      jsonValue,
    )
    .optional()
    .describe(
      'Raw Jira custom field IDs and Jira-compatible values; null clears a field where Jira permits it.',
    ),
};
