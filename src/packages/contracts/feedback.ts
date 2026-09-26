export interface FeedbackSubmission {
  readonly organization_id: string;
  readonly project_id?: string;
  readonly environment_id?: string;
  readonly operation_id?: string;
  readonly kind: "bug" | "issue" | "feature_request";
  readonly title: string;
  /** Redacted expected/actual behavior and minimal reproduction; never raw logs or secrets. */
  readonly description: string;
  readonly error_code?: string;
  readonly client_version?: string;
}

export interface FeedbackReceipt {
  readonly id: string;
  readonly organization_id: string;
  readonly submitted_at: string;
}

export type FeedbackState =
  | "received"
  | "in_review"
  | "planned"
  | "in_progress"
  | "resolved"
  | "closed";

/** One customer-visible operator update; internal notes never appear here. */
export interface FeedbackUpdate {
  readonly id: string;
  readonly created_at: string;
  readonly status?: Exclude<FeedbackState, "received">;
  /** The shipped release that contains the fix; present exactly on `resolved`. */
  readonly release?: string;
  readonly reply?: string;
}

export interface FeedbackStatus {
  readonly id: string;
  readonly organization_id: string;
  readonly submitted_at: string;
  readonly status: FeedbackState;
  /** Latest customer-visible update across the whole history, or the submission time. */
  readonly updated_at: string;
  /** One page of customer-visible updates, oldest first. */
  readonly history: readonly FeedbackUpdate[];
  /** Pass as `cursor` to read the next page; null on the last page. */
  readonly next_cursor: string | null;
}

/** Customer-visible updates per history page. */
export const FEEDBACK_HISTORY_PAGE_SIZE = 25;
export const FEEDBACK_REPLY_MAX_LENGTH = 2000;
/** A `resolved` or `closed` update must explain itself in at least this many characters. */
export const FEEDBACK_EXPLANATION_MIN_LENGTH = 20;
export const FEEDBACK_UPDATE_STATES: readonly Exclude<FeedbackState, "received">[] = [
  "in_review",
  "planned",
  "in_progress",
  "resolved",
  "closed",
];
const releasePattern = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,63}$/u;

const identifier = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const fields = new Set([
  "organization_id",
  "project_id",
  "environment_id",
  "operation_id",
  "kind",
  "title",
  "description",
  "error_code",
  "client_version",
]);

const metadata = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/u;
const detailPrefix = "Feedback was not accepted:";
const detailSuffix = "Nothing was stored; correct these fields and submit again.";
// Each refusal sentence names a field and a rule, never the submitted value, so a client can show
// it verbatim: parseFeedbackSubmissionDetail recognizes exactly these sentences.
const detailSentence = new RegExp(
  "^" +
    detailPrefix +
    "((?: (?:" +
    [
      "Only organization_id, project_id, environment_id, operation_id, kind, title, description, error_code and client_version are accepted; remove other fields such as attachments or logs\\.",
      "organization_id must be the 26-character workspace ULID\\.",
      "(?:project|environment|operation)_id must be a 26-character ULID\\.",
      "environment_id and operation_id require project_id\\.",
      "kind must be bug, issue or feature_request\\.",
      "(?:title|description) must be a string\\.",
      "(?:title|description) must not be empty\\.",
      "(?:title|description) must not start or end with whitespace; trim it\\.",
      "(?:title|description) has [1-9][0-9]{0,8} characters, over the (?:160|8000)-character limit; shorten it, it is never truncated\\.",
      "title must not contain line breaks, tabs or other control characters\\.",
      "description must not contain control characters other than tabs and line breaks, such as terminal color codes\\.",
      "(?:error_code|client_version) must be 1–128 letters, digits and the characters \\._:/\\+- starting with a letter or digit\\.",
    ].join("|") +
    "))+) " +
    detailSuffix.replace(".", "\\.") +
    "$",
  "u",
);

/** A refused submission whose message names each failing field and rule, never its value. */
export class FeedbackSubmissionError extends TypeError {
  public constructor(problems: readonly string[]) {
    super(`${detailPrefix} ${problems.join(" ")} ${detailSuffix}`);
    this.name = "FeedbackSubmissionError";
  }
}

/** The refusal detail when it is exactly a feedback validation message, otherwise null. */
export function parseFeedbackSubmissionDetail(value: unknown): string | null {
  return typeof value === "string" && value.length <= 2000 && detailSentence.test(value)
    ? value
    : null;
}

