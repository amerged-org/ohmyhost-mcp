import { spawn } from "node:child_process";
import { startBridge } from "@ohmyhost/postgres-bridge";

import { PsqlUnavailableError } from "./cli.js";

/** A psql still running this long after SIGTERM is killed, so a stuck session cannot keep its bridge and credential open. */
const KILL_AFTER_TERMINATE_MS = 5_000;

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
      // The command's AbortSignal is not handed to psql. On a terminal, Ctrl-C reaches psql itself because psql shares
      // this process group, so it cancels a query or leaves its prompt; this process only keeps listening. Without a
      // terminal a SIGINT sent to this process is forwarded. A termination or hangup ends psql, and with it the session.
      const child = spawn("psql", ["-h", bridge.host, "-U", input.user, "-d", input.database], {
        stdio: "inherit",
        env: {
          ...environment,
          PGPASSWORD: input.password,
          PGSSLMODE: "disable",
          PGPORT: String(bridge.port),
          PGCHANNELBINDING: "disable",
          PGGSSENCMODE: "disable",
        },
      });
      let killer: NodeJS.Timeout | undefined;
      const forwardInterrupt = (): void => {
        child.kill("SIGINT");
      };
      // A terminal's Ctrl-C is already psql's interrupt, so forwarding it would interrupt psql twice.
      const keepAlive = (): void => undefined;
      const interrupt = process.stdin.isTTY ? keepAlive : forwardInterrupt;
      const terminate = (): void => {
        child.kill("SIGTERM");
        killer ??= setTimeout(() => {
          child.kill("SIGKILL");
        }, KILL_AFTER_TERMINATE_MS);
      };
      const release = (): void => {
        clearTimeout(killer);
        process.off("SIGINT", interrupt);
        process.off("SIGTERM", terminate);
        process.off("SIGHUP", terminate);
      };
      process.on("SIGINT", interrupt);
      process.on("SIGTERM", terminate);
      // A hangup ends the terminal's session; the same orderly end keeps the bridge closing in its finally block.
      process.on("SIGHUP", terminate);
      child.once("error", (error: NodeJS.ErrnoException) => {
        release();
        reject(error.code === "ENOENT" ? new PsqlUnavailableError() : error);
      });
      child.once("close", (code, signalName) => {
        release();
        resolve(code ?? (signalName === null ? 1 : 130));
      });
    });
  } finally {
    await bridge.close();
  }
};
