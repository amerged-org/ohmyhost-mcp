import { randomUUID } from "node:crypto";
import { link, open, readFile, readdir, readlink, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** Who holds a login: enough to prove that the holder is gone, never enough to resume it. */
export interface OwnerIdentity {
  readonly host: string;
  /** The PID namespace; absent where this platform cannot name it. */
  readonly namespace: string | undefined;
  readonly pid: number;
  /** When the process started, in the platform's own unit; absent when it cannot be read. */
  readonly start: string | undefined;
}

export type OwnerState = "alive" | "gone" | "unknown";

export interface ProcessProbe {
  self(): Promise<OwnerIdentity>;
  /** `gone` only when the owner provably cannot resume: same host, same PID namespace, no process. */
  state(owner: OwnerIdentity): Promise<OwnerState>;
}

/** The login is held by a process that is still running, or whose fate cannot be read. */
export class LoginOwnershipTimeoutError extends Error {
  public constructor(
    /** The record that holds the login, relative to the login's directory. */
    readonly record: string,
  ) {
    super("The login is held by another process");
    this.name = "LoginOwnershipTimeoutError";
  }
}

/** Runs a cleanup step whose failure changes nothing: a leftover file is ignored by every reader. */
export const quietly = async (operation: Promise<unknown>): Promise<void> => {
  try {
    await operation;
  } catch {
    // Cleanup only.
  }
};

/** The value of a read that may legitimately fail, or `undefined`. */
const attempt = async <Value>(operation: Promise<Value>): Promise<Value | undefined> => {
  try {
    return await operation;
  } catch {
    return undefined;
  }
};

const RECORD = /^owner-([1-9][0-9]{0,14})\.json$/u;
const RELEASED = /^owner-([1-9][0-9]{0,14})\.released$/u;
const DEFAULT_POLL_MS = 100;

const recordName = (number: number): string => `owner-${String(number)}.json`;
const releasedName = (number: number): string => `owner-${String(number)}.released`;

/** The start time of a process in clock ticks since boot, or `undefined` when it does not exist. */
const linuxStartTime = async (pid: number): Promise<string | undefined> => {
  let stat: string;
  try {
    stat = await readFile(`/proc/${String(pid)}/stat`, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ESRCH") return undefined;
    throw error;
  }
  // The command name is in parentheses and may hold spaces; the start time is field 22.
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const start = fields[19];
  if (start === undefined || !/^[0-9]+$/u.test(start)) throw new Error("Unreadable process stat");
  return start;
};

/** Reads the host, PID namespace and start time that Linux exposes; other platforms never say `gone`. */
export const linuxProcessProbe = (): ProcessProbe => {
  const self = async (): Promise<OwnerIdentity> => {
    const namespace = await attempt(readlink("/proc/self/ns/pid"));
    const start = await attempt(linuxStartTime(process.pid));
    return { host: hostname(), namespace, pid: process.pid, start };
  };
  return {
    self,
    state: async (owner) => {
      const own = await self();
      if (
        owner.host !== own.host ||
        owner.namespace === undefined ||
        owner.namespace !== own.namespace ||
        owner.start === undefined
      )
        return "unknown";
      try {
        const start = await linuxStartTime(owner.pid);
        return start === owner.start ? "alive" : "gone";
      } catch {
        return "unknown";
      }
    },
  };
};

export interface LoginOwnershipOptions {
  readonly probe?: ProcessProbe;
  /** The longest a process waits to become the owner; the provider's request timeout. */
  readonly waitMs: number;
  readonly pollMs?: number;
}

export interface LoginOwnershipHold {
  /** The record that names this owner. */
  readonly record: string;
  release(): Promise<void>;
}

/**
 * One owner per login, as numbered records in the login's own directory. A process becomes the
 * owner by an exclusive hard link of the next number, so exactly one of any number of competitors
 * wins, and the highest number is the current record. A record never expires: an owner can hold a
 * renewed credential it has not saved yet, so only a process that provably cannot resume may be
 * replaced. A suspended owner therefore resumes as the owner and nothing it writes can overwrite a
 * later login. What is bounded is the wait, not the ownership.
 */
export class LoginOwnership {
  readonly #probe: ProcessProbe;
  readonly #waitMs: number;
  readonly #pollMs: number;

  public constructor(
    private readonly directory: string,
    options: LoginOwnershipOptions,
  ) {
    this.#probe = options.probe ?? linuxProcessProbe();
    this.#waitMs = options.waitMs;
    this.#pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  }

  public async acquire(signal?: AbortSignal): Promise<LoginOwnershipHold> {
    const self = await this.#probe.self();
    const deadline = Date.now() + this.#waitMs;
    for (;;) {
      signal?.throwIfAborted();
      const newest = await this.#newest();
      if (newest > 0) {
        const state = await this.#state(newest);
        // A record that is listed but cannot be read waits like a held one, so it never spins.
        if (state === "missing" && (await this.#listed(newest))) {
          if (Date.now() >= deadline) throw new LoginOwnershipTimeoutError(recordName(newest));
          await sleep(this.#pollMs);
          continue;
        }
        if (state === "missing") continue;
        if (state !== "released" && state !== "gone") {
          if (Date.now() >= deadline) throw new LoginOwnershipTimeoutError(recordName(newest));
          await sleep(this.#pollMs);
          continue;
        }
      }
      const candidate = newest + 1;
      if (await this.#claim(candidate, self)) {
        await this.#prune(candidate);
        return { record: recordName(candidate), release: () => this.#release(candidate) };
      }
      if (Date.now() >= deadline) throw new LoginOwnershipTimeoutError(recordName(candidate));
    }
  }

  /** Whether the current record is released, held by a gone process, or still held. */
  async #state(number: number): Promise<OwnerState | "released" | "missing"> {
    let serialized: string;
    try {
      serialized = await readFile(join(this.directory, recordName(number)), "utf8");
    } catch (error) {
      return errorCode(error) === "ENOENT" ? "missing" : "unknown";
    }
    const owner = parseOwner(serialized);
    if (owner === undefined) return "unknown";
    try {
      await readFile(join(this.directory, releasedName(number)));
      return "released";
    } catch (error) {
      if (errorCode(error) !== "ENOENT") return "unknown";
    }
    return await this.#probe.state(owner);
  }

  /** Links the next number; losing the race, or finding a newer record, means nothing was taken. */
  async #claim(number: number, self: OwnerIdentity): Promise<boolean> {
    const temporary = join(this.directory, `.owner-${randomUUID()}.tmp`);
    const target = join(this.directory, recordName(number));
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify({ version: 1, number, ...self }), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await link(temporary, target);
    } catch (error) {
      if (errorCode(error) === "EEXIST") return false;
      throw error;
    } finally {
      await quietly(unlink(temporary));
    }
    // A competitor delayed since its read can link a number that newer owners already pruned; it
    // is then not the current record, and its stale file is removed again.
    if ((await this.#newest()) === number) return true;
    await quietly(unlink(target));
    return false;
  }

  /** The owner of the highest number removes the lower ones; a failure leaves harmless leftovers. */
  async #prune(current: number): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return;
    }
    for (const name of names) {
      const number = Number((RECORD.exec(name) ?? RELEASED.exec(name))?.[1] ?? 0);
      if (number === 0 || number >= current) continue;
      await quietly(unlink(join(this.directory, name)));
    }
  }

  /** Whether the record's file is still listed although it could not be read. */
  async #listed(number: number): Promise<boolean> {
    try {
      return (await readdir(this.directory)).includes(recordName(number));
    } catch {
      return false;
    }
  }

  async #release(number: number): Promise<void> {
    // A full disk or a passing fault must not leave a live process holding the login for good.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const handle = await open(join(this.directory, releasedName(number)), "wx", 0o600);
        await handle.close();
        return;
      } catch (error) {
        if (errorCode(error) === "EEXIST") return;
        await sleep(this.#pollMs);
      }
    }
    // The record stays; this process still owns it until it exits, which a waiter can see.
  }

  async #newest(): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.directory);
    } catch {
      return 0;
    }
    return names.reduce((newest, name) => Math.max(newest, Number(RECORD.exec(name)?.[1] ?? 0)), 0);
  }
}

const parseOwner = (serialized: string): OwnerIdentity | undefined => {
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      typeof value !== "object" ||
      value === null ||
      !("host" in value) ||
      !("pid" in value) ||
      typeof value.host !== "string" ||
      typeof value.pid !== "number"
    )
      return undefined;
    const namespace = "namespace" in value ? value.namespace : undefined;
    const start = "start" in value ? value.start : undefined;
    return {
      host: value.host,
      namespace: typeof namespace === "string" ? namespace : undefined,
      pid: value.pid,
      start: typeof start === "string" ? start : undefined,
    };
  } catch {
    return undefined;
  }
};

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
