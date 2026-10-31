import type { DatabaseEnvironment } from "./database-access.js";

/** Customer webhooks may subscribe only to these database lifecycle events. */
export const DATABASE_WEBHOOK_EVENT_TYPES = [
  "database.created",
  "database.ready",
  "database.woke",
  "database.slept",
  "database.suspended",
  "database.resized",
  "database.deleted",
] as const;
export type DatabaseWebhookEventType = (typeof DATABASE_WEBHOOK_EVENT_TYPES)[number];
/** Per environment; the platform-wide provider cap is shared by every customer. */
export const DATABASE_WEBHOOK_LIMIT = 5;
export const DATABASE_WEBHOOK_MAX_EVENT_TYPES = 16;
export const DATABASE_WEBHOOK_MAX_HEADERS = 8;
export const DATABASE_WEBHOOK_URL_MAX_LENGTH = 2048;

export const DATABASE_SCHEDULE_MIN_EVERY_SECONDS = 60;
export const DATABASE_SCHEDULE_MAX_EVERY_SECONDS = 31 * 86_400;
export const DATABASE_SCHEDULE_CRON_MIN_LENGTH = 9;
export const DATABASE_SCHEDULE_CRON_MAX_LENGTH = 120;
export const DATABASE_SCHEDULE_MAX_STATEMENTS = 20;
export const DATABASE_SCHEDULE_STATEMENT_MAX_BYTES = 16 * 1024;
export const DATABASE_SCHEDULE_STATEMENTS_MAX_BYTES = 64 * 1024;
export const DATABASE_SCHEDULE_MIN_TIMEOUT_MS = 1_000;
export const DATABASE_SCHEDULE_DEFAULT_TIMEOUT_MS = 10_000;
export const DATABASE_SCHEDULE_MAX_TIMEOUT_MS = 30_000;

export const DATABASE_SCHEDULE_OUTCOMES = [
  "succeeded",
  "failed",
  "timed_out",
  "outcome_unknown",
  "rejected",
  "skipped_capacity",
  "skipped_suspended",
  "skipped_deleted",
  "skipped_missed",
] as const;
export type DatabaseScheduleOutcome = (typeof DATABASE_SCHEDULE_OUTCOMES)[number];

export const DATABASE_EXECUTION_METRICS = [
  "schedule_runs_succeeded",
  "schedule_runs_failed",
  "schedule_runs_timed_out",
  "schedule_runs_outcome_unknown",
  "schedule_runs_rejected",
  "schedule_runs_skipped",
  "events_emitted",
  "event_bytes",
  "webhook_attempts",
  "webhook_deliveries_delivered",
  "webhook_deliveries_dead_lettered",
] as const;
export type DatabaseExecutionMetric = (typeof DATABASE_EXECUTION_METRICS)[number];
export type DatabaseExecutionMetrics = Readonly<Record<DatabaseExecutionMetric, number>>;

/** Upper bound for every list page, whatever the route default is. */
export const DATABASE_PAGE_MAX_ITEMS = 100;
const USAGE_HOUR_MS = 3_600_000;
const USAGE_MAX_RANGE_MS = 31 * 24 * USAGE_HOUR_MS;

export type DatabaseWebhookDeliveryState = "pending" | "delivered" | "dead_lettered";
export type DatabaseWebhookDeliveryError = "timeout" | "network" | "http" | "expired" | "permanent";
export type DatabaseWebhookTestError = "timeout" | "network" | "http";

export interface DatabaseWebhookCreateRequest {
  readonly url: string;
  readonly event_types: readonly DatabaseWebhookEventType[];
  readonly headers: Readonly<Record<string, string>>;
}

export interface DatabaseScheduleSetRequest {
  readonly cron: string | null;
  readonly every_seconds: number | null;
  readonly statements: readonly string[];
  readonly timeout_ms: number;
  readonly enabled: boolean;
}

export interface DatabaseUsageWindow {
  readonly from: string;
  readonly to: string;
  readonly granularity: "hour" | "day";
}

export interface DatabaseWebhook {
  readonly id: string;
  readonly environment: DatabaseEnvironment;
  readonly url: string;
  readonly event_types: readonly DatabaseWebhookEventType[];
  readonly header_names: readonly string[];
  readonly created_at: string;
}

