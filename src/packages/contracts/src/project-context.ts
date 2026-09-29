export interface ProjectNotesReceipt {
  readonly version: number;
  readonly updated_at: string;
}
export interface ProjectContext {
  readonly project_id: string;
  readonly generated_at: string;
  readonly credit_access: "included" | "not_authorized";
  readonly notes: {
    readonly version: number;
    readonly markdown: string;
    readonly updated_at: string | null;
  };
  readonly markdown: string;
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const timestamp = (v: unknown): v is string =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const version = (v: unknown) => Number.isInteger(v) && Number(v) >= 0 && Number(v) <= 2147483647;
const bounded = (v: unknown, lines: number, bytes: number): v is string =>
  typeof v === "string" &&
  !/[\r\u2028\u2029]/u.test(v) &&
  !/\p{Cc}/u.test(v.replace(/[\n\t]/gu, "")) &&
  v.split("\n").length <= lines &&
  new TextEncoder().encode(v).length <= bytes;
export function assertProjectNotesReceipt(v: unknown): asserts v is ProjectNotesReceipt {
  if (
    !record(v) ||
    Object.keys(v).sort().join(",") !== "updated_at,version" ||
    !version(v["version"]) ||
    v["version"] === 0 ||
    !timestamp(v["updated_at"])
  )
    throw new TypeError("Invalid project notes receipt");
}
export function assertProjectContext(v: unknown): asserts v is ProjectContext {
  if (
    !record(v) ||
    Object.keys(v).sort().join(",") !== "credit_access,generated_at,markdown,notes,project_id" ||
    typeof v["project_id"] !== "string" ||
    !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(v["project_id"]) ||
    !timestamp(v["generated_at"]) ||
    !["included", "not_authorized"].includes(String(v["credit_access"])) ||
    !bounded(v["markdown"], 500, 32768)
  )
    throw new TypeError("Invalid project context");
  const notes = v["notes"];
  if (
    !record(notes) ||
    Object.keys(notes).sort().join(",") !== "markdown,updated_at,version" ||
    !version(notes["version"]) ||
    !bounded(notes["markdown"], 250, 16384) ||
    (notes["version"] === 0
      ? notes["updated_at"] !== null || notes["markdown"] !== ""
      : !timestamp(notes["updated_at"]))
  )
    throw new TypeError("Invalid project notes");
}
