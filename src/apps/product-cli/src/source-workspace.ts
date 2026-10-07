import { createHash } from "node:crypto";
import { constants, promises as fs, type BigIntStats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import ignore from "ignore";
import git from "isomorphic-git";
import { isManagedSourcePath } from "@ohmyhost/contracts/managed-sources";

export const SOURCE_SNAPSHOT_LIMITS = Object.freeze({
  totalBytes: 8 * 1024 * 1024,
  fileBytes: 2 * 1024 * 1024,
  files: 2000,
});
const MAXIMUM_SCAN_ENTRIES = 20_000;
const MAXIMUM_DEPTH = 64;
const MAXIMUM_GIT_METADATA_BYTES = 64 * 1024;

export interface SourceWorkspaceRemote {
  readonly name: string;
  /** Credentials, query strings, fragments and local filesystem remotes are never returned. */
  readonly url: string | null;
  readonly githubRepository: string | null;
}

export interface SourceWorkspace {
  readonly directory: string;
  readonly repositoryRoot: string | null;
  readonly applicationRoot: string;
  readonly git: {
    readonly head: string | null;
    readonly branch: string | null;
    readonly upstreamRemote: string | null;
    readonly pushRemote: string | null;
    readonly remotes: readonly SourceWorkspaceRemote[];
  } | null;
}

export interface SourceSnapshotFile {
  readonly path: string;
  readonly contentBase64: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly executable: boolean;
}

export interface SourceSnapshot {
  readonly sha256: string;
  readonly totalBytes: number;
  readonly files: readonly SourceSnapshotFile[];
}

type SourceWorkspaceErrorCode =
  | "source_directory_invalid"
  | "source_directory_ignored"
  | "source_git_invalid"
  | "source_path_invalid"
  | "source_symlink_forbidden"
  | "source_file_too_large"
  | "source_snapshot_too_large"
  | "source_too_many_files"
  | "source_scan_limit"
  | "source_snapshot_changed"
  | "source_read_failed";

const ERROR_MESSAGES: Record<SourceWorkspaceErrorCode, string> = {
  source_directory_invalid: "Select an existing source directory.",
  source_directory_ignored: "The selected source directory is excluded by an ancestor gitignore.",
  source_git_invalid: "The source workspace Git metadata could not be read safely.",
  source_path_invalid: "The source workspace contains an unsupported file path or file type.",
  source_symlink_forbidden: "Source snapshots cannot contain or follow symbolic links.",
  source_file_too_large: "A source file exceeds the 2 MiB limit.",
  source_snapshot_too_large: "The source snapshot exceeds the 8 MiB limit.",
  source_too_many_files: "The source snapshot exceeds the 2000 file limit.",
  source_scan_limit: "The source directory exceeds the bounded scan limit.",
  source_snapshot_changed:
    "Source files changed during capture. Capture a new snapshot before publishing.",
  source_read_failed: "The source workspace could not be read safely.",
};

/** Fixed messages keep operating-system paths and Git configuration values out of diagnostics. */
export class SourceWorkspaceError extends Error {
  public constructor(readonly code: SourceWorkspaceErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "SourceWorkspaceError";
  }
}

interface GitLayout {
  readonly root: string;
  readonly gitdir: string;
  readonly commonDir: string;
}

/** Inspection is local and read-only. A remote is evidence of a source, never of authorization. */
export async function inspectSourceWorkspace(directory: string): Promise<SourceWorkspace> {
  const root = await sourceDirectory(directory);
  const layout = await findGitLayout(root);
  if (layout === null)
    return { directory: root, repositoryRoot: null, applicationRoot: ".", git: null };
  try {
    const commonConfig = await optionalMetadata(join(layout.commonDir, "config"));
    const commonFs = configFilesystem(layout.commonDir, commonConfig ?? "");
    const worktreeEnabled = await git.getConfig({
      fs: commonFs,
      gitdir: layout.commonDir,
      path: "extensions.worktreeConfig",
    });
    const worktreeConfig = /^(?:true|yes|on|1)$/iu.test(String(worktreeEnabled))
      ? await optionalMetadata(join(layout.gitdir, "config.worktree"))
      : null;
    const configFs = configFilesystem(
      layout.commonDir,
      `${commonConfig ?? ""}\n${worktreeConfig ?? ""}`,
    );
    const branch =
      (await git.currentBranch({ fs: { promises: fs }, gitdir: layout.gitdir })) ?? null;
    let head: string | null = null;
    try {
      head = await git.resolveRef({
        fs: { promises: fs },
        gitdir: branch === null ? layout.gitdir : layout.commonDir,
        ref: branch === null ? "HEAD" : `refs/heads/${branch}`,
      });
    } catch (error) {
      if (!(error instanceof git.Errors.NotFoundError)) throw error;
    }
    if (head !== null && !/^[a-f0-9]{40}$/u.test(head))
      throw new SourceWorkspaceError("source_git_invalid");
    const remotes = [
      ...new Map(
        (await git.listRemotes({ fs: configFs, gitdir: layout.commonDir }))
          .filter((remote) => typeof remote.remote === "string")
          .map((remote) => [
            remote.remote,
            { name: safeRemoteName(remote.remote), ...sanitizeRemote(remote.url) },
          ]),
      ).values(),
    ].sort((left, right) => left.name.localeCompare(right.name));
    const upstreamRemote =
      branch === null
        ? null
        : ((await git.getConfig({
            fs: configFs,
            gitdir: layout.commonDir,
            path: `branch.${branch}.remote`,
          })) ?? null);
    const pushRemote =
      (branch === null
        ? undefined
        : await git.getConfig({
            fs: configFs,
            gitdir: layout.commonDir,
            path: `branch.${branch}.pushRemote`,
          })) ??
      (await git.getConfig({
        fs: configFs,
        gitdir: layout.commonDir,
        path: "remote.pushDefault",
      })) ??
      upstreamRemote;
    return {
      directory: root,
      repositoryRoot: layout.root,
      applicationRoot: portableRelative(layout.root, root) || ".",
      git: {
        head,
        branch,
        remotes,
        upstreamRemote: upstreamRemote === null ? null : safeRemoteName(upstreamRemote),
        pushRemote: pushRemote === null ? null : safeRemoteName(pushRemote),
      },
    };
  } catch {
    throw new SourceWorkspaceError("source_git_invalid");
  }
}

function configFilesystem(gitdir: string, config: string) {
  return {
    promises: {
      ...fs,
      readFile: async (path: string, options?: BufferEncoding | { encoding?: BufferEncoding }) => {
        const contents =
          path === join(gitdir, "config") ? Buffer.from(config) : await fs.readFile(path);
        const encoding = typeof options === "string" ? options : options?.encoding;
        return encoding === undefined ? contents : contents.toString(encoding);
      },
    },
  };
}

function safeRemoteName(name: string): string {
  if (!/^[a-zA-Z0-9._/-]{1,128}$/u.test(name)) throw new SourceWorkspaceError("source_git_invalid");
  return name;
}

function sanitizeRemote(value: string): Pick<SourceWorkspaceRemote, "url" | "githubRepository"> {
  let url: URL;
  try {
    const scp = /^(?:[^@\s]+@)?([^:/\s]+):([^\s]+)$/u.exec(value);
    url = new URL(scp !== null && !value.includes("://") ? `ssh://${scp[1]}/${scp[2]}` : value);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol))
      return { url: null, githubRepository: null };
  } catch {
    return { url: null, githubRepository: null };
  }
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  const repository = url.pathname.replace(/^\//u, "").replace(/\.git\/?$/u, "");
  if (
    url.hostname === "github.com" &&
    (url.port === "" || url.port === "443" || url.port === "22") &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/u.test(repository)
  ) {
    return { url: `https://github.com/${repository}`, githubRepository: repository };
  }
  // Unknown hosts retain only their origin; their paths may carry provider-specific credentials.
  return { url: `${url.protocol}//${url.host}`, githubRepository: null };
}