/** The creation answer is the only place that shows the signing secret. */
export interface DatabaseWebhookCreated extends DatabaseWebhook {
  readonly secret: string;
}

export interface DatabaseWebhookPage {
  readonly items: readonly DatabaseWebhook[];
}

export interface DatabaseWebhookDeleted {
  readonly id: string;
  readonly deleted: true;
}

export interface DatabaseWebhookDelivery {
  readonly id: string;
  readonly event_id: string;
  readonly event_type: DatabaseWebhookEventType;
  readonly webhook_id: string;
  readonly state: DatabaseWebhookDeliveryState;
  readonly attempts: number;
  readonly created_at: string;
  readonly next_attempt_at: string | null;
  readonly delivered_at: string | null;
  readonly last_status: number | null;
  readonly last_error: DatabaseWebhookDeliveryError | null;
}

export interface DatabaseWebhookDeliveryPage {
  readonly items: readonly DatabaseWebhookDelivery[];
  readonly next_cursor: string | null;
}

export interface DatabaseWebhookTestResult {
  readonly delivered: boolean;
  readonly status: number | null;
  readonly error: DatabaseWebhookTestError | null;
  readonly duration_ms: number;
}

export interface DatabaseWebhookReplayAccepted {
  readonly delivery_id: string;
  readonly state: "pending";
}

export interface DatabaseSchedule {
  readonly name: string;
  readonly environment: DatabaseEnvironment;
  readonly cron: string | null;
  readonly every_seconds: number | null;
  readonly statements: readonly string[];
  readonly timeout_ms: number;
  readonly enabled: boolean;
  readonly next_run_at: string | null;
  readonly created_at: string;
}

export interface DatabaseSchedulePage {
  readonly items: readonly DatabaseSchedule[];
}

export interface DatabaseScheduleDeleted {
  readonly name: string;
  readonly deleted: true;
}

export interface DatabaseScheduleRun {
  readonly id: number;
  readonly schedule: string;
  readonly scheduled_at: string;
  readonly started_at: string | null;
  readonly finished_at: string;
  readonly outcome: DatabaseScheduleOutcome;
  readonly sqlstate: string | null;
  readonly attempts: number;
  readonly manual: boolean;
}

export interface DatabaseScheduleRunPage {
  readonly items: readonly DatabaseScheduleRun[];
}

export interface DatabaseScheduleRunAccepted {
  readonly schedule: string;
  readonly state: "queued";
}

export interface DatabaseExecutionUsageRow {
  readonly start: string;
  readonly end: string;
  readonly final: boolean;
  readonly metrics: DatabaseExecutionMetrics;
}

export interface DatabaseExecutionUsagePage {
  readonly items: readonly DatabaseExecutionUsageRow[];
  readonly next_cursor: string | null;
}

const WEBHOOK_KEYS = ["id", "environment", "url", "event_types", "header_names", "created_at"];
const WEBHOOK_ID_PATTERN = /^whk_[a-z0-9]{20}$/u;
const DELIVERY_ID_PATTERN = /^dlv_[0-9a-f]{20}$/u;
const EVENT_ID_PATTERN = /^evt_[0-9a-f]{20}$/u;
const SCHEDULE_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,62}$/u;
const CURSOR_PATTERN = /^[A-Za-z0-9._|:=+/-]{1,200}$/u;
const HEADER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/u;
const HEADER_VALUE_PATTERN = /^[\x21-\x7e]([\x20-\x7e]*[\x21-\x7e])?$/u;
const HEADER_FORBIDDEN_NAMES = [
  "host",
  "content-length",
  "content-type",
  "connection",
  "transfer-encoding",
  "user-agent",
  "te",
  "upgrade",
  "expect",
];
const HEADER_FORBIDDEN_PREFIXES = ["pgcf-", "cf-", "x-forwarded-"];

export function parseDatabaseEnvironment(value: unknown): DatabaseEnvironment {
  if (value !== "dev" && value !== "prod") throw new TypeError("Invalid database environment");
  return value;
}

