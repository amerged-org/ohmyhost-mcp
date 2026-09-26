const MAX_MIGRATION_COUNT = 128;
const MAX_MIGRATION_BYTES = 256 * 1024;
const MAX_MIGRATION_TOTAL_BYTES = 2 * 1024 * 1024;
const MIGRATION_PATH = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*\d{14}_[a-z0-9][a-z0-9_-]*\.sql$/u;

export type DatabaseMigrationAdmissionReason =
  | "destructive"
  | "invalid"
  | "provider_specific"
  | "unsupported";

export class DatabaseMigrationAdmissionError extends Error {
  public readonly code = "database_migration_not_admitted";

  public constructor(public readonly reason: DatabaseMigrationAdmissionReason) {
    super("Database migration is not admitted");
    this.name = "DatabaseMigrationAdmissionError";
  }
}

export interface DatabaseMigrationInput {
  readonly path: string;
  readonly body: Uint8Array;
}

export interface DatabaseMigrationAdmission {
  readonly files: readonly Readonly<{ path: string; statementCount: number }>[];
  readonly statementCount: number;
}

export function admitExpandOnlyMigrations(
  migrations: readonly DatabaseMigrationInput[],
): DatabaseMigrationAdmission {
  if (
    !Array.isArray(migrations) ||
    migrations.length === 0 ||
    migrations.length > MAX_MIGRATION_COUNT
  ) {
    throw new DatabaseMigrationAdmissionError("invalid");
  }
  let previousPath = "";
  let totalBytes = 0;
  let statementCount = 0;
  const files = migrations.map((migration) => {
    if (
      typeof migration !== "object" ||
      migration === null ||
      !MIGRATION_PATH.test(migration.path) ||
      migration.path <= previousPath ||
      !(migration.body instanceof Uint8Array) ||
      migration.body.byteLength === 0 ||
      migration.body.byteLength > MAX_MIGRATION_BYTES
    ) {
      throw new DatabaseMigrationAdmissionError("invalid");
    }
    previousPath = migration.path;
    totalBytes += migration.body.byteLength;
    if (totalBytes > MAX_MIGRATION_TOTAL_BYTES || migration.body.includes(0)) {
      throw new DatabaseMigrationAdmissionError("invalid");
    }
    let sql: string;
    try {
      sql = new TextDecoder("utf-8", { fatal: true }).decode(migration.body);
    } catch {
      throw new DatabaseMigrationAdmissionError("invalid");
    }
    if (sql.length === 0 || sql.includes("\r") || sql.charCodeAt(0) === 0xfeff) {
      throw new DatabaseMigrationAdmissionError("invalid");
    }
    if (/\bohmyhost\b/iu.test(sql)) throw new DatabaseMigrationAdmissionError("unsupported");
    rejectProviderSpecificSql(sql);
    const statements = splitSqlStatements(sql);
    if (statements.length === 0) throw new DatabaseMigrationAdmissionError("invalid");
    for (const statement of statements) admitStatement(statement);
    statementCount += statements.length;
    return Object.freeze({ path: migration.path, statementCount: statements.length });
  });
  return Object.freeze({ files: Object.freeze(files), statementCount });
}

function rejectProviderSpecificSql(sql: string): void {
  const normalized = sql.toLowerCase();
  const withoutPortableAuth = normalized.replace(
    /\bauth\s*\.\s*"(?:account|ratelimit|session|user|verification)"/gu,
    "",
  );
  if (
    /\bauth\s*\./u.test(withoutPortableAuth) ||
    /\bstorage\s*\./u.test(normalized) ||
    /\b(?:to|from)\s+(?:anon|authenticated|service_role)\b/u.test(normalized) ||
    /\bcreate\s+policy\b/u.test(normalized) ||
    /\brow\s+level\s+security\b/u.test(normalized) ||
    /\bsupabase\b/u.test(normalized)
  ) {
    throw new DatabaseMigrationAdmissionError("provider_specific");
  }
}