async function sourceDirectory(directory: string): Promise<string> {
  try {
    const path = resolve(directory);
    const status = await fs.lstat(path);
    if (status.isSymbolicLink()) throw new SourceWorkspaceError("source_symlink_forbidden");
    if (!status.isDirectory()) throw new SourceWorkspaceError("source_directory_invalid");
    return await fs.realpath(path);
  } catch (error) {
    if (error instanceof SourceWorkspaceError) throw error;
    throw new SourceWorkspaceError("source_directory_invalid");
  }
}

async function findGitLayout(directory: string): Promise<GitLayout | null> {
  let root = directory;
  for (;;) {
    const marker = join(root, ".git");
    const status = await optionalStat(marker);
    if (status !== null) {
      if (status.isSymbolicLink()) throw new SourceWorkspaceError("source_git_invalid");
      try {
        let gitdir = marker;
        if (status.isFile()) {
          const content = await readStableFile(marker, status, MAXIMUM_GIT_METADATA_BYTES);
          const pointer = /^gitdir: ([^\r\n]+)\r?\n?$/u.exec(content.toString("utf8"))?.[1];
          if (pointer === undefined || hasControlCharacter(pointer))
            throw new SourceWorkspaceError("source_git_invalid");
          gitdir = resolve(root, pointer);
        }
        gitdir = await fs.realpath(gitdir);
        if (!(await fs.stat(gitdir)).isDirectory())
          throw new SourceWorkspaceError("source_git_invalid");
        const common = await optionalMetadata(join(gitdir, "commondir"));
        if (
          common !== null &&
          (!/^[^\r\n]+\r?\n?$/u.test(common) || hasControlCharacter(common.trim()))
        )
          throw new SourceWorkspaceError("source_git_invalid");
        const commonDir =
          common === null ? gitdir : await fs.realpath(resolve(gitdir, common.trim()));
        return { root, gitdir, commonDir };
      } catch {
        throw new SourceWorkspaceError("source_git_invalid");
      }
    }
    const parent = dirname(root);
    if (parent === root) return null;
    root = parent;
  }
}