export function parseDatabaseWebhookId(value: unknown): string {
  if (!matches(value, WEBHOOK_ID_PATTERN)) throw new TypeError("Invalid database webhook id");
  return value;
}

export function parseDatabaseDeliveryId(value: unknown): string {
  if (!matches(value, DELIVERY_ID_PATTERN)) throw new TypeError("Invalid database delivery id");
  return value;
}

export function parseDatabaseScheduleName(value: unknown): string {
  if (!matches(value, SCHEDULE_NAME_PATTERN)) throw new TypeError("Invalid database schedule name");
  return value;
}

/** A missing value takes the fallback; query strings are decimal digits only. */
export function parseDatabaseListLimit(value: unknown, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  const limit =
    typeof value === "string" && /^[1-9][0-9]{0,3}$/u.test(value) ? Number(value) : value;
  if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > max)
    throw new TypeError("Invalid database list limit");
  return limit;
}

export function parseDatabaseCursor(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!matches(value, CURSOR_PATTERN)) throw new TypeError("Invalid database cursor");
  return value;
}

/** Usage windows are UTC, aligned to the granularity and at most 31 days long. */
export function parseDatabaseUsageWindow(
  from: unknown,
  to: unknown,
  granularity: unknown,
): DatabaseUsageWindow {
  if (!timestamp(from) || !timestamp(to) || !oneOf(["hour", "day"] as const, granularity))
    throw new TypeError("Invalid database usage window");
  const start = Date.parse(from),
    end = Date.parse(to),
    unit = granularity === "hour" ? USAGE_HOUR_MS : 24 * USAGE_HOUR_MS;
  if (end <= start || end - start > USAGE_MAX_RANGE_MS || start % unit !== 0 || end % unit !== 0)
    throw new TypeError("Invalid database usage window");
  return { from, to, granularity };
}

/** Request bodies carry only the customer's fields; project, database and role are never accepted. */
export function parseDatabaseWebhookCreateRequest(value: unknown): DatabaseWebhookCreateRequest {
  if (!record(value) || !onlyKeys(value, ["url", "event_types", "headers"]))
    throw new TypeError("Invalid database webhook request");
  return {
    url: parseHttpsUrl(value["url"]),
    event_types: parseEventTypes(value["event_types"]),
    headers: value["headers"] === undefined ? {} : parseHeaders(value["headers"]),
  };
}

export function parseDatabaseScheduleSetRequest(value: unknown): DatabaseScheduleSetRequest {
  if (
    !record(value) ||
    !onlyKeys(value, ["cron", "every_seconds", "statements", "timeout_ms", "enabled", "confirm"]) ||
    value["confirm"] !== true ||
    (value["cron"] === undefined) === (value["every_seconds"] === undefined)
  )
    throw new TypeError("Invalid database schedule request");
  const enabled = value["enabled"] === undefined ? true : value["enabled"];
  if (typeof enabled !== "boolean") throw new TypeError("Invalid database schedule request");
  return {
    cron: value["cron"] === undefined ? null : parseCron(value["cron"]),
    every_seconds:
      value["every_seconds"] === undefined ? null : parseEverySeconds(value["every_seconds"]),
    statements: parseStatements(value["statements"]),
    timeout_ms:
      value["timeout_ms"] === undefined
        ? DATABASE_SCHEDULE_DEFAULT_TIMEOUT_MS
        : parseTimeout(value["timeout_ms"]),
    enabled,
  };
}

export function assertDatabaseWebhook(value: unknown): asserts value is DatabaseWebhook {
  if (!record(value) || !exact(value, WEBHOOK_KEYS))
    throw new TypeError("Invalid database webhook");
  assertWebhookFields(value);
}

export function assertDatabaseWebhookCreated(
  value: unknown,
): asserts value is DatabaseWebhookCreated {
  if (
    !record(value) ||
    !exact(value, [...WEBHOOK_KEYS, "secret"]) ||
    typeof value["secret"] !== "string" ||
    value["secret"].length === 0
  )
    throw new TypeError("Invalid database webhook");
  assertWebhookFields(value);
}

