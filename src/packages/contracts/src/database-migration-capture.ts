import {
  DATABASE_WATCH_MAX_COLUMNS,
  DATABASE_WATCH_OPERATIONS,
  isDatabaseWatchIdentifier,
  isDatabaseWatchSchema,
  type DatabaseWatchOperation,
} from "./database-events.js";
import { DatabaseMigrationAdmissionError } from "./database-migration-errors.js";
import { isSqlKeyword, type MigrationSqlToken } from "./database-migration-lexical.js";

export interface DatabaseMigrationCaptureTrigger {
  readonly trigger: string;
  readonly schema: string;
  readonly table: string;
  readonly operations: readonly DatabaseWatchOperation[];
  readonly columns: readonly string[];
}

export interface MigrationCaptureStatement {
  readonly target: DatabaseMigrationCaptureTrigger;
  /** The tokens before the pgcf.capture function name, which still pass the ordinary references check. */
  readonly header: readonly MigrationSqlToken[];
}

const MAX_NAME_BYTES = 63;

/**
 * Reads the one trigger form PGCF admits on an existing table:
 * CREATE TRIGGER name AFTER INSERT [OR UPDATE] [OR DELETE] ON schema.table FOR EACH ROW
 * EXECUTE FUNCTION pgcf.capture('column', ...). Returns undefined for every statement that does not
 * name pgcf, so ordinary triggers keep their existing admission. Anything else that names pgcf throws.
 */
export function readMigrationCaptureTrigger(
  tokens: readonly MigrationSqlToken[],
): MigrationCaptureStatement | undefined {
  if (!isSqlKeyword(tokens[0], "create") || !isSqlKeyword(tokens[1], "trigger")) return undefined;
  if (!tokens.some((token) => isNamedPgcf(token, true))) return undefined;
  return new CaptureReader(tokens).read();
}

class CaptureReader {
  private position = 2;

  public constructor(private readonly tokens: readonly MigrationSqlToken[]) {}

  public read(): MigrationCaptureStatement {
    const trigger = this.triggerName();
    this.expectKeyword("after");
    const operations = this.operations();
    this.expectKeyword("on");
    const schema = this.name();
    this.expectSymbol(".");
    const table = this.name();
    if (!isDatabaseWatchSchema(schema)) throw unsupported();
    for (const keyword of ["for", "each", "row", "execute", "function"]) {
      this.expectKeyword(keyword);
    }
    const header = this.tokens.slice(0, this.position);
    if (!isNamedPgcf(this.token(), false)) throw unsupported();
    this.position += 1;
    this.expectSymbol(".");
    this.expectCapture();
    this.expectSymbol("(");
    const columns = this.columns();
    this.expectSymbol(")");
    if (this.position !== this.tokens.length) throw unsupported();
    return Object.freeze({
      target: Object.freeze({ trigger, schema, table, operations, columns }),
      header,
    });
  }

  private triggerName(): string {
    const token = this.token();
    if (
      (token.kind !== "word" && token.kind !== "identifier") ||
      !isDatabaseWatchIdentifier(token.value)
    ) {
      throw unsupported();
    }
    this.position += 1;
    return token.value;
  }

  /** Table and schema names may be quoted identifiers; the executor checks the catalog for the exact name. */
  private name(): string {
    const token = this.token();
    const valid =
      token.kind === "word"
        ? isDatabaseWatchIdentifier(token.value)
        : token.kind === "identifier" && isQuotedName(token.value);
    if (!valid) throw unsupported();
    this.position += 1;
    return token.value;
  }

  private operations(): readonly DatabaseWatchOperation[] {
    const events: DatabaseWatchOperation[] = [];
    do {
      const token = this.token();
      const operation = DATABASE_WATCH_OPERATIONS.find((name) => isSqlKeyword(token, name));
      if (operation === undefined || events.includes(operation)) throw unsupported();
      this.position += 1;
      events.push(operation);
    } while (this.takeKeyword("or"));
    return DATABASE_WATCH_OPERATIONS.filter((operation) => events.includes(operation));
  }

  private expectCapture(): void {
    const token = this.token();
    if ((token.kind !== "word" && token.kind !== "identifier") || token.value !== "capture") {
      throw unsupported();
    }
    this.position += 1;
  }

  private columns(): readonly string[] {
    const columns: string[] = [];
    do {
      const token = this.token();
      if (
        columns.length >= DATABASE_WATCH_MAX_COLUMNS ||
        token.kind !== "string" ||
        token.text !== `'${token.value}'` ||
        !isDatabaseWatchIdentifier(token.value) ||
        columns.includes(token.value)
      ) {
        throw unsupported();
      }
      this.position += 1;
      columns.push(token.value);
    } while (this.takeSymbol(","));
    return columns;
  }

  private token(): MigrationSqlToken {
    const token = this.tokens[this.position];
    if (token === undefined) throw unsupported();
    return token;
  }

  private takeKeyword(keyword: string): boolean {
    if (!isSqlKeyword(this.tokens[this.position], keyword)) return false;
    this.position += 1;
    return true;
  }

  private expectKeyword(keyword: string): void {
    if (!this.takeKeyword(keyword)) throw unsupported();
  }

  private takeSymbol(symbol: string): boolean {
    const token = this.tokens[this.position];
    if (token?.kind !== "symbol" || token.value !== symbol) return false;
    this.position += 1;
    return true;
  }

  private expectSymbol(symbol: string): void {
    if (!this.takeSymbol(symbol)) throw unsupported();
  }
}

/** The gate ignores case; the function name itself must be exactly pgcf, so "PGCF" is refused later. */
function isNamedPgcf(token: MigrationSqlToken, ignoreCase: boolean): boolean {
  if (token.kind !== "word" && token.kind !== "identifier") return false;
  return ignoreCase ? token.value.toLowerCase() === "pgcf" : token.value === "pgcf";
}

function isQuotedName(value: string): boolean {
  const bytes = new TextEncoder().encode(value).byteLength;
  return bytes >= 1 && bytes <= MAX_NAME_BYTES;
}

function unsupported(): DatabaseMigrationAdmissionError {
  return new DatabaseMigrationAdmissionError("unsupported");
}
