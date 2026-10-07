import { publicOperationFailure } from "./operation-failure.js";

/** Canonical, credential-free contracts shared by REST, CLI and both MCP transports. */
export const MANAGED_SOURCE_LIMITS = Object.freeze({
  fileBytes: 2 * 1024 * 1024,
  uploadBytes: 2 * 1024 * 1024,
  treeBytes: 8 * 1024 * 1024,
  files: 2000,
});

export interface ManagedProjectSource {
  readonly provider: "managed";
  readonly source_connection_id: string;
  readonly source_generation: number;
  readonly namespace: string;
  readonly repository_name: string;
  readonly branch: "main";
  readonly current_commit_sha: string | null;
  readonly status: "pending" | "ready" | "failed" | "revoked";
  readonly linked_at: string;
  readonly updated_at: string;
  readonly initialization_operation_id?: string;
  readonly initialization_error_code?: string;
}

/** Stable released GitHub projection used by existing clients and project status. */
export interface GithubProjectSource {
  readonly provider: "github";
  readonly installation_id: string;
  readonly repository_full_name: string;
  readonly status: "pending" | "ready" | "failed" | "revoked";
  readonly linked_at: string;
  readonly updated_at: string;
  readonly failure_summary?: string;
}

/** Requested explicitly with GET source?include_binding=true; never inferred from missing fields. */
export interface GithubSourceBinding extends GithubProjectSource {
  readonly source_connection_id: string;
  readonly source_generation: number;
}

export type ProjectSource = GithubProjectSource | ManagedProjectSource;
export type ProjectSourceBinding = GithubSourceBinding | ManagedProjectSource;

export function assertGithubSourceResponse(kind: "legacy" | "binding", value: unknown): void {
  const body = record(value);
  exact(body, [
    "provider",
    "installation_id",
    "repository_full_name",
    "status",
    "linked_at",
    "updated_at",
    ...(kind === "binding" ? ["source_connection_id", "source_generation"] : []),
    ...("failure_summary" in body ? ["failure_summary"] : []),
  ]);
  if (
    body["provider"] !== "github" ||
    typeof body["installation_id"] !== "string" ||
    !/^[1-9][0-9]{0,19}$/u.test(body["installation_id"]) ||
    typeof body["repository_full_name"] !== "string" ||
    body["repository_full_name"].length < 3 ||
    body["repository_full_name"].length > 201 ||
    !/^[^/]+\/[^/]+$/u.test(body["repository_full_name"]) ||
    typeof body["status"] !== "string" ||
    !["pending", "ready", "failed", "revoked"].includes(body["status"])
  )
    invalid();
  timestamp(body["linked_at"]);
  timestamp(body["updated_at"]);
  if (
    "failure_summary" in body &&
    (typeof body["failure_summary"] !== "string" ||
      body["failure_summary"].length < 1 ||
      body["failure_summary"].length > 512)
  )
    invalid();
  if (kind === "binding") {
    ulid(body["source_connection_id"]);
    generation(body["source_generation"]);
    if (Number(body["source_generation"]) < 1) invalid();
  }
}

export interface SourceManifestFile {
  readonly path: string;
  readonly sha256: string;
  readonly byte_length: number;
  readonly executable: boolean;
}

export interface SourceChange {
  readonly path: string;
  /** null deletes a file; canonical base64 replaces or creates it. */
  readonly content_base64: string | null;
  readonly executable: boolean;
}

export interface ManagedSourceWrite {
  readonly expected_source_generation: number;
  readonly expected_commit_sha: string | null;
  readonly message: string;
}

export interface ManagedSourceUploadRequest extends ManagedSourceWrite {
  readonly mode: "initialize" | "commit" | "switch";
  readonly expected_source_connection_id: string | null;
}

export interface ManagedSourceChangesRequest extends ManagedSourceWrite {
  readonly changes: readonly SourceChange[];
}

export interface ManagedSourceRestoreRequest extends ManagedSourceWrite {
  readonly restore_commit_sha: string;
}

export interface ManagedSourceInitializeRequest {
  readonly template: "vite-react" | "empty";
  readonly expected_source_generation: number;
}

export interface ManagedSourceBlobRequest {
  readonly path: string;
  readonly content_base64: string;
  readonly sha256: string;
  readonly executable: boolean;
}

export interface ManagedSourceFinalizeRequest {
  readonly files: readonly SourceManifestFile[];
  readonly expected_source_generation: number;
}

export interface ManagedSourceSwitchRequest extends ManagedSourceFinalizeRequest {
  readonly upload_operation_id: string;
  readonly expected_source_connection_id: string;
}

export interface ManagedSourceFile extends SourceManifestFile {
  readonly content_base64: string;
}

export interface ManagedSourceFiles {
  readonly commit_sha: string;
  readonly files: readonly SourceManifestFile[];
}