export function assertDatabaseWebhookPage(value: unknown): asserts value is DatabaseWebhookPage {
  if (!record(value) || !exact(value, ["items"]) || !pageItems(value["items"]))
    throw new TypeError("Invalid database webhook page");
  for (const item of value["items"]) assertDatabaseWebhook(item);
}

export function assertDatabaseWebhookDeleted(
  value: unknown,
): asserts value is DatabaseWebhookDeleted {
  if (
    !record(value) ||
    !exact(value, ["id", "deleted"]) ||
    !matches(value["id"], WEBHOOK_ID_PATTERN) ||
    value["deleted"] !== true
  )
    throw new TypeError("Invalid database webhook deletion");
}

export function assertDatabaseWebhookDelivery(
  value: unknown,
): asserts value is DatabaseWebhookDelivery {
  if (
    !record(value) ||
    !exact(value, [
      "id",
      "event_id",
      "event_type",
      "webhook_id",
      "state",
      "attempts",
      "created_at",
      "next_attempt_at",
      "delivered_at",
      "last_status",
      "last_error",
    ]) ||
    !matches(value["id"], DELIVERY_ID_PATTERN) ||
    !matches(value["event_id"], EVENT_ID_PATTERN) ||
    !oneOf(DATABASE_WEBHOOK_EVENT_TYPES, value["event_type"]) ||
    !matches(value["webhook_id"], WEBHOOK_ID_PATTERN) ||
    !oneOf(["pending", "delivered", "dead_lettered"] as const, value["state"]) ||
    !nonNegativeInteger(value["attempts"]) ||
    !timestamp(value["created_at"]) ||
    !nullable(value["next_attempt_at"], timestamp) ||
    !nullable(value["delivered_at"], timestamp) ||
    !nullable(value["last_status"], Number.isSafeInteger) ||
    !nullable(value["last_error"], (error) =>
      oneOf(["timeout", "network", "http", "expired", "permanent"] as const, error),
    )
  )
    throw new TypeError("Invalid database webhook delivery");
}

export function assertDatabaseWebhookDeliveryPage(
  value: unknown,
): asserts value is DatabaseWebhookDeliveryPage {
  if (!record(value) || !exact(value, ["items", "next_cursor"]) || !pageItems(value["items"]))
    throw new TypeError("Invalid database webhook delivery page");
  for (const item of value["items"]) assertDatabaseWebhookDelivery(item);
  if (!nullable(value["next_cursor"], isCursor))
    throw new TypeError("Invalid database webhook delivery page");
}

export function assertDatabaseWebhookTest(
  value: unknown,
): asserts value is DatabaseWebhookTestResult {
  if (
    !record(value) ||
    !exact(value, ["delivered", "status", "error", "duration_ms"]) ||
    typeof value["delivered"] !== "boolean" ||
    !nullable(value["status"], Number.isSafeInteger) ||
    !nullable(value["error"], (error) => oneOf(["timeout", "network", "http"] as const, error)) ||
    !nonNegativeInteger(value["duration_ms"])
  )
    throw new TypeError("Invalid database webhook test result");
}

export function assertDatabaseWebhookReplayAccepted(
  value: unknown,
): asserts value is DatabaseWebhookReplayAccepted {
  if (
    !record(value) ||
    !exact(value, ["delivery_id", "state"]) ||
    !matches(value["delivery_id"], DELIVERY_ID_PATTERN) ||
    value["state"] !== "pending"
  )
    throw new TypeError("Invalid database webhook replay");
}

export function assertDatabaseSchedule(value: unknown): asserts value is DatabaseSchedule {
  if (
    !record(value) ||
    !exact(value, [
      "name",
      "environment",
      "cron",
      "every_seconds",
      "statements",
      "timeout_ms",
      "enabled",
      "next_run_at",
      "created_at",
    ]) ||
    !matches(value["name"], SCHEDULE_NAME_PATTERN) ||
    !oneOf(["dev", "prod"] as const, value["environment"]) ||
    (value["cron"] === null) === (value["every_seconds"] === null) ||
    !nullable(value["cron"], isCronText) ||
    !nullable(value["every_seconds"], isEverySeconds) ||
    !Array.isArray(value["statements"]) ||
    value["statements"].length > DATABASE_SCHEDULE_MAX_STATEMENTS ||
    !value["statements"].every((statement) => typeof statement === "string") ||
    !isTimeout(value["timeout_ms"]) ||
    typeof value["enabled"] !== "boolean" ||
    !nullable(value["next_run_at"], timestamp) ||
    !timestamp(value["created_at"])
  )
    throw new TypeError("Invalid database schedule");
}