function splitSqlStatements(sql: string): readonly string[] {
  const statements: string[] = [];
  let start = 0;
  let index = 0;
  while (index < sql.length) {
    const character = sql[index];
    const next = sql[index + 1];
    if (character === "-" && next === "-") {
      index = skipLineComment(sql, index + 2);
      continue;
    }
    if (character === "/" && next === "*") {
      index = skipBlockComment(sql, index + 2);
      continue;
    }
    if (character === "'") {
      index = skipQuoted(sql, index + 1, "'");
      continue;
    }
    if (character === '"') {
      index = skipQuoted(sql, index + 1, '"');
      continue;
    }
    if (character === "$") {
      const delimiter = dollarDelimiter(sql, index);
      if (delimiter !== null) {
        const end = sql.indexOf(delimiter, index + delimiter.length);
        if (end < 0) throw new DatabaseMigrationAdmissionError("invalid");
        index = end + delimiter.length;
        continue;
      }
    }
    if (character === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement.length > 0) statements.push(statement);
      start = index + 1;
    }
    index += 1;
  }
  const tail = sql.slice(start).trim();
  if (tail.length > 0) statements.push(tail);
  return Object.freeze(statements);
}

function skipLineComment(sql: string, index: number): number {
  const newline = sql.indexOf("\n", index);
  return newline < 0 ? sql.length : newline + 1;
}

function skipBlockComment(sql: string, index: number): number {
  let depth = 1;
  while (index < sql.length) {
    if (sql[index] === "/" && sql[index + 1] === "*") {
      depth += 1;
      index += 2;
      continue;
    }
    if (sql[index] === "*" && sql[index + 1] === "/") {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
      continue;
    }
    index += 1;
  }
  throw new DatabaseMigrationAdmissionError("invalid");
}

function skipQuoted(sql: string, index: number, quote: "'" | '"'): number {
  while (index < sql.length) {
    if (sql[index] !== quote) {
      index += 1;
      continue;
    }
    if (sql[index + 1] === quote) {
      index += 2;
      continue;
    }
    return index + 1;
  }
  throw new DatabaseMigrationAdmissionError("invalid");
}

function dollarDelimiter(sql: string, index: number): string | null {
  const match = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(index));
  return match?.[0] ?? null;
}

function admitStatement(statement: string): void {
  const normalized = normalizeStatement(statement);
  if (normalized === "set check_function_bodies = false") return;
  if (/^create\s+function\b/u.test(normalized)) {
    if (
      !/\blanguage\s+(?:sql|plpgsql)\b/u.test(normalized) ||
      (/\bsecurity\s+definer\b/u.test(normalized) &&
        !/\bset\s+search_path\s*(?:=\s*|to\s+)/u.test(normalized))
    ) {
      throw new DatabaseMigrationAdmissionError("unsupported");
    }
    return;
  }
  if (
    /^create\s+schema\s+if\s+not\s+exists\s+(?:auth|extensions|private)$/u.test(normalized) ||
    /^create\s+extension\s+if\s+not\s+exists\s+(?:pgcrypto|btree_gist|unaccent)(?:\s+with\s+schema\s+extensions)?$/u.test(
      normalized,
    ) ||
    /^create\s+(?:table|type|domain|sequence|view|materialized\s+view|(?:constraint\s+)?trigger)\b/u.test(
      normalized,
    ) ||
    /^create\s+(?:unique\s+)?index\b/u.test(normalized) ||
    /^alter\s+table\s+(?:only\s+)?[a-z0-9_."]+\s+add\s+(?:(?:column|constraint)\s+)?(?:if\s+not\s+exists\s+)?[a-z0-9_"]+/u.test(
      normalized,
    ) ||
    /^comment\s+on\b/u.test(normalized)
  ) {
    if (/^create\s+or\s+replace\b/u.test(normalized)) {
      throw new DatabaseMigrationAdmissionError("destructive");
    }
    return;
  }
  if (/^(?:drop|truncate|delete|update|insert|begin|commit|rollback)\b/u.test(normalized)) {
    throw new DatabaseMigrationAdmissionError("destructive");
  }
  if (/^alter\s+table\b/u.test(normalized) || /^create\s+or\s+replace\b/u.test(normalized)) {
    throw new DatabaseMigrationAdmissionError("destructive");
  }
  throw new DatabaseMigrationAdmissionError("unsupported");
}

function normalizeStatement(statement: string): string {
  return statement
    .replace(/--[^\n]*(?:\n|$)/gu, " ")
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .trim()
    .replace(/\s+/gu, " ")
    .toLowerCase();
}