export interface ManagedSourceFileResponse {
  readonly commit_sha: string;
  readonly file: ManagedSourceFile;
}

export interface ManagedSourceVersion {
  readonly commit_sha: string;
  readonly parent_commit_sha: string | null;
  readonly message: string;
  readonly created_at: string;
}

export interface ManagedSourceVersions {
  readonly versions: readonly ManagedSourceVersion[];
  readonly next_commit_sha: string | null;
}

export interface ManagedSourceDiff {
  readonly from_commit_sha: string;
  readonly to_commit_sha: string;
  readonly changes: readonly {
    readonly path: string;
    readonly change: "added" | "modified" | "deleted";
    readonly before_sha256: string | null;
    readonly after_sha256: string | null;
    readonly before_executable: boolean | null;
    readonly after_executable: boolean | null;
  }[];
}

export interface ManagedSourceUploadReceipt {
  readonly operation_id: string;
  readonly state: "staging" | "sealed" | "committed" | "failed";
  readonly expected_source_generation: number;
  readonly expected_commit_sha: string | null;
  readonly commit_sha: string | null;
  readonly expires_at: string;
}

export function isManagedSourcePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 240 &&
    !/[^\x20-\x7e]/u.test(value) &&
    !/[\p{Cc}\\]/u.test(value) &&
    !value.startsWith("/") &&
    !/^[a-z]:/iu.test(value) &&
    managedSourceTarPath(value) &&
    value
      .split("/")
      .every(
        (segment) =>
          segment !== "" &&
          segment !== "." &&
          segment !== ".." &&
          ![
            ".git",
            ".ohmyhost",
            ".aws",
            ".ssh",
            ".gnupg",
            ".kube",
            ".credentials",
            ".git-credentials",
            ".npmrc",
            ".netrc",
            ".pypirc",
            ".dev.vars",
          ].includes(segment.toLowerCase()) &&
          !(
            segment.toLowerCase().startsWith(".env") &&
            (segment.toLowerCase() === ".env" || segment.toLowerCase().startsWith(".env.")) &&
            segment.toLowerCase() !== ".env.example"
          ) &&
          !segment.toLowerCase().startsWith(".dev.vars.") &&
          !/^(?:id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)|service[-_]account(?:\.|$))/iu.test(segment) &&
          !/\.(?:pem|key|p12|pfx|jks|keystore)$/iu.test(segment),
      )
  );
}

/** Matches the existing strict USTAR build inspector, including its source/ archive root. */
function managedSourceTarPath(value: string): boolean {
  const path = `source/${value}`;
  if (path.length <= 100) return true;
  for (let index = path.lastIndexOf("/"); index > 0; index = path.lastIndexOf("/", index - 1)) {
    if (index <= 155 && path.length - index - 1 > 0 && path.length - index - 1 <= 100) return true;
  }
  return false;
}

