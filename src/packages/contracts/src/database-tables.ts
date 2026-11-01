/** Column types a created table may declare; the closed list keeps type text out of the DDL. */
export const DATABASE_TABLE_COLUMN_TYPES = [
  "text",
  "integer",
  "bigint",
  "boolean",
  "numeric",
  "double precision",
  "timestamptz",
  "date",
  "uuid",
  "jsonb",
] as const;
export type DatabaseTableColumnType = (typeof DATABASE_TABLE_COLUMN_TYPES)[number];
/** `now` is DEFAULT now() on timestamptz; `uuid` is DEFAULT gen_random_uuid() on uuid. */
export const DATABASE_TABLE_DEFAULTS = ["now", "uuid"] as const;
export type DatabaseTableDefault = (typeof DATABASE_TABLE_DEFAULTS)[number];
export const DATABASE_TABLE_MAX_COLUMNS = 64;
export const DATABASE_TABLE_MAX_PRIMARY_KEY_COLUMNS = 8;
/** Ordinary and partitioned tables that a database may hold in its public schema. */
export const DATABASE_TABLE_LIMIT = 100;
export const DATABASE_TABLE_SCHEMA = "public";

const DATABASE_TABLE_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/u;
/** PostgreSQL reserved words: a table or column of such a name would need quoting everywhere it is used. */
const RESERVED_WORDS: ReadonlySet<string> = new Set([
  "all",
  "analyse",
  "analyze",
  "and",
  "any",
  "array",
  "as",
  "asc",
  "asymmetric",
  "both",
  "case",
  "cast",
  "check",
  "collate",
  "column",
  "constraint",
  "create",
  "current_catalog",
  "current_date",
  "current_role",
  "current_time",
  "current_timestamp",
  "current_user",
  "default",
  "deferrable",
  "desc",
  "distinct",
  "do",
  "else",
  "end",
  "except",
  "false",
  "fetch",
  "for",
  "foreign",
  "from",
  "grant",
  "group",
  "having",
  "in",
  "initially",
  "intersect",
  "into",
  "lateral",
  "leading",
  "limit",
  "localtime",
  "localtimestamp",
  "not",
  "null",
  "offset",
  "on",
  "only",
  "or",
  "order",
  "placing",
  "primary",
  "references",
  "returning",
  "select",
  "session_user",
  "some",
  "symmetric",
  "table",
  "then",
  "to",
  "trailing",
  "true",
  "union",
  "unique",
  "user",
  "using",
  "variadic",
  "when",
  "where",
  "window",
  "with",
]);

export interface DatabaseTableColumn {
  readonly name: string;
  readonly type: DatabaseTableColumnType;
  readonly nullable: boolean;
  readonly identity: boolean;
  readonly default: DatabaseTableDefault | null;
}

/** A create request after parsing: nullable is concrete and primaryKey is empty when the request names none. */
export interface DatabaseTableRequest {
  readonly table: string;
  readonly columns: readonly DatabaseTableColumn[];
  readonly primaryKey: readonly string[];
}

export interface DatabaseTable {
  readonly schema: typeof DATABASE_TABLE_SCHEMA;
  readonly table: string;
  readonly columns: readonly DatabaseTableColumn[];
  readonly primaryKey: readonly string[];
}

export interface DatabaseTableCreated {
  readonly table: DatabaseTable;
  readonly created: boolean;
}

interface ColumnInput {
  readonly name: string;
  readonly type: DatabaseTableColumnType;
  readonly nullable: boolean | undefined;
  readonly identity: boolean;
  readonly default: DatabaseTableDefault | null;
}

/** Identifiers are plain lower-case SQL names; the renderer quotes them and no other caller text reaches the DDL. */
export function isDatabaseTableIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    DATABASE_TABLE_IDENTIFIER_PATTERN.test(value) &&
    !value.startsWith("pg_") &&
    !RESERVED_WORDS.has(value)
  );
}

export function parseDatabaseTableCreateRequest(value: unknown): DatabaseTableRequest {
  if (
    !record(value) ||
    !onlyKeys(value, ["table", "columns", "primaryKey"]) ||
    !isDatabaseTableIdentifier(value["table"]) ||
    !Array.isArray(value["columns"]) ||
    value["columns"].length < 1 ||
    value["columns"].length > DATABASE_TABLE_MAX_COLUMNS
  )
    throw new TypeError("Invalid database table request");
  const inputs = value["columns"].map(parseColumn);
  const names = inputs.map((column) => column.name);
  if (new Set(names).size !== names.length || inputs.filter((column) => column.identity).length > 1)
    throw new TypeError("Invalid database table request");
  const primaryKey = parsePrimaryKey(value["primaryKey"], names);
  return {
    table: value["table"],
    columns: inputs.map((column) => completeColumn(column, primaryKey.includes(column.name))),
    primaryKey,
  };
}

/**
 * The one CREATE TABLE statement of a request, in the public schema. Identifiers are validated again here, so the
 * renderer is safe for any caller; the statement has no trailing semicolon.
 */
