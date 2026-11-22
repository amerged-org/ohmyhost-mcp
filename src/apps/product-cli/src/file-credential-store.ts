import { randomUUID } from "node:crypto";
import { chmod, constants, lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { quietly } from "./login-ownership.js";
import {
  CredentialStoreUnavailableError,
  parseCredential,
  serializeCredential,
  type CredentialStore,
  type CurrentCredential,
  type StoredCredential,
} from "./credential-store.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
/** The credential file and every temporary file a writer may have left. */
const ARTIFACT = /^(?:credentials\.json|\.credentials(?:\..+)?\.next)$/u;

/** Why a file store is refused; the reasons are fixed so that no text depends on an error message. */
export type FileStoreRefusalReason =
  | "symbolic_link"
  | "another_owner"
  | "wrong_mode"
  | "not_writable";

/** A directory or file of the store is not the one this store may use; nothing was changed. */
export class FileCredentialStoreRefusedError extends CredentialStoreUnavailableError {
  public constructor(
    /** The refused path, relative to the home directory. */
    readonly path: string,
    readonly reason: FileStoreRefusalReason,
  ) {
    super();
    this.name = "FileCredentialStoreRefusedError";
  }
}

/** Where a store lives: which directories it owns and which it only requires to be safe. */
export interface FileCredentialStoreLocation {
  /** Directories above the store: the user's own, no symbolic link, not writable by others. */
  readonly ancestors?: readonly string[];
  /** The first directory the store owns; it and every directory below it have exactly mode 700. */
  readonly root?: string;
  /** Refusals name their path relative to this directory. */
  readonly home?: string;
}

export class OwnerOnlyFileCredentialStore implements CredentialStore {
  readonly #credentialPath: string;
  readonly #ancestors: readonly string[];
  readonly #owned: readonly string[];
  readonly #home: string | undefined;

  public constructor(
    private readonly directory: string,
    private readonly ownerId: number,
    location: FileCredentialStoreLocation = {},
  ) {
    this.#credentialPath = join(directory, "credentials.json");
    this.#ancestors = location.ancestors ?? [];
    this.#home = location.home;
    const root = location.root ?? directory;
    const below = relative(root, directory).split(sep).filter(Boolean);
    this.#owned = below.reduce<string[]>(
      (paths, segment) => [...paths, join(paths.at(-1) ?? root, segment)],
      [root],
    );
  }

  /** Creates the store's directories with their exact modes; refuses any that already differ. */
  public async prepare(): Promise<void> {
    try {
      await this.checkDirectories(true);
    } catch (error) {
      throw this.refused(error);
    }
  }

  public async read(): Promise<StoredCredential | undefined> {
    try {
      if (!(await this.checkDirectories(false))) return undefined;
      if (!(await this.validateFile())) return undefined;
      const handle = await open(this.#credentialPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const status = await handle.stat();
        this.assertOwnedStatus(this.#credentialPath, status, FILE_MODE, false);
        return parseCredential(await handle.readFile("utf8"));
      } finally {
        await handle.close();
      }
    } catch (error) {
      throw this.refused(error);
    }
  }

  public async replace(credential: CurrentCredential): Promise<void> {
    // Each writer has a temporary name of its own, so two writers never share or delete one.
    const temporaryPath = join(this.directory, `.credentials.${randomUUID()}.next`);
    try {
      await this.checkDirectories(true);
      await this.validateFile();
      const handle = await open(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        FILE_MODE,
      );
      try {
        await handle.writeFile(serializeCredential(credential), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.validateOwnedPath(temporaryPath, FILE_MODE, false);
      await rename(temporaryPath, this.#credentialPath);
      await this.syncDirectory();
      await this.validateOwnedPath(this.#credentialPath, FILE_MODE, false);
    } catch (error) {
      await quietly(unlink(temporaryPath));
      throw this.refused(error);
    }
  }

  public async clear(): Promise<void> {
    try {
      if (!(await this.checkDirectories(false))) return;
      let failed = false;
      for (const name of await readdir(this.directory)) {
        if (!ARTIFACT.test(name)) continue;
        try {
          await unlink(join(this.directory, name));
        } catch (error) {
          if (!isMissing(error)) failed = true;
        }
      }
      try {
        await this.syncDirectory();
      } catch {
        failed = true;
      }
      if ((await readdir(this.directory)).some((name) => ARTIFACT.test(name))) failed = true;
      if (failed) throw new Error("Credential artifact cleanup failed");
    } catch (error) {
      throw this.refused(error);
    }
  }

  /** `false` when a directory is missing and none may be created. */
  private async checkDirectories(create: boolean): Promise<boolean> {
    for (const path of this.#ancestors) {
      const status = await this.statDirectory(path, create);
      if (status === undefined) return false;
      if (status.isSymbolicLink()) throw this.refusal(path, "symbolic_link");
      if (!status.isDirectory()) throw this.refusal(path, "wrong_mode");
      if (status.uid !== this.ownerId) throw this.refusal(path, "another_owner");
      if ((status.mode & 0o022) !== 0) throw this.refusal(path, "wrong_mode");
    }
    for (const path of this.#owned) {
      const status = await this.statDirectory(path, create, true);
      if (status === undefined) return false;
      this.assertOwnedStatus(path, status, DIRECTORY_MODE, true);
    }
    return true;
  }

  private async statDirectory(path: string, create: boolean, exact = false) {
    try {
      return await lstat(path);
    } catch (error) {
      if (!isMissing(error)) throw error;
      if (!create) return undefined;
    }
    try {
      await mkdir(path, { mode: DIRECTORY_MODE });
      // The process umask cannot widen a mode, but it can narrow one; the store's own directories
      // have exactly 700.
      if (exact) await chmod(path, DIRECTORY_MODE);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }
    return await lstat(path);
  }

  private async validateFile(): Promise<boolean> {
    try {
      await this.validateOwnedPath(this.#credentialPath, FILE_MODE, false);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  private async validateOwnedPath(path: string, mode: number, directory: boolean): Promise<void> {
    this.assertOwnedStatus(path, await lstat(path), mode, directory);
  }

  private assertOwnedStatus(
    path: string,
    status: Awaited<ReturnType<typeof lstat>>,
    mode: number,
    directory: boolean,
  ): void {
    if (status.isSymbolicLink()) throw this.refusal(path, "symbolic_link");
    if (directory ? !status.isDirectory() : !status.isFile())
      throw this.refusal(path, "wrong_mode");
    if (status.uid !== this.ownerId) throw this.refusal(path, "another_owner");
    if ((Number(status.mode) & 0o777) !== mode) throw this.refusal(path, "wrong_mode");
  }

  private refusal(path: string, reason: FileStoreRefusalReason): FileCredentialStoreRefusedError {
    return new FileCredentialStoreRefusedError(
      this.#home === undefined ? path : relative(this.#home, path),
      reason,
    );
  }

  /** A refusal keeps its path and reason; a denied write names the directory it could not use. */
  private refused(error: unknown): CredentialStoreUnavailableError {
    if (error instanceof CredentialStoreUnavailableError) return error;
    const code = errorCode(error);
    if (code === "EACCES" || code === "EPERM" || code === "EROFS")
      return this.refusal(this.directory, "not_writable");
    return new CredentialStoreUnavailableError();
  }

  private async syncDirectory(): Promise<void> {
    const handle = await open(dirname(this.#credentialPath), constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

const errorCode = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;

const isMissing = (error: unknown): boolean => errorCode(error) === "ENOENT";