export function parseManagedSourceRequest(
  kind: "initialize",
  value: unknown,
): ManagedSourceInitializeRequest;
export function parseManagedSourceRequest(
  kind: "upload",
  value: unknown,
): ManagedSourceUploadRequest;
export function parseManagedSourceRequest(
  kind: "changes",
  value: unknown,
): ManagedSourceChangesRequest;
export function parseManagedSourceRequest(
  kind: "restore",
  value: unknown,
): ManagedSourceRestoreRequest;
export function parseManagedSourceRequest(kind: "blob", value: unknown): ManagedSourceBlobRequest;
export function parseManagedSourceRequest(
  kind: "finalize",
  value: unknown,
): ManagedSourceFinalizeRequest;
export function parseManagedSourceRequest(
  kind: "switch",
  value: unknown,
): ManagedSourceSwitchRequest;
export function parseManagedSourceRequest(
  kind: "initialize" | "upload" | "changes" | "restore" | "blob" | "finalize" | "switch",
  value: unknown,
):
  | ManagedSourceInitializeRequest
  | ManagedSourceUploadRequest
  | ManagedSourceChangesRequest
  | ManagedSourceRestoreRequest
  | ManagedSourceBlobRequest
  | ManagedSourceFinalizeRequest
  | ManagedSourceSwitchRequest {
  const body = record(value);
  if (kind === "initialize") {
    exact(body, ["template", "expected_source_generation"]);
    generation(body["expected_source_generation"]);
    if (body["template"] !== "empty" && body["template"] !== "vite-react") invalid();
  } else if (kind === "blob") {
    exact(body, ["path", "content_base64", "sha256", "executable"]);
    path(body["path"]);
    base64(body["content_base64"]);
    sha256(body["sha256"]);
    if (typeof body["executable"] !== "boolean") invalid();
  } else if (kind === "finalize" || kind === "switch") {
    exact(
      body,
      kind === "switch"
        ? [
            "files",
            "expected_source_generation",
            "upload_operation_id",
            "expected_source_connection_id",
          ]
        : ["files", "expected_source_generation"],
    );
    manifest(body["files"]);
    generation(body["expected_source_generation"]);
    if (kind === "switch") {
      ulid(body["upload_operation_id"]);
      ulid(body["expected_source_connection_id"]);
    }
  } else {
    const extra =
      kind === "upload"
        ? ["mode", "expected_source_connection_id"]
        : kind === "changes"
          ? ["changes"]
          : ["restore_commit_sha"];
    exact(body, ["expected_source_generation", "expected_commit_sha", "message", ...extra]);
    generation(body["expected_source_generation"]);
    commit(body["expected_commit_sha"], true);
    if (
      typeof body["message"] !== "string" ||
      body["message"].trim() !== body["message"] ||
      body["message"].length < 1 ||
      body["message"].length > 200 ||
      /\p{Cc}/u.test(body["message"])
    )
      invalid();
    if (kind === "upload") {
      if (!["initialize", "commit", "switch"].includes(String(body["mode"]))) invalid();
      if (body["expected_source_connection_id"] !== null)
        ulid(body["expected_source_connection_id"]);
      if ((body["mode"] === "initialize") !== (body["expected_source_connection_id"] === null))
        invalid();
      if (body["mode"] !== "commit" && body["expected_commit_sha"] !== null) invalid();
    } else if (kind === "restore") commit(body["restore_commit_sha"]);
    else {
      const changes = body["changes"];
      if (
        !Array.isArray(changes) ||
        changes.length < 1 ||
        changes.length > MANAGED_SOURCE_LIMITS.files
      )
        invalid();
      let total = 0;
      const paths = new Set<string>();
      for (const change of changes) {
        const entry = record(change);
        exact(entry, ["path", "content_base64", "executable"]);
        path(entry["path"]);
        if (typeof entry["executable"] !== "boolean") invalid();
        if (paths.has(String(entry["path"]))) invalid();
        paths.add(String(entry["path"]));
        if (entry["content_base64"] !== null) total += base64(entry["content_base64"]);
      }
      if (total > MANAGED_SOURCE_LIMITS.uploadBytes) invalid();
    }
  }
  return body as unknown as ReturnType<typeof parseManagedSourceRequest>;
}