export function renderCreateTableStatement(request: DatabaseTableRequest): string {
  const definitions = request.columns.map(renderColumn);
  if (request.primaryKey.length > 0)
    definitions.push(`PRIMARY KEY (${request.primaryKey.map(quoted).join(",")})`);
  return `CREATE TABLE ${databaseTableReference(request.table)} (${definitions.join(", ")})`;
}

/** The quoted, schema-qualified name of a table of the public schema, as SQL statements use it. */
export function databaseTableReference(table: string): string {
  return `${quoted(DATABASE_TABLE_SCHEMA)}.${quoted(table)}`;
}

export function assertDatabaseTableCreated(value: unknown): asserts value is DatabaseTableCreated {
  if (
    !record(value) ||
    !exact(value, ["table", "created"]) ||
    typeof value["created"] !== "boolean" ||
    !isDatabaseTable(value["table"])
  )
    throw new TypeError("Invalid database table");
}

function parseColumn(value: unknown): ColumnInput {
  if (
    !record(value) ||
    !onlyKeys(value, ["name", "type", "nullable", "identity", "default"]) ||
    !isDatabaseTableIdentifier(value["name"]) ||
    !oneOf(DATABASE_TABLE_COLUMN_TYPES, value["type"]) ||
    (value["nullable"] !== undefined && typeof value["nullable"] !== "boolean") ||
    (value["identity"] !== undefined && typeof value["identity"] !== "boolean") ||
    (value["default"] !== undefined && !oneOf(DATABASE_TABLE_DEFAULTS, value["default"]))
  )
    throw new TypeError("Invalid database table request");
  const type = value["type"];
  const identity = value["identity"] === true;
  const defaultValue = value["default"] ?? null;
  if (identity && type !== "integer" && type !== "bigint")
    throw new TypeError("Invalid database table request");
  if (identity && defaultValue !== null) throw new TypeError("Invalid database table request");
  if (defaultValue === "now" && type !== "timestamptz")
    throw new TypeError("Invalid database table request");
  if (defaultValue === "uuid" && type !== "uuid")
    throw new TypeError("Invalid database table request");
  return {
    name: value["name"],
    type,
    nullable: value["nullable"],
    identity,
    default: defaultValue,
  };
}

function parsePrimaryKey(value: unknown, names: readonly string[]): readonly string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > DATABASE_TABLE_MAX_PRIMARY_KEY_COLUMNS ||
    new Set(value).size !== value.length ||
    !value.every((name) => typeof name === "string" && names.includes(name))
  )
    throw new TypeError("Invalid database table request");
  return value as string[];
}

/** Identity and primary key columns are NOT NULL; asking for a nullable one of them is a contradiction. */
function completeColumn(column: ColumnInput, keyed: boolean): DatabaseTableColumn {
  const required = column.identity || keyed;
  if (required && column.nullable === true) throw new TypeError("Invalid database table request");
  return {
    name: column.name,
    type: column.type,
    nullable: required ? false : (column.nullable ?? true),
    identity: column.identity,
    default: column.default,
  };
}

function renderColumn(column: DatabaseTableColumn): string {
  if (!oneOf(DATABASE_TABLE_COLUMN_TYPES, column.type))
    throw new TypeError("Invalid database table column type");
  const parts = [quoted(column.name), column.type];
  if (!column.nullable) parts.push("NOT NULL");
  if (column.identity) parts.push("GENERATED ALWAYS AS IDENTITY");
  if (column.default === "now") parts.push("DEFAULT now()");
  if (column.default === "uuid") parts.push("DEFAULT gen_random_uuid()");
  return parts.join(" ");
}

function quoted(identifier: string): string {
  if (!isDatabaseTableIdentifier(identifier))
    throw new TypeError("Invalid database table identifier");
  return `"${identifier}"`;
}

function isDatabaseTable(value: unknown): boolean {
  if (!record(value) || !exact(value, ["schema", "table", "columns", "primaryKey"])) return false;
  const columns = value["columns"];
  const primaryKey = value["primaryKey"];
  if (
    value["schema"] !== DATABASE_TABLE_SCHEMA ||
    !isDatabaseTableIdentifier(value["table"]) ||
    !Array.isArray(columns) ||
    columns.length < 1 ||
    columns.length > DATABASE_TABLE_MAX_COLUMNS ||
    !columns.every(isDatabaseTableColumn) ||
    !Array.isArray(primaryKey) ||
    primaryKey.length > DATABASE_TABLE_MAX_PRIMARY_KEY_COLUMNS
  )
    return false;
  const names = columns.map((column) => column.name);
  return primaryKey.every((name) => typeof name === "string" && names.includes(name));
}

function isDatabaseTableColumn(value: unknown): value is DatabaseTableColumn {
  return (
    record(value) &&
    exact(value, ["name", "type", "nullable", "identity", "default"]) &&
    isDatabaseTableIdentifier(value["name"]) &&
    oneOf(DATABASE_TABLE_COLUMN_TYPES, value["type"]) &&
    typeof value["nullable"] === "boolean" &&
    typeof value["identity"] === "boolean" &&
    (value["default"] === null || oneOf(DATABASE_TABLE_DEFAULTS, value["default"]))
  );
}

function oneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
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