export function assertDatabaseSchedulePage(value: unknown): asserts value is DatabaseSchedulePage {
  if (!record(value) || !exact(value, ["items"]) || !pageItems(value["items"]))
    throw new TypeError("Invalid database schedule page");
  for (const item of value["items"]) assertDatabaseSchedule(item);
}

export function assertDatabaseScheduleDeleted(
  value: unknown,
): asserts value is DatabaseScheduleDeleted {
  if (
    !record(value) ||
    !exact(value, ["name", "deleted"]) ||
    !matches(value["name"], SCHEDULE_NAME_PATTERN) ||
    value["deleted"] !== true
  )
    throw new TypeError("Invalid database schedule deletion");
}

export function assertDatabaseScheduleRunPage(
  value: unknown,
): asserts value is DatabaseScheduleRunPage {
  if (!record(value) || !exact(value, ["items"]) || !pageItems(value["items"]))
    throw new TypeError("Invalid database schedule run page");
  for (const item of value["items"]) assertDatabaseScheduleRun(item);
}

export function assertDatabaseScheduleRunAccepted(
  value: unknown,
): asserts value is DatabaseScheduleRunAccepted {
  if (
    !record(value) ||
    !exact(value, ["schedule", "state"]) ||
    !matches(value["schedule"], SCHEDULE_NAME_PATTERN) ||
    value["state"] !== "queued"
  )
    throw new TypeError("Invalid database schedule run");
}

export function assertDatabaseExecutionUsagePage(
  value: unknown,
): asserts value is DatabaseExecutionUsagePage {
  if (!record(value) || !exact(value, ["items", "next_cursor"]) || !pageItems(value["items"]))
    throw new TypeError("Invalid database execution usage page");
  for (const row of value["items"]) assertUsageRow(row);
  if (!nullable(value["next_cursor"], isCursor))
    throw new TypeError("Invalid database execution usage page");
}

function assertDatabaseScheduleRun(value: unknown): asserts value is DatabaseScheduleRun {
  if (
    !record(value) ||
    !exact(value, [
      "id",
      "schedule",
      "scheduled_at",
      "started_at",
      "finished_at",
      "outcome",
      "sqlstate",
      "attempts",
      "manual",
    ]) ||
    !nonNegativeInteger(value["id"]) ||
    !matches(value["schedule"], SCHEDULE_NAME_PATTERN) ||
    !timestamp(value["scheduled_at"]) ||
    !nullable(value["started_at"], timestamp) ||
    !timestamp(value["finished_at"]) ||
    !oneOf(DATABASE_SCHEDULE_OUTCOMES, value["outcome"]) ||
    !nullable(value["sqlstate"], (state) => typeof state === "string") ||
    !nonNegativeInteger(value["attempts"]) ||
    typeof value["manual"] !== "boolean"
  )
    throw new TypeError("Invalid database schedule run");
}

function assertUsageRow(value: unknown): asserts value is DatabaseExecutionUsageRow {
  if (
    !record(value) ||
    !exact(value, ["start", "end", "final", "metrics"]) ||
    !timestamp(value["start"]) ||
    !timestamp(value["end"]) ||
    typeof value["final"] !== "boolean" ||
    !record(value["metrics"]) ||
    !exact(value["metrics"], DATABASE_EXECUTION_METRICS)
  )
    throw new TypeError("Invalid database execution usage row");
  const metrics = value["metrics"];
  if (!DATABASE_EXECUTION_METRICS.every((metric) => nonNegativeInteger(metrics[metric])))
    throw new TypeError("Invalid database execution usage row");
}

