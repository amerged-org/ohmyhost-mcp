/** The environments a migration job can apply to, and the request that names the saved version and its environment. */
export type DatabaseMigrateEnvironment = "dev" | "prod";

export interface DatabaseMigrateRequest {
  readonly environment: DatabaseMigrateEnvironment;
  /** The saved version whose migration files are applied; the commit `source_changes` returned. */
  readonly commitSha: string;
}

/** `confirm` must be the literal true: the user chose where the tables are created. Anything else is not a request. */
export function parseDatabaseMigrateRequest(value: unknown): DatabaseMigrateRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid database migration request");
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).sort().join(",") !== "commit_sha,confirm,environment" ||
    input["confirm"] !== true ||
    (input["environment"] !== "dev" && input["environment"] !== "prod") ||
    typeof input["commit_sha"] !== "string" ||
    !/^(?!0{40}$)[0-9a-f]{40}$/u.test(input["commit_sha"])
  )
    throw new TypeError("Invalid database migration request");
  return { environment: input["environment"], commitSha: input["commit_sha"] };
}

/**
 * One digest of a saved version's migration files: each file's path and the SHA-256 of its content (lowercase hex),
 * in path order. A preview records it for the files it declares, a migration job for the files it applied, so equal
 * digests mean the same names with the same contents.
 */
export async function migrationFilesSha256(
  files: readonly { readonly path: string; readonly sha256: string }[],
): Promise<string> {
  const listing = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => `${file.path}\n${file.sha256}\n`)
    .join("");
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(listing)),
  );
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
