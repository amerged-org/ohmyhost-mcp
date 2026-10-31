import { spawn } from "node:child_process";
import { startBridge } from "@ohmyhost/postgres-bridge";

import { PsqlUnavailableError } from "./cli.js";

/** One private loopback bridge lasts exactly as long as the customer's native psql session. */
export const runLocalPsql = async (input: {
  readonly host: string;
  readonly user: string;
  readonly password: string;
  readonly database: string;
  readonly websocketUrl: string;
  readonly signal: AbortSignal;
}): Promise<number> => {
  input.signal.throwIfAborted();
  if (input.websocketUrl !== `wss://${input.host}/`) throw new Error("Invalid PGCF transport");
  const bridge = await startBridge({
    endpoint: input.websocketUrl,
    database: input.database,
    user: input.user,
    port: 0,
  });
  try {
    input.signal.throwIfAborted();
    // A caller's libpq service/hostaddr settings must not redirect this temporary credential.
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^PG[A-Z_]+$/iu.test(key)),
    );
    return await new Promise<number>((resolve, reject) => {
      const child = spawn("psql", ["-h", bridge.host, "-U", input.user, "-d", input.database], {
        stdio: "inherit",
        signal: input.signal,
        env: {
          ...environment,
          PGPASSWORD: input.password,
          PGSSLMODE: "disable",
          PGPORT: String(bridge.port),
          PGCHANNELBINDING: "disable",
          PGGSSENCMODE: "disable",
        },
      });
      child.once("error", (error: NodeJS.ErrnoException) => {
        reject(error.code === "ENOENT" ? new PsqlUnavailableError() : error);
      });
      child.once("close", (code, signalName) => {
        resolve(code ?? (signalName === null ? 1 : 130));
      });
    });
  } finally {
    await bridge.close();
  }
};
