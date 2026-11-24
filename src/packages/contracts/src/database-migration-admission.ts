import { isDatabaseWatchTriggerName } from "./database-events.js";
import { DatabaseMigrationAdmissionError } from "./database-migration-errors.js";
import {
  readMigrationCaptureTrigger,
  type DatabaseMigrationCaptureTrigger,
} from "./database-migration-capture.js";
import {
  isSqlKeyword,
  readMigrationSql,
  rejectMigrationSqlReferences,
  type MigrationSqlToken,
} from "./database-migration-lexical.js";
import {
  readMigrationRlsTarget,
  type DatabaseMigrationRlsTarget,
} from "./database-migration-policies.js";

import {
  readMigrationReplacement,
  type DatabaseMigrationReplacement,
} from "./database-migration-replacements.js";

export {
  readMigrationCreations,
  type DatabaseMigrationReplacement,
} from "./database-migration-replacements.js";
export { DatabaseMigrationAdmissionError } from "./database-migration-errors.js";
export type { DatabaseMigrationAdmissionReason } from "./database-migration-errors.js";
export type { DatabaseMigrationCaptureTrigger } from "./database-migration-capture.js";
export type { DatabaseMigrationRlsTarget } from "./database-migration-policies.js";

export const MAX_MIGRATION_COUNT = 128;
export const MAX_MIGRATION_BYTES = 256 * 1024;
export const MAX_MIGRATION_TOTAL_BYTES = 2 * 1024 * 1024;
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
  return admitMigrationsAfterAppliedPrefix(migrations, 0);
}

/**
 * Admits a bundle whose first `appliedCount` files are already proven applied by the immutable ledger. Every file keeps
 * the structural rules (count, ordered unique paths, sizes); only the pending files are parsed against the current SQL
 * policy. The caller must derive `appliedCount` from a ledger it has read under the migrations lock and matched
 * path-by-path and digest-by-digest against these files; the count itself proves nothing.
 */
export function admitMigrationsAfterAppliedPrefix(
  migrations: readonly DatabaseMigrationInput[],
  appliedCount: number,
): DatabaseMigrationAdmission {
  if (
    !Number.isSafeInteger(appliedCount) ||
    appliedCount < 0 ||
    (Array.isArray(migrations) && appliedCount > migrations.length)
  ) {
    throw new DatabaseMigrationAdmissionError("invalid");
  }
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
  const files = migrations.map((migration, index) => {
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
    // Its bytes are the ones the ledger digest proved applied; today's SQL policy never ran against them again.
    if (index < appliedCount) return Object.freeze({ path: migration.path, statementCount: 0 });
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
    // The watch service alone creates triggers under its reserved names, so the watch count stays exact.
    if (
      statements.some(
        (statement) =>
          statement.captureTrigger !== undefined &&
          isDatabaseWatchTriggerName(statement.captureTrigger.trigger),
      )
    ) {
      throw new DatabaseMigrationAdmissionError("unsupported");
    }
    statementCount += statements.length;
    return Object.freeze({ path: migration.path, statementCount: statements.length });
  });
  return Object.freeze({ files: Object.freeze(files), statementCount });
}

export const MAX_MIGRATION_REPLACEMENT_NOTES = 32;
const REPLACEMENT_NOTE = "Migration candidate replaces";
const REFUSAL_NOTE = "Migration file ";
const MORE_REPLACEMENTS = "Review the saved migration files for any further replacement targets.";

export function isMigrationReplacementNote(risk: string): boolean {
  return (
    risk.startsWith(REPLACEMENT_NOTE + " ") ||
    (risk.startsWith(REFUSAL_NOTE) && risk.includes(" is refused by current admission (")) ||
    risk === MORE_REPLACEMENTS
  );
}

