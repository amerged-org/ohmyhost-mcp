import { DatabaseMigrationAdmissionError } from "./database-migration-errors.js";
import {
  readMigrationSql,
  rejectMigrationSqlReferences,
  type MigrationSqlToken,
} from "./database-migration-lexical.js";
import {
  readMigrationRlsTarget,
  type DatabaseMigrationRlsTarget,
} from "./database-migration-policies.js";

export { DatabaseMigrationAdmissionError } from "./database-migration-errors.js";
export type { DatabaseMigrationAdmissionReason } from "./database-migration-errors.js";
export type { DatabaseMigrationRlsTarget } from "./database-migration-policies.js";

const MAX_MIGRATION_COUNT = 128;
const MAX_MIGRATION_BYTES = 256 * 1024;
const MAX_MIGRATION_TOTAL_BYTES = 2 * 1024 * 1024;
const MIGRATION_PATH = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*\d{14}_[a-z0-9][a-z0-9_-]*\.sql$/u;

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
    const statements = parseDatabaseMigrationStatements(sql);
    statementCount += statements.length;
    return Object.freeze({ path: migration.path, statementCount: statements.length });
  });
  return Object.freeze({ files: Object.freeze(files), statementCount });
}

export interface DatabaseMigrationStatement {
  readonly sql: string;
  readonly rlsTarget?: DatabaseMigrationRlsTarget;
}

export function parseDatabaseMigrationStatements(
  sql: string,
): readonly DatabaseMigrationStatement[] {
  if (
    sql.length === 0 ||
    sql.includes("\0") ||
    sql.includes("\r") ||
    sql.charCodeAt(0) === 0xfeff
  ) {
    throw new DatabaseMigrationAdmissionError("invalid");
  }
  const statements = readMigrationSql(sql);
  if (statements.length === 0) throw new DatabaseMigrationAdmissionError("invalid");
  return Object.freeze(
    statements.map((statement) => {
      // Provider references are forbidden throughout executable policy SQL, while
      // the native helper exception is narrowed by the policy reader below.
      rejectMigrationSqlReferences(statement.tokens, true);
      const rlsTarget = readMigrationRlsTarget(statement.tokens);
      if (rlsTarget !== undefined) return Object.freeze({ sql: statement.sql, rlsTarget });
      rejectMigrationSqlReferences(statement.tokens);
      admitStatement(statement.tokens, statement.sql);
      return Object.freeze({ sql: statement.sql });
    }),
  );
}

function rejectFunctionBodyReferences(sql: string): void {
  if (
    /\bohmyhost\b|\brow\s+level\s+security\b|\b(?:create|alter|drop)\s+policy\b|\bu&['"]/iu.test(
      sql,
    )
  ) {
    throw new DatabaseMigrationAdmissionError("unsupported");
  }
  const normalized = sql.toLowerCase();
  const withoutPortableAuth = normalized.replace(
    /(?:\bauth|"auth")\s*\.\s*"(?:account|ratelimit|session|user|verification)"/gu,
    "",
  );
  if (
    /(?:\bauth|"auth")\s*\./u.test(withoutPortableAuth) ||
    /(?:\bstorage|"storage")\s*\./u.test(normalized) ||
    /\b(?:to|from)\s+(?:anon|authenticated|service_role)\b/u.test(normalized) ||
    /\bsupabase\b/u.test(normalized)
  ) {
    throw new DatabaseMigrationAdmissionError("provider_specific");
  }
}

function admitStatement(tokens: readonly MigrationSqlToken[], sql: string): void {
  const normalized = tokens
    .map((token) => (token.kind === "string" ? "'literal'" : token.text.toLowerCase()))
    .join(" ")
    .replace(/\s*\.\s*/gu, ".");
  if (normalized === "set check_function_bodies = false") return;
  if (/^create\s+function\b/u.test(normalized)) {
    rejectFunctionBodyReferences(sql);
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
