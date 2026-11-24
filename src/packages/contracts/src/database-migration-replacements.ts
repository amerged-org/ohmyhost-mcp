import { isDatabaseWatchTriggerName } from "./database-events.js";
import { DatabaseMigrationAdmissionError } from "./database-migration-errors.js";
import {
  isSqlKeyword,
  readMigrationSql,
  type MigrationSqlToken,
} from "./database-migration-lexical.js";

export type DatabaseMigrationReplacement =
  | Readonly<{ kind: "function"; schema: string; name: string; signature: string }>
  | Readonly<{
      kind: "trigger";
      schema: string;
      table: string;
      name: string;
      action: "replace" | "drop" | "recreate";
    }>;

function identifier(token: MigrationSqlToken | undefined): string {
  if (
    (token?.kind === "word" || token?.kind === "identifier") &&
    token.value.length > 0 &&
    !/[\p{Cc}\p{Cf}]/u.test(token.value)
  ) {
    // PostgreSQL folds ASCII uppercase in an unquoted UTF-8 identifier.
    return token.kind === "word"
      ? token.text.replace(/[A-Z]/gu, (letter) => letter.toLowerCase())
      : token.value;
  }
  throw new DatabaseMigrationAdmissionError(
    "unsupported",
    "use explicit, qualified replacement targets",
  );
}

function applicationName(tokens: readonly MigrationSqlToken[], start: number, unqualified = false) {
  if (unqualified && tokens[start + 1]?.value !== ".") {
    return { schema: "public", name: identifier(tokens[start]), end: start + 1 };
  }
  const schema = identifier(tokens[start]);
  if (
    tokens[start + 1]?.kind !== "symbol" ||
    tokens[start + 1]?.value !== "." ||
    (tokens[start + 3]?.kind === "symbol" && tokens[start + 3]?.value === ".") ||
    (schema !== "public" && schema !== "private")
  ) {
    throw new DatabaseMigrationAdmissionError(
      "unsupported",
      "use a schema-qualified application object",
    );
  }
  return { schema, name: identifier(tokens[start + 2]), end: start + 3 };
}

export function readMigrationReplacement(
  tokens: readonly MigrationSqlToken[],
  previous: DatabaseMigrationReplacement | undefined,
): DatabaseMigrationReplacement | undefined {
  const is = (index: number, keyword: string) => isSqlKeyword(tokens[index], keyword);
  const replace = is(0, "create") && is(1, "or") && is(2, "replace");
  if (replace && is(3, "function")) {
    const { schema, name, end } = applicationName(tokens, 4);
    if (
      tokens[7]?.kind !== "symbol" ||
      tokens[7]?.value !== "(" ||
      !tokens.some((_, index) => is(index, "as") && tokens[index + 1]?.kind === "string") ||
      tokens.some((_, index) => is(index, "security") && is(index + 1, "definer"))
    ) {
      throw new DatabaseMigrationAdmissionError(
        "unsupported",
        "replace only the quoted body of an existing SECURITY INVOKER SQL or PL/pgSQL function",
      );
    }
    return {
      kind: "function",
      schema,
      name,
      signature: functionParameters(tokens, end)
        .flatMap((parameter) =>
          inputType(parameter) === null ? [] : [renderDeclaration(parameter)],
        )
        .join(", "),
    };
  }
  if (is(0, "drop") && is(1, "trigger")) {
    if (
      !is(2, "if") ||
      !is(3, "exists") ||
      !is(5, "on") ||
      !(tokens.length === 9 || (tokens.length === 10 && is(9, "restrict")))
    ) {
      throw new DatabaseMigrationAdmissionError(
        "destructive",
        "use DROP TRIGGER IF EXISTS without CASCADE immediately followed by CREATE TRIGGER for the same target",
      );
    }
    return triggerTarget(tokens, 4, 5, "drop");
  }
  if (replace && is(3, "trigger")) {
    return triggerTarget(
      tokens,
      4,
      tokens.findIndex((_, index) => index > 4 && is(index, "on")),
      "replace",
    );
  }
  if (
    previous?.kind === "trigger" &&
    previous.action === "drop" &&
    is(0, "create") &&
    is(1, "trigger")
  ) {
    return triggerTarget(
      tokens,
      2,
      tokens.findIndex((_, index) => index > 2 && is(index, "on")),
      "recreate",
    );
  }
  return undefined;
}

function triggerTarget(
  tokens: readonly MigrationSqlToken[],
  start: number,
  on: number,
  action: "replace" | "drop" | "recreate",
): DatabaseMigrationReplacement {
  const name = identifier(tokens[start]);
  if (on <= start || isDatabaseWatchTriggerName(name)) {
    throw new DatabaseMigrationAdmissionError("unsupported", "use an existing application trigger");
  }
  const table = applicationName(tokens, on + 1);
  return { kind: "trigger", name, schema: table.schema, table: table.name, action };
}