export function assertManagedSourceResponse(
  kind: "source" | "files" | "versions" | "diff" | "upload" | "blob",
  value: unknown,
): void {
  const body = record(value);
  if (kind === "source") {
    exact(body, [
      "provider",
      "source_connection_id",
      "source_generation",
      "namespace",
      "repository_name",
      "branch",
      "current_commit_sha",
      "status",
      "linked_at",
      "updated_at",
      ...("initialization_operation_id" in body ? ["initialization_operation_id"] : []),
      ...("initialization_error_code" in body ? ["initialization_error_code"] : []),
    ]);
    if (body["provider"] !== "managed" || body["branch"] !== "main") invalid();
    ulid(body["source_connection_id"]);
    generation(body["source_generation"]);
    for (const name of ["namespace", "repository_name"])
      if (typeof body[name] !== "string" || !/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(body[name]))
        invalid();
    commit(body["current_commit_sha"], true);
    if (!["pending", "ready", "failed", "revoked"].includes(String(body["status"]))) invalid();
    timestamp(body["linked_at"]);
    timestamp(body["updated_at"]);
    if ("initialization_operation_id" in body) ulid(body["initialization_operation_id"]);
    if (
      "initialization_error_code" in body &&
      (typeof body["initialization_error_code"] !== "string" ||
        publicOperationFailure(body["initialization_error_code"]).code !==
          body["initialization_error_code"])
    )
      invalid();
    if (
      ("initialization_operation_id" in body || "initialization_error_code" in body) &&
      body["status"] !== "pending" &&
      body["status"] !== "failed"
    )
      invalid();
  } else if (kind === "files") {
    commit(body["commit_sha"]);
    if ("file" in body) {
      exact(body, ["commit_sha", "file"]);
      const file = record(body["file"]);
      exact(file, ["path", "sha256", "byte_length", "executable", "content_base64"]);
      manifest([
        {
          path: file["path"],
          sha256: file["sha256"],
          byte_length: file["byte_length"],
          executable: file["executable"],
        },
      ]);
      if (base64(file["content_base64"]) !== file["byte_length"]) invalid();
    } else {
      exact(body, ["commit_sha", "files"]);
      manifest(body["files"]);
    }
  } else if (kind === "versions") {
    exact(body, ["versions", "next_commit_sha"]);
    commit(body["next_commit_sha"], true);
    if (!Array.isArray(body["versions"]) || body["versions"].length > 100) invalid();
    for (const version of body["versions"]) {
      const entry = record(version);
      exact(entry, ["commit_sha", "parent_commit_sha", "message", "created_at"]);
      commit(entry["commit_sha"]);
      commit(entry["parent_commit_sha"], true);
      if (typeof entry["message"] !== "string" || entry["message"].length > 20000) invalid();
      timestamp(entry["created_at"]);
    }
  } else if (kind === "diff") {
    exact(body, ["from_commit_sha", "to_commit_sha", "changes"]);
    commit(body["from_commit_sha"]);
    commit(body["to_commit_sha"]);
    if (!Array.isArray(body["changes"]) || body["changes"].length > MANAGED_SOURCE_LIMITS.files * 2)
      invalid();
    for (const change of body["changes"]) {
      const entry = record(change);
      exact(entry, [
        "path",
        "change",
        "before_sha256",
        "after_sha256",
        "before_executable",
        "after_executable",
      ]);
      path(entry["path"]);
      if (
        ![true, false, null].includes(entry["before_executable"] as boolean | null) ||
        ![true, false, null].includes(entry["after_executable"] as boolean | null)
      )
        invalid();
      if (
        (entry["before_sha256"] === null) !== (entry["before_executable"] === null) ||
        (entry["after_sha256"] === null) !== (entry["after_executable"] === null)
      )
        invalid();
      if (!["added", "modified", "deleted"].includes(String(entry["change"]))) invalid();
      if (entry["before_sha256"] !== null) sha256(entry["before_sha256"]);
      if (entry["after_sha256"] !== null) sha256(entry["after_sha256"]);
      if (
        entry["change"] === "added" &&
        (entry["before_sha256"] !== null || entry["after_sha256"] === null)
      )
        invalid();
      if (
        entry["change"] === "deleted" &&
        (entry["before_sha256"] === null || entry["after_sha256"] !== null)
      )
        invalid();
      if (
        entry["change"] === "modified" &&
        (entry["before_sha256"] === null ||
          entry["after_sha256"] === null ||
          (entry["before_sha256"] === entry["after_sha256"] &&
            entry["before_executable"] === entry["after_executable"]))
      )
        invalid();
    }
  } else if (kind === "blob") {
    exact(body, ["path", "sha256", "byte_length", "executable"]);
    manifest([body]);
  } else {
    exact(body, [
      "operation_id",
      "state",
      "expected_source_generation",
      "expected_commit_sha",
      "commit_sha",
      "expires_at",
    ]);
    ulid(body["operation_id"]);
    if (!["staging", "sealed", "committed", "failed"].includes(String(body["state"]))) invalid();
    generation(body["expected_source_generation"]);
    commit(body["expected_commit_sha"], true);
    commit(body["commit_sha"], true);
    timestamp(body["expires_at"]);
    if (body["state"] === "committed" && body["commit_sha"] === null) invalid();
  }
}

function manifest(value: unknown): void {
  if (!Array.isArray(value) || value.length > MANAGED_SOURCE_LIMITS.files) invalid();
  let total = 0;
  const seen = new Set<string>();
  for (const file of value) {
    const entry = record(file);
    exact(entry, ["path", "sha256", "byte_length", "executable"]);
    path(entry["path"]);
    sha256(entry["sha256"]);
    if (typeof entry["executable"] !== "boolean") invalid();
    if (
      !Number.isSafeInteger(entry["byte_length"]) ||
      Number(entry["byte_length"]) < 0 ||
      Number(entry["byte_length"]) > MANAGED_SOURCE_LIMITS.fileBytes ||
      seen.has(String(entry["path"]))
    )
      invalid();
    seen.add(String(entry["path"]));
    total += Number(entry["byte_length"]);
  }
  if (total > MANAGED_SOURCE_LIMITS.treeBytes) invalid();
}

function base64(value: unknown): number {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(MANAGED_SOURCE_LIMITS.fileBytes / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value) ||
    (value.endsWith("==") && !/[AQgw]==$/u.test(value)) ||
    (!value.endsWith("==") && value.endsWith("=") && !/[AEIMQUYcgkosw048]=$/u.test(value))
  )
    invalid();
  const size = (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
  if (size > MANAGED_SOURCE_LIMITS.fileBytes) invalid();
  return size;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) invalid();
}

function path(value: unknown): void {
  if (!isManagedSourcePath(value)) invalid();
}

function generation(value: unknown): void {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2147483646) invalid();
}

function ulid(value: unknown): void {
  if (typeof value !== "string" || !/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(value)) invalid();
}

function commit(value: unknown, nullable = false): void {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) invalid();
}

function sha256(value: unknown): void {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) invalid();
}

function timestamp(value: unknown): void {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    invalid();
}

function invalid(): never {
  throw new TypeError("Managed source contract is invalid");
}