async function optionalMetadata(path: string): Promise<string | null> {
  const status = await optionalStat(path);
  return status === null
    ? null
    : (await readStableFile(path, status, MAXIMUM_GIT_METADATA_BYTES)).toString("utf8");
}

interface SourceEntry {
  readonly path: string;
  readonly absolute: string;
  readonly status: BigIntStats;
}
interface IgnoreScope {
  readonly directory: string;
  readonly matcher: ReturnType<typeof ignore>;
}
interface Manifest {
  readonly entries: readonly SourceEntry[];
  readonly observations: ReadonlyMap<string, string>;
  readonly totalBytes: number;
}

/**
 * Capture current files, not Git commits or history. Reads are bounded and a second complete
 * manifest verifies file/directory identities and ignore rules before any content can be uploaded.
 */
export async function createSourceSnapshot(options: {
  readonly directory: string;
}): Promise<SourceSnapshot> {
  const root = await sourceDirectory(options.directory);
  try {
    const layout = await findGitLayout(root);
    const first = await sourceManifest(root, layout?.root ?? root);
    const files: SourceSnapshotFile[] = [];
    for (const entry of first.entries) {
      const content = await readStableFile(
        entry.absolute,
        entry.status,
        SOURCE_SNAPSHOT_LIMITS.fileBytes,
        root,
      );
      files.push(
        Object.freeze({
          path: entry.path,
          contentBase64: content.toString("base64"),
          sha256: digest(content),
          byteLength: content.byteLength,
          executable: (entry.status.mode & 0o111n) !== 0n,
        }),
      );
    }
    const second = await sourceManifest(root, layout?.root ?? root);
    if (
      first.observations.size !== second.observations.size ||
      [...first.observations].some(([path, stamp]) => second.observations.get(path) !== stamp)
    ) {
      throw new SourceWorkspaceError("source_snapshot_changed");
    }
    return Object.freeze({
      sha256: digest(
        JSON.stringify(files.map(({ path, sha256, executable }) => [path, sha256, executable])),
      ),
      totalBytes: first.totalBytes,
      files: Object.freeze(files),
    });
  } catch (error) {
    if (error instanceof SourceWorkspaceError) throw error;
    throw new SourceWorkspaceError("source_read_failed");
  }
}