/** Source-only preview. The executor verifies ownership and the applied prefix against the target database. */
export function describeMigrationReplacements(
  migrations: readonly DatabaseMigrationInput[],
): readonly string[] {
  const notes = new Set<string>();
  const owner = "(must be created by an earlier migration)";
  const quote = (name: string) => (/^[a-z_][a-z0-9_]*$/u.test(name) ? name : JSON.stringify(name));
  for (const { path, body } of migrations) {
    const fileNotes: string[] = [];
    try {
      for (const [index, { replacement }] of parseDatabaseMigrationStatements(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body),
      ).entries()) {
        if (replacement?.kind === "function") {
          const note = `${REPLACEMENT_NOTE} function ${quote(replacement.schema)}.${quote(replacement.name)}(${replacement.signature}) ${owner}.`;
          fileNotes.push(
            note.length <= 512
              ? note
              : `${note.slice(0, 350)}… See statement ${index + 1} in ${path.slice(-100)}.`,
          );
        } else if (replacement?.kind === "trigger" && replacement.action !== "drop") {
          fileNotes.push(
            `${REPLACEMENT_NOTE} trigger ${quote(replacement.name)} on ${quote(replacement.schema)}.${quote(replacement.table)} ${owner}.`,
          );
        }
      }
    } catch (error) {
      if (!(error instanceof DatabaseMigrationAdmissionError) && !(error instanceof TypeError))
        throw error;
      const reason = error instanceof DatabaseMigrationAdmissionError ? error.reason : "invalid";
      const detail = error instanceof DatabaseMigrationAdmissionError ? error.detail : undefined;
      const file = path.length > 300 ? `${path.slice(0, 299)}…` : path;
      fileNotes.push(
        `${REFUSAL_NOTE}${file} is refused by current admission (${reason})${detail === undefined ? "." : `: ${detail}.`}`,
      );
    }
    for (const note of fileNotes) {
      if (!notes.has(note) && notes.size === MAX_MIGRATION_REPLACEMENT_NOTES)
        return [...notes, MORE_REPLACEMENTS];
      notes.add(note);
    }
  }
  return [...notes];
}

export interface DatabaseMigrationStatement {
  readonly sql: string;
  readonly rlsTarget?: DatabaseMigrationRlsTarget;
  readonly captureTrigger?: DatabaseMigrationCaptureTrigger;
  readonly replacement?: DatabaseMigrationReplacement;
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
  let previous: DatabaseMigrationReplacement | undefined;
  const admitted = statements.map((statement) => {
    const classificationSql = statement.tokens.map((token) => token.text).join(" ");
    const replacement = readMigrationReplacement(statement.tokens, previous);
    if (
      previous?.kind === "trigger" &&
      previous.action === "drop" &&
      (replacement?.kind !== "trigger" ||
        replacement.action !== "recreate" ||
        replacement.schema !== previous.schema ||
        replacement.table !== previous.table ||
        replacement.name !== previous.name)
    ) {
      throw new DatabaseMigrationAdmissionError(
        "destructive",
        "immediately recreate the same dropped trigger in the same migration file",
      );
    }
    previous = replacement;
    if (replacement !== undefined) {
      rejectMigrationSqlReferences(statement.tokens);
      if (replacement.kind === "function") {
        admitFunction(statement.tokens, classificationSql);
      }
      return Object.freeze({ sql: statement.sql, replacement: Object.freeze(replacement) });
    }
    const capture = readMigrationCaptureTrigger(statement.tokens);
    if (capture !== undefined) {
      rejectMigrationSqlReferences(capture.header);
      return Object.freeze({ sql: statement.sql, captureTrigger: capture.target });
    }
    // Provider references are forbidden throughout executable policy SQL, while
    // the native helper exception is narrowed by the policy reader below.
    rejectMigrationSqlReferences(statement.tokens, true);
    const rlsTarget = readMigrationRlsTarget(statement.tokens);
    if (rlsTarget !== undefined) return Object.freeze({ sql: statement.sql, rlsTarget });
    rejectMigrationSqlReferences(statement.tokens);
    admitStatement(statement.tokens, classificationSql);
    return Object.freeze({ sql: statement.sql });
  });
  if (previous?.kind === "trigger" && previous.action === "drop") {
    throw new DatabaseMigrationAdmissionError(
      "destructive",
      "immediately recreate the same dropped trigger in the same migration file",
    );
  }
  return Object.freeze(admitted);
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

/**
 * A SECURITY DEFINER body runs with its definer's rights, so every `SET search_path` in the statement header must pin the
 * path to an empty list or one that starts with pg_catalog. A path the session can change, or one that starts with a
 * customer schema, lets the caller decide which relation or function the definer touches. The body is one dollar-quoted
 * token, so only the header can name a path, and a later SET overrides an earlier one: each occurrence must pin.
 */
function pinsSearchPath(tokens: readonly MigrationSqlToken[]): boolean {
  let found = false;
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    if (!isSqlKeyword(tokens[index], "set") || !isSqlKeyword(tokens[index + 1], "search_path"))
      continue;
    const operator = tokens[index + 2];
    const assigns =
      isSqlKeyword(operator, "to") || (operator?.kind === "symbol" && operator.value === "=");
    const first = tokens[index + 3];
    if (!assigns || !first) return false;
    found = true;
    if (first.kind === "string") {
      const list = first.value.trim().toLowerCase();
      if (list !== "" && !/^pg_catalog(?:\s*,|$)/u.test(list)) return false;
    } else if (first.kind === "word" || first.kind === "identifier") {
      if (first.value.toLowerCase() !== "pg_catalog") return false;
    } else return false;
  }
  return found;
}

