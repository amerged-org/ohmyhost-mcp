import { constants, lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { parseEnv, promisify } from "node:util";
import {
  parseUserApiKeyCreation,
  type UserApiKey,
  type UserApiKeyCreation,
} from "@ohmyhost/contracts/user-api-keys";

export interface StoredUserApiKey {
  request_id: string;
  key: UserApiKey;
  token_file: string;
}
export class UserTokenFileError extends Error {
  constructor(
    readonly code:
      | "token_file_not_ignored"
      | "token_file_unsafe"
      | "token_file_has_token"
      | "token_file_changed"
      | "token_value_unavailable",
    readonly keyId?: string,
  ) {
    super(tokenFileAction(code, keyId));
  }
}

/** What to do next; once a key was issued, the answer names it so it can be revoked. */
const tokenFileAction = (code: UserTokenFileError["code"], keyId: string | undefined): string => {
  switch (code) {
    case "token_file_not_ignored":
      return "Add the selected env file to .gitignore or choose a location outside the repository. No token was created or written.";
    case "token_file_unsafe":
      return "Choose an env file whose name starts or ends with .env, for example .env.local: a regular file you own, not a symlink or hard link, at most 64 KiB.";
    case "token_file_has_token":
      return "The selected file already contains OHMYHOST_TOKEN. Use that token or choose a new file; existing credentials were preserved.";
    case "token_file_changed":
      return keyId === undefined
        ? "The env file changed while it was being read; no key was issued. Run the same command again."
        : `The env file changed while the token was being saved, so its value may not be in the file; key ${keyId} was issued. Revoke it with 'ohmyhost token revoke --organization ULID --key ${keyId} --yes --json' (MCP token_revoke), then create a new one with a new idempotency key.`;
    case "token_value_unavailable":
      return `A key was already issued for this idempotency key, and its value is shown only once. Use the file it was saved to, or revoke key ${String(keyId)} (ohmyhost token revoke, MCP token_revoke) and create a replacement with a new idempotency key.`;
  }
};

/** Prepare before the API call; append only OHMYHOST_TOKEN and never return its value to a chat. */
export async function prepareUserTokenFile(output: string) {
  const path = resolve(output);
  if (!basename(path).startsWith(".env") && !basename(path).endsWith(".env"))
    throw new UserTokenFileError("token_file_unsafe");
  let file: FileHandle | undefined;
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await requireIgnoredTokenFile(path);
    const existing = await lstat(path).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    });
    if (existing && (!existing.isFile() || existing.isSymbolicLink() || existing.nlink !== 1))
      throw new UserTokenFileError("token_file_unsafe");
    file = await open(
      path,
      constants.O_RDWR |
        constants.O_APPEND |
        (constants.O_NOFOLLOW ?? 0) |
        (existing ? 0 : constants.O_CREAT | constants.O_EXCL),
      0o600,
    );
    const handle = file;
    await secureTokenFile(path, handle);
    const initial = await tokenFileText(handle);
    if (parseEnv(initial)["OHMYHOST_TOKEN"]) throw new UserTokenFileError("token_file_has_token");
    const preview = "sk_ohmyho_token_preview_only";
    if (parseEnv(`${initial}\nOHMYHOST_TOKEN=${preview}\n`)["OHMYHOST_TOKEN"] !== preview)
      throw new UserTokenFileError("token_file_unsafe");
    const identity = await handle.stat();
    return {
      async save(value: UserApiKeyCreation): Promise<StoredUserApiKey> {
        const result = parseUserApiKeyCreation(value);
        if (result.value === null)
          throw new UserTokenFileError("token_value_unavailable", result.key.id);
        try {
          const current = await lstat(path);
          if (
            !current.isFile() ||
            current.isSymbolicLink() ||
            current.nlink !== 1 ||
            current.ino !== identity.ino ||
            current.dev !== identity.dev ||
            (await tokenFileText(handle)) !== initial
          )
            throw new UserTokenFileError("token_file_changed");
          await handle.appendFile(`\nOHMYHOST_TOKEN=${result.value}\n`, "utf8");
          await handle.sync();
          if (parseEnv(await tokenFileText(handle))["OHMYHOST_TOKEN"] !== result.value)
            throw new UserTokenFileError("token_file_changed");
          const saved = await lstat(path);
          if (
            !saved.isFile() ||
            saved.isSymbolicLink() ||
            saved.ino !== identity.ino ||
            saved.dev !== identity.dev
          )
            throw new UserTokenFileError("token_file_changed");
        } catch {
          // The file was checked before the key was issued, so any refusal now means it changed,
          // and the answer names the issued key so it can be revoked.
          throw new UserTokenFileError("token_file_changed", result.key.id);
        }
        return { request_id: result.request_id, key: result.key, token_file: path };
      },
      close: () => handle.close(),
    };
  } catch (error) {
    await file?.close();
    if (error instanceof UserTokenFileError) throw error;
    throw new UserTokenFileError("token_file_unsafe");
  }
}

