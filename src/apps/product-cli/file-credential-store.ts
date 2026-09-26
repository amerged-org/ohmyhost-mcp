import { constants, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

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

export class OwnerOnlyFileCredentialStore implements CredentialStore {
  readonly #credentialPath: string;
  readonly #temporaryPath: string;

  public constructor(
    private readonly directory: string,
    private readonly ownerId: number,
  ) {
    this.#credentialPath = join(directory, "credentials.json");
    this.#temporaryPath = join(directory, ".credentials.next");
  }

  public async read(): Promise<StoredCredential | undefined> {
    try {
      await this.ensureDirectory();
      await this.recoverTemporary();
      if (!(await this.validateFile())) return undefined;
      const handle = await open(this.#credentialPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const status = await handle.stat();
        this.assertOwnedStatus(status, FILE_MODE, false);
        return parseCredential(await handle.readFile("utf8"));
      } finally {
        await handle.close();
      }
    } catch {
      throw new CredentialStoreUnavailableError();
    }
  }

  public async replace(credential: CurrentCredential): Promise<void> {
    try {
      await this.ensureDirectory();
      await this.recoverTemporary();
      await this.validateFile();
      const handle = await open(
        this.#temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        FILE_MODE,
      );
      try {
        await handle.writeFile(serializeCredential(credential), "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.validateOwnedPath(this.#temporaryPath, FILE_MODE, false);
      await rename(this.#temporaryPath, this.#credentialPath);
      await this.syncDirectory();
      await this.validateOwnedPath(this.#credentialPath, FILE_MODE, false);
    } catch {
      await unlink(this.#temporaryPath).catch(() => undefined);
      throw new CredentialStoreUnavailableError();
    }
  }

  public async clear(): Promise<void> {
    try {
      await this.ensureDirectory();
      let failed = false;
      for (const path of [this.#credentialPath, this.#temporaryPath]) {
        try {
          await unlink(path);
        } catch (error) {
          if (!isMissing(error)) failed = true;
        }
      }
      try {
        await this.syncDirectory();
      } catch {
        failed = true;
      }
      for (const path of [this.#credentialPath, this.#temporaryPath]) {
        try {
          await lstat(path);
          failed = true;
        } catch (error) {
          if (!isMissing(error)) failed = true;
        }
      }
      if (failed) throw new Error("Credential artifact cleanup failed");
    } catch {
      throw new CredentialStoreUnavailableError();
    }
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { mode: DIRECTORY_MODE, recursive: true });
    await this.validateOwnedPath(this.directory, DIRECTORY_MODE, true);
  }

  private async recoverTemporary(): Promise<void> {
    try {
      const status = await lstat(this.#temporaryPath);
      const invalid =
        status.isSymbolicLink() ||
        !status.isFile() ||
        status.uid !== this.ownerId ||
        (status.mode & 0o777) !== FILE_MODE;
      await unlink(this.#temporaryPath);
      await this.syncDirectory();
      if (invalid) throw new Error("Temporary credential artifact was invalid");
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
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
    const status = await lstat(path);
    if (status.isSymbolicLink()) {
      throw new Error("Credential path ownership or mode is invalid");
    }
    this.assertOwnedStatus(status, mode, directory);
  }

  private assertOwnedStatus(
    status: Awaited<ReturnType<typeof lstat>>,
    mode: number,
    directory: boolean,
  ): void {
    if (
      (directory ? !status.isDirectory() : !status.isFile()) ||
      status.uid !== this.ownerId ||
      (Number(status.mode) & 0o777) !== mode
    ) {
      throw new Error("Credential path ownership or mode is invalid");
    }
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

const isMissing = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