/**
 * Joins the tokens with single spaces, except around a `.` symbol, so `public . t` reads `public.t`. Work stays linear
 * in the token count: a regex over the joined text would backtrack quadratically through a quoted identifier's spaces.
 */
function normalizeTokens(tokens: readonly MigrationSqlToken[]): string {
  let normalized = "";
  let afterDot = true;
  for (const token of tokens) {
    const isDot = token.kind === "symbol" && token.value === ".";
    if (!isDot && !afterDot) normalized += " ";
    normalized += token.kind === "string" ? "'literal'" : token.text.toLowerCase();
    afterDot = isDot;
  }
  return normalized;
}

/**
 * Recognises `ALTER TABLE [IF EXISTS] [ONLY] name ADD [COLUMN|CONSTRAINT] [IF NOT EXISTS] name ...` from the tokens, so a
 * quoted, punctuated or non-ASCII name is read as CREATE TABLE reads it. Only a top-level comma that starts another
 * action can change the statement, so every comma outside parentheses and brackets must be followed by ADD; a comma
 * inside them, such as the elements of ARRAY[...], belongs to an expression. Parentheses and brackets must nest, so a
 * stray, mismatched or unclosed one refuses the statement. The rest of the column definition is left to PostgreSQL,
 * as before.
 */
function readAdditiveAlterTable(tokens: readonly MigrationSqlToken[]): boolean {
  let index = 0;
  const take = (keyword: string): boolean => {
    if (!isSqlKeyword(tokens[index], keyword)) return false;
    index += 1;
    return true;
  };
  const takeName = (): boolean => {
    const token = tokens[index];
    if (token?.kind !== "word" && token?.kind !== "identifier") return false;
    index += 1;
    return true;
  };
  if (!take("alter") || !take("table")) return false;
  if (take("if") && !take("exists")) return false;
  take("only");
  if (!takeName()) return false;
  while (tokens[index]?.kind === "symbol" && tokens[index]?.value === ".") {
    index += 1;
    if (!takeName()) return false;
  }
  if (!take("add")) return false;
  if (!take("column")) take("constraint");
  if (take("if") && (!take("not") || !take("exists"))) return false;
  if (!takeName()) return false;
  const expectedClosers: string[] = [];
  for (; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "symbol") continue;
    if (token.value === "(") expectedClosers.push(")");
    else if (token.value === "[") expectedClosers.push("]");
    else if (token.value === ")" || token.value === "]") {
      if (expectedClosers.pop() !== token.value) return false;
    } else if (
      token.value === "," &&
      expectedClosers.length === 0 &&
      !isSqlKeyword(tokens[index + 1], "add")
    ) {
      return false;
    }
  }
  return expectedClosers.length === 0;
}

function admitFunction(tokens: readonly MigrationSqlToken[], sql: string): void {
  rejectFunctionBodyReferences(sql);
  const normalized = normalizeTokens(tokens);
  if (!/\blanguage\s+(?:sql|plpgsql)\b/u.test(normalized)) {
    throw new DatabaseMigrationAdmissionError("unsupported", "use LANGUAGE sql or plpgsql");
  }
  if (/\bsecurity\s+definer\b/u.test(normalized) && !pinsSearchPath(tokens)) {
    throw new DatabaseMigrationAdmissionError(
      "unsupported",
      "a SECURITY DEFINER function needs every SET search_path to be '' or to start with pg_catalog",
    );
  }
}

function admitStatement(tokens: readonly MigrationSqlToken[], sql: string): void {
  const normalized = normalizeTokens(tokens);
  if (normalized === "set check_function_bodies = false") return;
  if (/^create\s+function\b/u.test(normalized)) {
    admitFunction(tokens, sql);
    return;
  }
  if (
    /^create\s+schema\s+if\s+not\s+exists\s+(?:auth|extensions|private)$/u.test(normalized) ||
    /^create\s+extension\s+if\s+not\s+exists\s+(?:pgcrypto|btree_gist|unaccent)(?:\s+with\s+schema\s+extensions)?$/u.test(
      normalized,
    ) ||
    /^create\s+extension\s+if\s+not\s+exists\s+(?:pg_trgm|citext|ltree)\s+with\s+schema\s+extensions$/u.test(
      normalized,
    ) ||
    /^create\s+(?:table|type|domain|sequence|view|materialized\s+view|(?:constraint\s+)?trigger)\b/u.test(
      normalized,
    ) ||
    /^create\s+(?:unique\s+)?index\b/u.test(normalized) ||
    readAdditiveAlterTable(tokens) ||
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