async function sourceManifest(root: string, ignoreRoot: string): Promise<Manifest> {
  const observations = new Map<string, string>();
  const entries: SourceEntry[] = [];
  let totalBytes = 0;
  let scanned = 0;
  const ancestors: string[] = [];
  for (let directory = root; directory !== ignoreRoot; directory = dirname(directory))
    ancestors.unshift(dirname(directory));
  let inherited: readonly IgnoreScope[] = [];
  for (const ancestor of ancestors) {
    inherited = await readIgnoreScope(ancestor, inherited, observations);
    const child = ancestors[ancestors.indexOf(ancestor) + 1] ?? root;
    if (ignored(child, true, inherited)) throw new SourceWorkspaceError("source_directory_ignored");
  }
  async function walk(
    directory: string,
    scopes: readonly IgnoreScope[],
    depth: number,
  ): Promise<void> {
    if (depth > MAXIMUM_DEPTH) throw new SourceWorkspaceError("source_scan_limit");
    const status = await fs.lstat(directory, { bigint: true });
    if (status.isSymbolicLink()) throw new SourceWorkspaceError("source_symlink_forbidden");
    if (!status.isDirectory() || (await fs.realpath(directory)) !== directory)
      throw new SourceWorkspaceError("source_snapshot_changed");
    observations.set(directory, stamp(status));
    const active = await readIgnoreScope(directory, scopes, observations);
    const children = await fs.readdir(directory, { withFileTypes: true });
    scanned += children.length;
    if (scanned > MAXIMUM_SCAN_ENTRIES) throw new SourceWorkspaceError("source_scan_limit");
    for (const child of children.sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )) {
      if (excluded(child.name)) continue;
      const absolute = join(directory, child.name);
      if (ignored(absolute, child.isDirectory(), active)) continue;
      const path = portableRelative(root, absolute);
      if (path.length > 512 || path.includes("\\") || hasControlCharacter(path))
        throw new SourceWorkspaceError("source_path_invalid");
      const childStatus = await fs.lstat(absolute, { bigint: true });
      if (childStatus.isSymbolicLink()) throw new SourceWorkspaceError("source_symlink_forbidden");
      if (childStatus.isDirectory()) await walk(absolute, active, depth + 1);
      else {
        if (!childStatus.isFile()) throw new SourceWorkspaceError("source_path_invalid");
        if (!isManagedSourcePath(path)) throw new SourceWorkspaceError("source_path_invalid");
        if (childStatus.size > BigInt(SOURCE_SNAPSHOT_LIMITS.fileBytes))
          throw new SourceWorkspaceError("source_file_too_large");
        if (entries.length >= SOURCE_SNAPSHOT_LIMITS.files)
          throw new SourceWorkspaceError("source_too_many_files");
        totalBytes += Number(childStatus.size);
        if (totalBytes > SOURCE_SNAPSHOT_LIMITS.totalBytes)
          throw new SourceWorkspaceError("source_snapshot_too_large");
        entries.push({ path, absolute, status: childStatus });
        observations.set(absolute, stamp(childStatus));
      }
    }
    if (stamp(await fs.lstat(directory, { bigint: true })) !== stamp(status))
      throw new SourceWorkspaceError("source_snapshot_changed");
  }
  await walk(root, inherited, 0);
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { entries, observations, totalBytes };
}

