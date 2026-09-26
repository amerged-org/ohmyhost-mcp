import { spawn } from "node:child_process";

import { PsqlUnavailableError } from "./cli.js";

/**
 * Starts the customer's own psql against a temporary database credential.
 * The password reaches psql only through its private environment, never through
 * argv, the terminal title or any file; no authentication credential is involved.
 */
export const runLocalPsql = (input: {
  readonly host: string;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly signal: AbortSignal;
}): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const child = spawn("psql", ["-h", input.host, "-U", input.user, "-d", input.database], {
      stdio: "inherit",
      signal: input.signal,
      env: { ...process.env, PGPASSWORD: input.password, PGSSLMODE: "require" },
    });
    child.once("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ENOENT" ? new PsqlUnavailableError() : error);
    });
    child.once("close", (code, signalName) => {
      resolve(code ?? (signalName === null ? 1 : 130));
    });
  });