/** Read the input declarations, excluding default expressions and OUT-only parameters. */
function functionParameters(tokens: readonly MigrationSqlToken[], start: number) {
  const inputs: MigrationSqlToken[][] = [];
  let declaration: MigrationSqlToken[] = [];
  let defaultValue = false;
  let depth = 0;
  for (let index = start + 1; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === undefined) break;
    if (depth === 0 && token.kind === "symbol" && (token.value === "," || token.value === ")")) {
      if (declaration.length > 0) inputs.push(declaration);
      if (token.value === ")") return inputs;
      declaration = [];
      defaultValue = false;
      continue;
    }
    if (
      depth === 0 &&
      ((token.kind === "symbol" && token.value === "=") || isSqlKeyword(token, "default"))
    ) {
      defaultValue = true;
    }
    if (!defaultValue) declaration.push(token);
    if (token.kind === "symbol") {
      if (token.value === "(" || token.value === "[") depth++;
      if (token.value === ")" || token.value === "]") depth--;
    }
  }
  throw new DatabaseMigrationAdmissionError("invalid", "use a complete function declaration");
}

function renderDeclaration(tokens: readonly MigrationSqlToken[]): string {
  return tokens
    .map((token, index) => {
      const previous = tokens[index - 1];
      const tight =
        (token.kind === "symbol" && ".,()[]".includes(token.value)) ||
        (previous?.kind === "symbol" &&
          (".([".includes(previous.value) ||
            (token.kind === "symbol" && /^[0-9]{2}$/u.test(previous.value + token.value))));
      return index === 0 || tight ? token.text : ` ${token.text}`;
    })
    .join("");
}

/** PostgreSQL resolves these source type names in the project database. */
type FunctionArgument = string | Readonly<{ table: string; column: string }>;

function inputType(parameter: readonly MigrationSqlToken[]): FunctionArgument | null {
  const type = [...parameter];
  const mode = type.findIndex(
    (token, index) =>
      index < 2 && ["in", "out", "inout", "variadic"].some((word) => isSqlKeyword(token, word)),
  );
  if (isSqlKeyword(type[mode], "out")) return null;
  if (mode >= 0) {
    const inOut = isSqlKeyword(type[mode], "in") && isSqlKeyword(type[mode + 1], "out");
    type.splice(mode, inOut ? 2 : 1);
  }

  // A second identifier starts the type after an argument name, except for PostgreSQL's
  // compound types and ARRAY suffix. Quoted identifiers never form compound keywords.
  const [first, second] = type;
  if (
    second?.kind === "identifier" ||
    (second?.kind === "word" &&
      second.value !== "array" &&
      !(
        first?.kind === "word" &&
        /^(?:double precision|(?:bit|char|character|nchar) varying|national (?:char|character)|(?:time|timestamp) (?:with|without)|interval (?:year|month|day|hour|minute|second))$/u.test(
          `${first.value} ${second.value}`,
        )
      ))
  ) {
    type.shift();
  }
  if (type.at(-2)?.value === "%" && isSqlKeyword(type.at(-1), "type")) {
    return { table: renderDeclaration(type.slice(0, -4)), column: identifier(type.at(-3)) };
  }

  // FLOAT(p) selects real or double precision. Ordinary type modifiers do not identify an overload.
  const open = type.findIndex((token) => token.kind === "symbol" && token.value === "(");
  if (open !== -1 && !isSqlKeyword(type[0], "float")) {
    const close = type.findLastIndex((token) => token.kind === "symbol" && token.value === ")");
    type.splice(open, close - open + 1);
  }
  return renderDeclaration(type);
}

type MigrationCreation =
  | Readonly<{ kind: "function"; schema: string; name: string; args: readonly FunctionArgument[] }>
  | Readonly<{ kind: "trigger"; schema: string; table: string; name: string }>;

/**
 * Plain CREATE declarations are evidence only from verified ledger files. Apply lexical rules
 * without today's admission policy, since an old applied file can fail today's policy.
 */
export function readMigrationCreations(sql: string): readonly MigrationCreation[] {
  const creations: MigrationCreation[] = [];
  let statements;
  try {
    statements = readMigrationSql(sql);
  } catch (error) {
    if (error instanceof DatabaseMigrationAdmissionError) return creations;
    throw error;
  }
  for (const { tokens } of statements) {
    if (!isSqlKeyword(tokens[0], "create")) continue;
    try {
      if (isSqlKeyword(tokens[1], "function")) {
        const { schema, name, end } = applicationName(tokens, 2, true);
        if (tokens[end]?.kind !== "symbol" || tokens[end]?.value !== "(") continue;
        const args = functionParameters(tokens, end)
          .map(inputType)
          .filter((type) => type !== null);
        creations.push({ kind: "function", schema, name, args });
      } else if (isSqlKeyword(tokens[1], "trigger")) {
        const on = tokens.findIndex((token, index) => index > 2 && isSqlKeyword(token, "on"));
        if (on < 0) continue;
        const table = applicationName(tokens, on + 1, true);
        creations.push({
          kind: "trigger",
          schema: table.schema,
          table: table.name,
          name: identifier(tokens[2]),
        });
      }
    } catch (error) {
      if (!(error instanceof DatabaseMigrationAdmissionError)) throw error;
      // A declaration outside our application schemas or unreadable by this lexer proves nothing.
    }
  }
  return creations;
}
