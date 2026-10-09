import { DatabaseMigrationAdmissionError } from "./database-migration-errors.js";

export interface MigrationSqlToken {
  readonly kind: "word" | "identifier" | "string" | "symbol";
  readonly value: string;
  readonly text: string;
}

export interface MigrationSqlStatement {
  readonly sql: string;
  readonly tokens: readonly MigrationSqlToken[];
}

/** SQL-aware boundaries only; PostgreSQL remains the expression parser. */
export function readMigrationSql(sql: string): readonly MigrationSqlStatement[] {
  const statements: MigrationSqlStatement[] = [];
  let tokens: MigrationSqlToken[] = [];
  let start = 0;
  let index = 0;
  while (index < sql.length) {
    const character = sql[index] ?? "";
    const next = sql[index + 1];
    if (/\s/u.test(character)) {
      index += 1;
      continue;
    }
    if (character === "-" && next === "-") {
      const newline = sql.indexOf("\n", index + 2);
      index = newline < 0 ? sql.length : newline + 1;
      continue;
    }
    if (character === "/" && next === "*") {
      index = skipBlockComment(sql, index + 2);
      continue;
    }
    if (character === ";") {
      if (tokens.length > 0) {
        statements.push(Object.freeze({ sql: sql.slice(start, index + 1).trim(), tokens }));
      }
      tokens = [];
      start = ++index;
      continue;
    }
    const tokenStart = index;
    let kind: MigrationSqlToken["kind"] = "symbol";
    let value = character;
    if (/[uU]/u.test(character) && next === "&" && /['"]/u.test(sql[index + 2] ?? "")) {
      // Unicode escapes can conceal reserved schema identifiers.
      throw new DatabaseMigrationAdmissionError("unsupported");
    }
    if (character === "'" || character === '"' || (/[eE]/u.test(character) && next === "'")) {
      const escaped = character !== "'" && character !== '"';
      const quote = character === '"' ? '"' : "'";
      const quoteStart = index + (escaped ? 1 : 0);
      index = skipQuoted(sql, quoteStart + 1, quote, escaped);
      kind = quote === '"' ? "identifier" : "string";
      value = sql.slice(quoteStart + 1, index - 1).replace(/""/gu, '"');
    } else if (character === "$" && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.test(sql.slice(index))) {
      const delimiter = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u.exec(sql.slice(index))?.[0] ?? "";
      const end = sql.indexOf(delimiter, index + delimiter.length);
      if (end < 0) throw new DatabaseMigrationAdmissionError("invalid");
      index = end + delimiter.length;
      kind = "string";
      value = sql.slice(tokenStart, index);
    } else if (/[\p{L}_]/u.test(character)) {
      index += 1;
      while (index < sql.length && /[\p{L}\p{N}_$]/u.test(sql[index] ?? "")) index += 1;
      kind = "word";
      value = sql.slice(tokenStart, index).toLowerCase();
    } else {
      index += 1;
    }
    tokens.push(Object.freeze({ kind, value, text: sql.slice(tokenStart, index) }));
  }
  if (tokens.length > 0) statements.push(Object.freeze({ sql: sql.slice(start).trim(), tokens }));
  return Object.freeze(statements);
}

function skipBlockComment(sql: string, index: number): number {
  let depth = 1;
  while (index < sql.length) {
    if (sql[index] === "/" && sql[index + 1] === "*") {
      depth += 1;
      index += 2;
    } else if (sql[index] === "*" && sql[index + 1] === "/") {
      depth -= 1;
      index += 2;
      if (depth === 0) return index;
    } else {
      index += 1;
    }
  }
  throw new DatabaseMigrationAdmissionError("invalid");
}

function skipQuoted(sql: string, index: number, quote: string, escaped: boolean): number {
  while (index < sql.length) {
    if (escaped && sql[index] === "\\") {
      index += 2;
    } else if (sql[index] === quote) {
      if (sql[index + 1] === quote) {
        index += 2;
      } else {
        const continuation = quote === "'" ? continuedStringStart(sql, index + 1) : undefined;
        if (continuation === undefined) return index + 1;
        // Keep the initial E-string's escape semantics in every continuation.
        index = continuation;
      }
    } else {
      index += 1;
    }
  }
  throw new DatabaseMigrationAdmissionError("invalid");
}

function continuedStringStart(sql: string, index: number): number | undefined {
  // Match PostgreSQL scan.l quotecontinue with a linear scan: at least one
  // newline, with line comments as whitespace. Block comments end continuation.
  let newline = false;
  while (index < sql.length) {
    const character = sql[index] ?? "";
    if (/[ \t\f\v\n\r]/u.test(character)) {
      newline ||= character === "\n" || character === "\r";
      index += 1;
    } else if (character === "-" && sql[index + 1] === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n" && sql[index] !== "\r") index += 1;
    } else {
      return character === "'" && newline ? index + 1 : undefined;
    }
  }
  return undefined;
}

export function isSqlKeyword(token: MigrationSqlToken | undefined, value: string): boolean {
  return token?.kind === "word" && token.value === value;
}

export function rejectMigrationSqlReferences(
  tokens: readonly MigrationSqlToken[],
  allowIdentityHelpers = false,
): void {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token?.kind !== "word" && token?.kind !== "identifier") continue;
    const value = token.value.toLowerCase();
    if (value === "ohmyhost") {
      if (
        allowIdentityHelpers &&
        token.value === "ohmyhost" &&
        tokens[index + 1]?.kind === "symbol" &&
        tokens[index + 1]?.value === "." &&
        ["user_id", "claims"].includes(tokens[index + 2]?.value ?? "") &&
        ["word", "identifier"].includes(tokens[index + 2]?.kind ?? "") &&
        tokens[index + 3]?.kind === "symbol" &&
        tokens[index + 3]?.value === "(" &&
        tokens[index + 4]?.kind === "symbol" &&
        tokens[index + 4]?.value === ")"
      )
        continue;
      throw new DatabaseMigrationAdmissionError("unsupported");
    }
    const portableAuthTable = tokens[index + 2];
    if (
      (value === "auth" &&
        tokens[index + 1]?.value === "." &&
        !(
          portableAuthTable?.kind === "identifier" &&
          ["account", "rateLimit", "ratelimit", "session", "user", "verification"].includes(
            portableAuthTable.value,
          )
        )) ||
      (value === "storage" && tokens[index + 1]?.value === ".") ||
      value === "supabase" ||
      ((value === "to" || value === "from") &&
        ["anon", "authenticated", "service_role"].includes(tokens[index + 1]?.value ?? ""))
    )
      throw new DatabaseMigrationAdmissionError("provider_specific");
  }
}