function assertWebhookFields(value: Record<string, unknown>): void {
  if (
    !matches(value["id"], WEBHOOK_ID_PATTERN) ||
    !oneOf(["dev", "prod"] as const, value["environment"]) ||
    !isHttpsUrl(value["url"]) ||
    !Array.isArray(value["event_types"]) ||
    value["event_types"].length < 1 ||
    value["event_types"].length > DATABASE_WEBHOOK_MAX_EVENT_TYPES ||
    !value["event_types"].every((type) => oneOf(DATABASE_WEBHOOK_EVENT_TYPES, type)) ||
    !Array.isArray(value["header_names"]) ||
    value["header_names"].length > DATABASE_WEBHOOK_MAX_HEADERS ||
    !value["header_names"].every((name) => matches(name, HEADER_NAME_PATTERN)) ||
    !timestamp(value["created_at"])
  )
    throw new TypeError("Invalid database webhook");
}

function parseHttpsUrl(value: unknown): string {
  if (!isHttpsUrl(value)) throw new TypeError("Invalid database webhook url");
  return value;
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > DATABASE_WEBHOOK_URL_MAX_LENGTH) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function parseEventTypes(value: unknown): readonly DatabaseWebhookEventType[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > DATABASE_WEBHOOK_MAX_EVENT_TYPES ||
    !value.every((type) => oneOf(DATABASE_WEBHOOK_EVENT_TYPES, type)) ||
    new Set(value).size !== value.length
  )
    throw new TypeError("Invalid database webhook event types");
  return value as DatabaseWebhookEventType[];
}

function parseHeaders(value: unknown): Record<string, string> {
  if (
    !record(value) ||
    Object.keys(value).length > DATABASE_WEBHOOK_MAX_HEADERS ||
    new Set(Object.keys(value).map((name) => name.toLowerCase())).size !== Object.keys(value).length
  )
    throw new TypeError("Invalid database webhook headers");
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    const lower = name.toLowerCase();
    if (
      !HEADER_NAME_PATTERN.test(name) ||
      HEADER_FORBIDDEN_NAMES.includes(lower) ||
      HEADER_FORBIDDEN_PREFIXES.some((prefix) => lower.startsWith(prefix)) ||
      typeof headerValue !== "string" ||
      headerValue.length > 512 ||
      !HEADER_VALUE_PATTERN.test(headerValue)
    )
      throw new TypeError("Invalid database webhook headers");
    headers[name] = headerValue;
  }
  return headers;
}

function parseCron(value: unknown): string {
  if (!isCronText(value)) throw new TypeError("Invalid database schedule cron");
  return value;
}

function isCronText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= DATABASE_SCHEDULE_CRON_MIN_LENGTH &&
    value.length <= DATABASE_SCHEDULE_CRON_MAX_LENGTH
  );
}

function parseEverySeconds(value: unknown): number {
  if (!isEverySeconds(value)) throw new TypeError("Invalid database schedule interval");
  return value;
}

function isEverySeconds(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= DATABASE_SCHEDULE_MIN_EVERY_SECONDS &&
    (value as number) <= DATABASE_SCHEDULE_MAX_EVERY_SECONDS
  );
}

function parseTimeout(value: unknown): number {
  if (!isTimeout(value)) throw new TypeError("Invalid database schedule timeout");
  return value;
}

function isTimeout(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= DATABASE_SCHEDULE_MIN_TIMEOUT_MS &&
    (value as number) <= DATABASE_SCHEDULE_MAX_TIMEOUT_MS
  );
}

function parseStatements(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > DATABASE_SCHEDULE_MAX_STATEMENTS ||
    !value.every(
      (statement) =>
        typeof statement === "string" &&
        statement.trim().length > 0 &&
        !statement.includes("\0") &&
        new TextEncoder().encode(statement).byteLength <= DATABASE_SCHEDULE_STATEMENT_MAX_BYTES,
    ) ||
    new TextEncoder().encode(value.join("")).byteLength > DATABASE_SCHEDULE_STATEMENTS_MAX_BYTES
  )
    throw new TypeError("Invalid database schedule statements");
  return value as string[];
}

function isCursor(value: unknown): value is string {
  return matches(value, CURSOR_PATTERN);
}

function pageItems(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= DATABASE_PAGE_MAX_ITEMS;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function nullable(value: unknown, check: (value: unknown) => boolean): boolean {
  return value === null || check(value);
}

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && pattern.test(value);
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