async function readIgnoreScope(
  directory: string,
  scopes: readonly IgnoreScope[],
  observations: Map<string, string>,
): Promise<readonly IgnoreScope[]> {
  const path = join(directory, ".gitignore");
  const status = await optionalStat(path);
  observations.set(path, status === null ? "absent" : stamp(status));
  if (status === null) return scopes;
  const contents = await readStableFile(path, status, SOURCE_SNAPSHOT_LIMITS.fileBytes);
  return [
    ...scopes,
    { directory, matcher: ignore({ ignorecase: false }).add(contents.toString("utf8")) },
  ];
}

function ignored(path: string, directory: boolean, scopes: readonly IgnoreScope[]): boolean {
  let result = false;
  for (const scope of scopes) {
    const match = scope.matcher.test(
      `${portableRelative(scope.directory, path)}${directory ? "/" : ""}`,
    );
    if (match.ignored) result = true;
    else if (match.unignored) result = false;
  }
  return result;
}

const EXCLUDED_NAMES = new Set([
  ".git",
  ".ohmyhost",
  ".aws",
  ".ssh",
  ".gnupg",
  ".kube",
  ".credentials",
  "credentials",
  ".git-credentials",
  ".npmrc",
  ".netrc",
  ".pypirc",
  ".dev.vars",
  ".ds_store",
  "node_modules",
  ".next",
  ".open-next",
  ".output",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".turbo",
  ".vercel",
  ".wrangler",
  ".cache",
  "dist",
  "out",
  "build",
  "coverage",
]);

function excluded(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    EXCLUDED_NAMES.has(lower) ||
    ((lower === ".env" || lower.startsWith(".env.")) && lower !== ".env.example") ||
    lower.startsWith(".dev.vars.") ||
    /(?:\.(?:pem|key|p12|pfx|jks|keystore|log|tsbuildinfo)$|^id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|^(?:credentials|secrets|service[-_]account)(?:[.-]|$)|firebase-adminsdk)/u.test(
      lower,
    )
  );
}

async function optionalStat(path: string): Promise<BigIntStats | null> {
  try {
    return await fs.lstat(path, { bigint: true });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
      return null;
    throw new SourceWorkspaceError("source_read_failed");
  }
}

async function readStableFile(
  path: string,
  expected: BigIntStats,
  maximumBytes: number,
  sourceRoot?: string,
): Promise<Buffer> {
  if (expected.isSymbolicLink()) throw new SourceWorkspaceError("source_symlink_forbidden");
  if (!expected.isFile()) throw new SourceWorkspaceError("source_path_invalid");
  if (expected.size > BigInt(maximumBytes)) throw new SourceWorkspaceError("source_file_too_large");
  if (sourceRoot !== undefined) {
    const canonical = await fs.realpath(path);
    const rel = relative(sourceRoot, canonical);
    if (canonical !== path || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
      throw new SourceWorkspaceError("source_symlink_forbidden");
  }
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (stamp(await handle.stat({ bigint: true })) !== stamp(expected))
      throw new SourceWorkspaceError("source_snapshot_changed");
    const buffer = Buffer.alloc(Number(expected.size) + 1);
    let length = 0;
    while (length < buffer.byteLength) {
      const result = await handle.read({
        buffer,
        offset: length,
        length: buffer.byteLength - length,
        position: length,
      });
      if (result.bytesRead === 0) break;
      length += result.bytesRead;
    }
    if (
      BigInt(length) !== expected.size ||
      stamp(await handle.stat({ bigint: true })) !== stamp(expected) ||
      stamp(await fs.lstat(path, { bigint: true })) !== stamp(expected) ||
      (sourceRoot !== undefined && (await fs.realpath(path)) !== path)
    )
      throw new SourceWorkspaceError("source_snapshot_changed");
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

function stamp(status: BigIntStats): string {
  return [status.dev, status.ino, status.mode, status.size, status.mtimeNs, status.ctimeNs].join(
    ":",
  );
}

function portableRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some(
    (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
}