async function tokenFileText(file: FileHandle) {
  const status = await file.stat();
  if (!status.isFile() || status.nlink !== 1 || status.size > 65_536)
    throw new UserTokenFileError("token_file_unsafe");
  const bytes = Buffer.alloc(status.size);
  const result = await file.read(bytes, 0, bytes.length, 0);
  if (result.bytesRead !== bytes.length) throw new UserTokenFileError("token_file_changed");
  return new TextDecoder("utf8", { fatal: true }).decode(bytes);
}

const windowsAcl = String.raw`
$ErrorActionPreference = 'Stop'
$path = $env:OMH_TOKEN_FILE
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$current = Get-Acl -LiteralPath $path
if ($current.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $sid.Value) { throw 'Unexpected owner' }
$acl = New-Object System.Security.AccessControl.FileSecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Object -TypeName System.Security.AccessControl.FileSystemAccessRule -ArgumentList @($sid, 'FullControl', 'Allow')))
$system = New-Object -TypeName System.Security.Principal.SecurityIdentifier -ArgumentList 'S-1-5-18'
$acl.AddAccessRule((New-Object -TypeName System.Security.AccessControl.FileSystemAccessRule -ArgumentList @($system, 'FullControl', 'Allow')))
Set-Acl -LiteralPath $path -AclObject $acl
$verified = Get-Acl -LiteralPath $path
$rules = @($verified.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]))
if (-not $verified.AreAccessRulesProtected -or $rules.Count -ne 2) { throw 'Unexpected access rules' }
foreach ($rule in $rules) {
  if ($rule.IdentityReference.Value -notin @($sid.Value, 'S-1-5-18') -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne 'FullControl') { throw 'Unexpected access rule' }
}
[Console]::Write('secured')
`;

async function secureTokenFile(path: string, file: FileHandle) {
  const status = await file.stat();
  if (process.platform === "win32") {
    const environment: Record<string, string> = { OMH_TOKEN_FILE: path };
    for (const name of ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "USERPROFILE"]) {
      const value = process.env[name];
      if (value !== undefined) environment[name] = value;
    }
    const result = await promisify(execFile)(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(windowsAcl, "utf16le").toString("base64"),
      ],
      { env: environment, timeout: 10_000, windowsHide: true, maxBuffer: 4096 },
    );
    if (result.stdout !== "secured") throw new UserTokenFileError("token_file_unsafe");
  } else {
    if (status.uid !== process.getuid?.()) throw new UserTokenFileError("token_file_unsafe");
    await file.chmod(0o600);
    if (((await file.stat()).mode & 0o777) !== 0o600)
      throw new UserTokenFileError("token_file_unsafe");
  }
  const observed = await lstat(path);
  if (observed.isSymbolicLink() || observed.ino !== status.ino || observed.dev !== status.dev)
    throw new UserTokenFileError("token_file_unsafe");
}

async function requireIgnoredTokenFile(path: string) {
  const parent = await realpath(dirname(path));
  let directory = parent;
  while (true) {
    const marker = await lstat(resolve(directory, ".git")).catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    });
    if (marker !== null) {
      const environment: Record<string, string> = {};
      for (const name of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "TEMP", "TMP"]) {
        const value = process.env[name];
        if (value !== undefined) environment[name] = value;
      }
      try {
        await promisify(execFile)(
          "git",
          [
            "-c",
            "core.fsmonitor=false",
            "-C",
            parent,
            "check-ignore",
            "--quiet",
            "--",
            resolve(parent, basename(path)),
          ],
          { env: environment, timeout: 5000, windowsHide: true, maxBuffer: 4096 },
        );
      } catch {
        throw new UserTokenFileError("token_file_not_ignored");
      }
      return;
    }
    const next = dirname(directory);
    if (next === directory) return;
    directory = next;
  }
}