export function parseFeedbackSubmission(value: unknown): FeedbackSubmission {
  const v = (
    typeof value === "object" && value !== null && !Array.isArray(value) ? value : {}
  ) as Record<string, unknown>;
  const problems: string[] = [];
  if (Object.keys(v).some((key) => !fields.has(key)))
    problems.push(
      "Only organization_id, project_id, environment_id, operation_id, kind, title, description, error_code and client_version are accepted; remove other fields such as attachments or logs.",
    );
  if (!validIdentifier(v["organization_id"]))
    problems.push("organization_id must be the 26-character workspace ULID.");
  for (const key of ["project_id", "environment_id", "operation_id"])
    if (key in v && !validIdentifier(v[key])) problems.push(`${key} must be a 26-character ULID.`);
  if (("environment_id" in v || "operation_id" in v) && !("project_id" in v))
    problems.push("environment_id and operation_id require project_id.");
  if (typeof v["kind"] !== "string" || !["bug", "issue", "feature_request"].includes(v["kind"]))
    problems.push("kind must be bug, issue or feature_request.");
  problems.push(...textProblems("title", v["title"], 160, false));
  problems.push(...textProblems("description", v["description"], 8000, true));
  for (const key of ["error_code", "client_version"])
    if (key in v && (typeof v[key] !== "string" || !metadata.test(v[key])))
      problems.push(
        `${key} must be 1–128 letters, digits and the characters ._:/+- starting with a letter or digit.`,
      );
  if (problems.length > 0) throw new FeedbackSubmissionError(problems);
  return v as unknown as FeedbackSubmission;
}

/** The same rules as validText, each failure named for one field. */
function textProblems(field: string, value: unknown, max: number, multiline: boolean): string[] {
  if (typeof value !== "string") return [`${field} must be a string.`];
  if (value.length === 0) return [`${field} must not be empty.`];
  const problems: string[] = [];
  if (value !== value.trim())
    problems.push(`${field} must not start or end with whitespace; trim it.`);
  const length = Array.from(value).length;
  if (length > max)
    problems.push(
      `${field} has ${String(length)} characters, over the ${String(max)}-character limit; shorten it, it is never truncated.`,
    );
  if (hasControlCharacter(value, multiline))
    problems.push(
      multiline
        ? `${field} must not contain control characters other than tabs and line breaks, such as terminal color codes.`
        : `${field} must not contain line breaks, tabs or other control characters.`,
    );
  return problems;
}

export function parseFeedbackReceipt(value: unknown): FeedbackReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Feedback was not acknowledged");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join(",") !== "id,organization_id,submitted_at" ||
    typeof v["id"] !== "string" ||
    !identifier.test(v["id"]) ||
    typeof v["organization_id"] !== "string" ||
    !identifier.test(v["organization_id"]) ||
    typeof v["submitted_at"] !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v["submitted_at"]) ||
    !Number.isFinite(Date.parse(v["submitted_at"])) ||
    new Date(v["submitted_at"]).toISOString() !== v["submitted_at"]
  )
    throw new TypeError("Feedback was not acknowledged");
  return v as unknown as FeedbackReceipt;
}

export function parseFeedbackStatus(value: unknown): FeedbackStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Feedback status is invalid");
  const v = value as Record<string, unknown>;
  const history = v["history"];
  if (
    Object.keys(v).sort().join(",") !==
      "history,id,next_cursor,organization_id,status,submitted_at,updated_at" ||
    (v["next_cursor"] !== null && !validIdentifier(v["next_cursor"])) ||
    !validIdentifier(v["id"]) ||
    !validIdentifier(v["organization_id"]) ||
    !validTimestamp(v["submitted_at"]) ||
    !validTimestamp(v["updated_at"]) ||
    typeof v["status"] !== "string" ||
    !(
      v["status"] === "received" ||
      (FEEDBACK_UPDATE_STATES as readonly string[]).includes(v["status"])
    ) ||
    !Array.isArray(history) ||
    history.length > FEEDBACK_HISTORY_PAGE_SIZE ||
    (v["next_cursor"] !== null && history.length !== FEEDBACK_HISTORY_PAGE_SIZE) ||
    !history.every(validUpdate)
  )
    throw new TypeError("Feedback status is invalid");
  return v as unknown as FeedbackStatus;
}

/** Bounded, trimmed text without control characters other than tab and line breaks. */
export function validFeedbackText(value: unknown, max: number): value is string {
  return validText(value, max, true);
}

function validUpdate(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = Object.keys(v);
  const status = v["status"];
  return (
    keys.every((key) => ["id", "created_at", "status", "release", "reply"].includes(key)) &&
    validIdentifier(v["id"]) &&
    validTimestamp(v["created_at"]) &&
    (status === undefined ||
      (typeof status === "string" &&
        (FEEDBACK_UPDATE_STATES as readonly string[]).includes(status))) &&
    (status !== undefined || "reply" in v) &&
    ("release" in v
      ? status === "resolved" &&
        typeof v["release"] === "string" &&
        releasePattern.test(v["release"])
      : status !== "resolved") &&
    (!("reply" in v) || validText(v["reply"], FEEDBACK_REPLY_MAX_LENGTH, true)) &&
    ((status !== "resolved" && status !== "closed") || "reply" in v)
  );
}

function validIdentifier(value: unknown): boolean {
  return typeof value === "string" && identifier.test(value);
}

function validTimestamp(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function validText(value: unknown, max: number, multiline: boolean): boolean {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    Array.from(value).length >= 1 &&
    Array.from(value).length <= max &&
    !hasControlCharacter(value, multiline)
  );
}

function hasControlCharacter(value: string, multiline: boolean): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      (code < 32 && !(multiline && (code === 9 || code === 10 || code === 13))) ||
      (code >= 127 && code <= 159)
    );
  });
}
