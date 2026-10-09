import { DatabaseMigrationAdmissionError } from "./database-migration-errors.js";
import {
  isSqlKeyword,
  rejectMigrationSqlReferences,
  type MigrationSqlToken,
} from "./database-migration-lexical.js";

export interface DatabaseMigrationRlsTarget {
  readonly schema: "public" | "private";
  readonly table: string;
  readonly policy?: string;
  readonly action: "create" | "alter" | "drop" | "enable" | "force";
}

class PolicyReader {
  public position = 0;

  public constructor(private readonly tokens: readonly MigrationSqlToken[]) {}

  public take(keyword: string): boolean {
    if (!isSqlKeyword(this.tokens[this.position], keyword)) return false;
    this.position += 1;
    return true;
  }

  public expect(keyword: string): void {
    if (!this.take(keyword)) throw new DatabaseMigrationAdmissionError("unsupported");
  }

  public identifier(): string {
    const token = this.tokens[this.position++];
    if (
      (token?.kind !== "word" && token?.kind !== "identifier") ||
      token.value.length === 0 ||
      new TextEncoder().encode(token.value).byteLength > 63
    ) {
      throw new DatabaseMigrationAdmissionError("unsupported");
    }
    return token.value;
  }

  public target(): Readonly<{ schema: "public" | "private"; table: string }> {
    const schema = this.identifier();
    const separator = this.tokens[this.position++];
    if (
      (schema !== "public" && schema !== "private") ||
      separator?.kind !== "symbol" ||
      separator.value !== "."
    ) {
      throw new DatabaseMigrationAdmissionError("unsupported");
    }
    return { schema, table: this.identifier() };
  }

  public expression(): void {
    const opening = this.tokens[this.position++];
    if (opening?.kind !== "symbol" || opening.value !== "(")
      throw new DatabaseMigrationAdmissionError("invalid");
    const start = this.position;
    let depth = 1;
    while (this.position < this.tokens.length) {
      const token = this.tokens[this.position++];
      if (token?.kind !== "symbol") continue;
      if (token.value === "(") depth += 1;
      if (token.value === ")") depth -= 1;
      if (depth === 0) {
        if (this.position - 1 === start) throw new DatabaseMigrationAdmissionError("invalid");
        rejectMigrationSqlReferences(this.tokens.slice(start, this.position - 1), true);
        return;
      }
    }
    throw new DatabaseMigrationAdmissionError("invalid");
  }

  public end(): void {
    if (this.position !== this.tokens.length)
      throw new DatabaseMigrationAdmissionError("unsupported");
  }
}

export function readMigrationRlsTarget(
  tokens: readonly MigrationSqlToken[],
): DatabaseMigrationRlsTarget | undefined {
  const first = tokens[0]?.value;
  const policy =
    tokens[0]?.kind === "word" &&
    isSqlKeyword(tokens[1], "policy") &&
    ["create", "alter", "drop"].includes(first ?? "");
  const rls =
    isSqlKeyword(tokens[0], "alter") &&
    isSqlKeyword(tokens[1], "table") &&
    tokens.some(
      (token, index) =>
        isSqlKeyword(token, "row") &&
        isSqlKeyword(tokens[index + 1], "level") &&
        isSqlKeyword(tokens[index + 2], "security"),
    );
  if (!policy && !rls) return undefined;
  // Header and table identifiers must never use the reserved namespace. Helpers
  // are admitted separately, only inside balanced policy expressions.
  const reader = new PolicyReader(tokens);
  reader.position = 2;
  if (rls) {
    rejectMigrationSqlReferences(tokens);
    const target = reader.target();
    const action = reader.take("enable") ? "enable" : reader.take("force") ? "force" : undefined;
    if (action === undefined) throw new DatabaseMigrationAdmissionError("destructive");
    reader.expect("row");
    reader.expect("level");
    reader.expect("security");
    reader.end();
    return Object.freeze({ ...target, action });
  }
  if (first === "drop" && reader.take("if")) reader.expect("exists");
  const policyName = reader.identifier();
  reader.expect("on");
  const target = reader.target();
  rejectMigrationSqlReferences(tokens.slice(0, reader.position));
  if (first === "drop") {
    reader.take("restrict");
    reader.end();
    return Object.freeze({ ...target, policy: policyName, action: "drop" });
  }
  if (first === "create" && reader.take("as")) {
    if (!reader.take("permissive")) reader.expect("restrictive");
  }
  if (first === "create" && reader.take("for")) {
    if (!["all", "select", "insert", "update", "delete"].some((command) => reader.take(command))) {
      throw new DatabaseMigrationAdmissionError("unsupported");
    }
  }
  if (reader.take("to")) reader.expect("public");
  let expression = false;
  if (reader.take("using")) {
    reader.expression();
    expression = true;
  }
  if (reader.take("with")) {
    reader.expect("check");
    reader.expression();
    expression = true;
  }
  reader.end();
  if (first === "alter" && !expression) throw new DatabaseMigrationAdmissionError("unsupported");
  return Object.freeze({
    ...target,
    policy: policyName,
    action: first === "create" ? "create" : "alter",
  });
}
