import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import { join, resolve } from "node:path";

import {
  parseManagedSourceRequest,
  assertManagedSourceResponse,
  type ManagedProjectSource,
  type ManagedSourceUploadRequest,
} from "@ohmyhost/contracts/managed-sources";
import type { Operation } from "@ohmyhost/sdk-ts";

import { OwnerOnlyProjectLinkStore, readProjectLinks } from "./project-link-store.js";
import {
  parseCurrentIdentity,
  parseOperation,
  parseSafeProblem,
  ResponseContractError,
} from "./runtime-contract.js";
import { isSourcePublicationIdempotencyKey, type ManagedSourceApi } from "./source-publisher.js";

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
type LocalSourceCode =
  | "source_binding_required"
  | "source_publication_pending"
  | "source_publication_scope_mismatch"
  | "source_publication_missing"
  | "source_publication_failed"
  | "source_publication_input_invalid"
  | "source_local_state_invalid";
const MESSAGES: Record<LocalSourceCode, string> = {
  source_binding_required:
    "The directory has no matching confirmed source base. Read and merge the current source, then pass its expected commit explicitly; never select a fresh remote head for unchanged local files.",
  source_publication_pending:
    "Complete the directory's previous source publication before starting another attempt. Use source publish complete with the same project and login.",
  source_publication_scope_mismatch:
    "The pending source publication belongs to another directory, account, project or source binding. Resume its exact project and login.",
  source_publication_missing:
    "No pending source publication exists in this directory for this project and login.",
  source_publication_failed:
    "The source publication did not succeed. Inspect its operation before fixing the cause and starting a new attempt.",
  source_publication_input_invalid:
    "Use a valid source snapshot and an idempotency key of 1 to 128 characters.",
  source_local_state_invalid:
    "The owner-only local source metadata could not be read or stored safely.",
};
export class LocalSourcePublicationError extends Error {
  public constructor(
    readonly code: LocalSourceCode,
    readonly operation?: Operation,
  ) {
    super(MESSAGES[code]);
    this.name = "LocalSourcePublicationError";
  }
}

interface PendingPublication {
  readonly version: 1;
  readonly directory: string;
  readonly metadata_directory: string;
  readonly api_origin: string;
  readonly organization_id: string;
  readonly actor_id: string;
  readonly project_id: string;
  readonly operation_id: string | null;
  readonly idempotency_key: string;
  readonly snapshot_sha256: string;
  readonly request: ManagedSourceUploadRequest;
}

export interface PreparedSourcePublication {
  readonly request: ManagedSourceUploadRequest;
  readonly accepted: (operation: Operation) => Promise<void>;
  readonly rejected: (error: unknown) => Promise<void>;
}

export type LocalSourceMetadataDirectory = ".ohmyhost" | ".ohmyhost/production";

/** A directory's last confirmed base is an optimistic client cache, not the repository head. */
export async function prepareLocalSourcePublication(input: {
  directory: string;
  metadataDirectory?: LocalSourceMetadataDirectory;
  apiOrigin: string;
  identity: unknown;
  projectId: string;
  request: ManagedSourceUploadRequest;
  explicitExpectedCommit: boolean;
  snapshotSha256: string;
  idempotencyKey: string;
}): Promise<PreparedSourcePublication> {
  if (
    !isSourcePublicationIdempotencyKey(input.idempotencyKey) ||
    typeof input.snapshotSha256 !== "string" ||
    !DIGEST.test(input.snapshotSha256)
  )
    throw new LocalSourcePublicationError("source_publication_input_invalid");
  try {
    parseManagedSourceRequest("upload", input.request);
  } catch {
    throw new LocalSourcePublicationError("source_publication_input_invalid");
  }
  const scope = await publicationScope(
    input.directory,
    input.apiOrigin,
    input.identity,
    input.projectId,
    input.metadataDirectory,
  );
  let request = input.request;
  const previous = await readPending(scope);
  const completed = previous === null ? await readRecord(completedPath(scope)) : null;
  const replay = completed?.idempotency_key === input.idempotencyKey;
  const original = previous ?? (replay ? await readPending(scope, true) : null);
  if (original !== null && request.mode === "commit" && !input.explicitExpectedCommit)
    request = { ...request, expected_commit_sha: original.request.expected_commit_sha };
  else if (original === null && request.mode === "commit" && !input.explicitExpectedCommit) {
    const link = (await readProjectLinks(scope.metadata_directory, scope.api_origin)).links.find(
      (link) =>
        link.organization_id === scope.organization_id && link.project_id === scope.project_id,
    );
    if (
      link?.version !== 3 ||
      link.source.provider !== "managed" ||
      link.source.source_connection_id !== request.expected_source_connection_id ||
      link.source.source_generation !== request.expected_source_generation
    )
      throw new LocalSourcePublicationError("source_binding_required");
    request = { ...request, expected_commit_sha: link.source.last_confirmed_commit_sha };
  }
  parseManagedSourceRequest("upload", request);
  const record: PendingPublication = {
    version: 1,
    ...scope,
    operation_id: null,
    idempotency_key: input.idempotencyKey,
    snapshot_sha256: input.snapshotSha256,
    request,
  };
  if (original !== null) {
    assertSameAttempt(original, record);
  } else await writePending(record, true);
  return {
    request,
    accepted: async (operation) => {
      const current = await readPending(scope, replay);
      if (current === null) throw new LocalSourcePublicationError("source_publication_missing");
      assertSameAttempt(current, record);
      if (current.operation_id !== null && current.operation_id !== operation.id)
        throw new ResponseContractError();
      if (!replay) await writePending({ ...current, operation_id: operation.id }, false);
    },
    rejected: async (error) => {
      let code: string;
      try {
        code = parseSafeProblem(error).code;
      } catch {
        return;
      }
      if (
        code !== "source_generation_conflict" &&
        code !== "source_commit_conflict" &&
        code !== "idempotency_key_reused"
      )
        return;
      try {
        const current = await readPending(scope);
        if (current === null || current.operation_id !== null) return;
        assertSameAttempt(current, record);
      } catch (error) {
        if (
          error instanceof LocalSourcePublicationError &&
          (error.code === "source_publication_scope_mismatch" ||
            error.code === "source_publication_pending")
        )
          return;
        throw error;
      }
      try {
        await fs.unlink(pendingPath(scope));
      } catch (error) {
        if (!missing(error)) throw new LocalSourcePublicationError("source_local_state_invalid");
      }
    },
  };
}

/** Polling completes under the original identity and stores the operation's own confirmed commit. */
export async function completeLocalSourcePublication(input: {
  directory: string;
  metadataDirectory?: LocalSourceMetadataDirectory;
  apiOrigin: string;
  identity: unknown;
  projectId: string;
  operationId?: string;
  api: ManagedSourceApi;
  getOperation: (id: string) => Promise<Operation>;
}): Promise<{ status: "pending" | "completed"; operation: Operation; receipt: unknown }> {
  const scope = await publicationScope(
    input.directory,
    input.apiOrigin,
    input.identity,
    input.projectId,
    input.metadataDirectory,
  );
  let pending = await readPending(scope);
  const replay = pending === null;
  if (pending === null) pending = await readPending(scope, true);
  if (pending === null) throw new LocalSourcePublicationError("source_publication_missing");
  if (replay && pending.operation_id === null)
    throw new LocalSourcePublicationError("source_local_state_invalid");
  if (pending.operation_id === null) {
    const accepted = await input.api.createUpload({
      projectId: scope.project_id,
      idempotencyKey: pending.idempotency_key,
      body: pending.request,
    });
    parseOperation(accepted);
    pending = { ...pending, operation_id: accepted.id };
    await writePending(pending, false);
  }
  const operationId = pending.operation_id;
  if (
    operationId === null ||
    (input.operationId !== undefined && input.operationId !== operationId)
  )
    throw new LocalSourcePublicationError("source_publication_scope_mismatch");
  const operation = parseOperation(await input.getOperation(operationId));
  const receipt = await input.api.getUpload({ projectId: scope.project_id, operationId });
  assertManagedSourceResponse("upload", receipt);
  if (
    receipt.operation_id !== operationId ||
    operation.id !== operationId ||
    receipt.expected_source_generation !== pending.request.expected_source_generation ||
    receipt.expected_commit_sha !== pending.request.expected_commit_sha
  )
    throw new ResponseContractError();
  if (
    operation.state === "failed" ||
    operation.state === "cancelled" ||
    receipt.state === "failed"
  ) {
    if (!replay) await fs.unlink(pendingPath(scope));
    throw new LocalSourcePublicationError("source_publication_failed", operation);
  }
  if (
    operation.state !== "succeeded" ||
    receipt.state !== "committed" ||
    receipt.commit_sha === null
  )
    return { status: "pending", operation, receipt };
  const source = await input.api.getSource(scope.project_id);
  assertManagedSourceResponse("source", source);
  const managed = source as ManagedProjectSource;
  const generation =
    pending.request.expected_source_generation + (pending.request.mode === "commit" ? 0 : 1);
  if (
    managed.status !== "ready" ||
    managed.source_generation !== generation ||
    (pending.request.mode === "commit" &&
      managed.source_connection_id !== pending.request.expected_source_connection_id)
  )
    throw new LocalSourcePublicationError("source_publication_scope_mismatch");
  const tree = await input.api.files({
    projectId: scope.project_id,
    commitSha: receipt.commit_sha,
  });
  assertManagedSourceResponse("files", tree);
  if (
    typeof tree !== "object" ||
    tree === null ||
    !("files" in tree) ||
    !Array.isArray(tree.files) ||
    !("commit_sha" in tree) ||
    tree.commit_sha !== receipt.commit_sha
  )
    throw new ResponseContractError();
  const manifest = tree.files as { path: string; sha256: string; executable: boolean }[];
  const snapshot = `sha256:${createHash("sha256")
    .update(
      JSON.stringify(
        [...manifest]
          .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
          .map(({ path, sha256, executable }) => [path, sha256, executable]),
      ),
    )
    .digest("hex")}`;
  if (snapshot !== pending.snapshot_sha256)
    throw new LocalSourcePublicationError("source_publication_scope_mismatch");
  const binding = (await readProjectLinks(scope.metadata_directory, scope.api_origin)).links.find(
    (link) => link.organization_id === scope.organization_id,
  );
  if (binding !== undefined && binding.project_id !== scope.project_id)
    throw new LocalSourcePublicationError("source_publication_scope_mismatch");
  if (replay) {
    if (
      binding?.version !== 3 ||
      binding.source.provider !== "managed" ||
      binding.source.source_connection_id !== managed.source_connection_id ||
      binding.source.source_generation !== managed.source_generation ||
      binding.source.last_confirmed_commit_sha !== receipt.commit_sha
    )
      throw new LocalSourcePublicationError("source_publication_scope_mismatch");
    return { status: "completed", operation, receipt };
  }
  const current = await readPending(scope);
  if (current === null) throw new LocalSourcePublicationError("source_publication_missing");
  assertSameAttempt(current, pending);
  await new OwnerOnlyProjectLinkStore(scope.metadata_directory, scope.directory).save({
    version: 3,
    api_origin: scope.api_origin,
    organization_id: scope.organization_id,
    project_id: scope.project_id,
    source: {
      provider: "managed",
      source_connection_id: managed.source_connection_id,
      source_generation: managed.source_generation,
      namespace: managed.namespace,
      repository_name: managed.repository_name,
      branch: "main",
      last_confirmed_commit_sha: receipt.commit_sha,
    },
  });
  await writePending(pending, false, true);
  await fs.unlink(pendingPath(scope));
  return { status: "completed", operation, receipt };
}

/** Discovery reveals resumable project/operation identities, never stored keys or commit messages. */
export async function inspectLocalSourcePublications(
  directory: string,
): Promise<readonly Record<string, unknown>[]> {
  const root = await fs.realpath(resolve(directory));
  const result: Record<string, unknown>[] = [];
  for (const metadataDirectory of [".ohmyhost", ".ohmyhost/production"] as const) {
    const folder = join(root, metadataDirectory, "publications");
    let names: string[];
    try {
      await checkedDirectory(folder);
      names = await fs.readdir(folder);
    } catch (error) {
      if (missing(error)) continue;
      throw error;
    }
    if (names.length > 1000) throw new LocalSourcePublicationError("source_local_state_invalid");
    for (const name of names.sort()) {
      if (!/^[0-7][0-9A-HJKMNP-TV-Z]{25}-[0-7][0-9A-HJKMNP-TV-Z]{25}\.json$/u.test(name)) continue;
      const pending = await readRecord(join(folder, name));
      if (pending !== null)
        result.push({
          api_origin: pending.api_origin,
          organization_id: pending.organization_id,
          project_id: pending.project_id,
          operation_id: pending.operation_id,
          source_generation: pending.request.expected_source_generation,
          mode: pending.request.mode,
        });
    }
  }
  return result;
}

async function publicationScope(
  directory: string,
  apiOrigin: string,
  identity: unknown,
  projectId: string,
  metadataDirectory: LocalSourceMetadataDirectory = ".ohmyhost",
) {
  const user = parseCurrentIdentity(identity);
  const [organizationId, ...others] = user.organization_ids;
  if (organizationId === undefined || others.length !== 0 || !ULID.test(projectId))
    throw new LocalSourcePublicationError("source_publication_scope_mismatch");
  const root = await fs.realpath(resolve(directory));
  await checkedDirectory(root);
  return {
    directory: root,
    metadata_directory: join(root, metadataDirectory),
    api_origin: apiOrigin,
    organization_id: organizationId,
    actor_id: user.actor_id,
    project_id: projectId,
  };
}

function pendingPath(
  scope: Pick<PendingPublication, "metadata_directory" | "organization_id" | "project_id">,
): string {
  return join(
    scope.metadata_directory,
    "publications",
    `${scope.organization_id}-${scope.project_id}.json`,
  );
}

function completedPath(
  scope: Pick<PendingPublication, "metadata_directory" | "organization_id" | "project_id">,
): string {
  return join(
    scope.metadata_directory,
    "publications",
    `completed-${scope.organization_id}-${scope.project_id}.json`,
  );
}

async function readPending(
  scope: Pick<
    PendingPublication,
    | "directory"
    | "metadata_directory"
    | "api_origin"
    | "organization_id"
    | "actor_id"
    | "project_id"
  >,
  completed = false,
): Promise<PendingPublication | null> {
  const value = await readRecord(completed ? completedPath(scope) : pendingPath(scope));
  if (
    value !== null &&
    Object.entries(scope).some(([key, field]) => value[key as keyof PendingPublication] !== field)
  )
    throw new LocalSourcePublicationError("source_publication_scope_mismatch");
  return value;
}

async function readRecord(path: string): Promise<PendingPublication | null> {
  let handle;
  try {
    const status = await fs.lstat(path);
    if (
      !status.isFile() ||
      status.isSymbolicLink() ||
      status.size > 64 * 1024 ||
      (await fs.realpath(path)) !== path
    )
      throw new LocalSourcePublicationError("source_local_state_invalid");
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const content = Buffer.alloc(status.size + 1);
    const read = await handle.read({ buffer: content, length: content.byteLength, position: 0 });
    if (read.bytesRead !== status.size || (await handle.stat()).size !== status.size)
      throw new LocalSourcePublicationError("source_local_state_invalid");
    const raw = JSON.parse(content.subarray(0, read.bytesRead).toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      Object.keys(raw).sort().join(",") !==
        [
          "version",
          "directory",
          "metadata_directory",
          "api_origin",
          "organization_id",
          "actor_id",
          "project_id",
          "operation_id",
          "idempotency_key",
          "snapshot_sha256",
          "request",
        ]
          .sort()
          .join(",") ||
      raw["version"] !== 1 ||
      typeof raw["directory"] !== "string" ||
      typeof raw["metadata_directory"] !== "string" ||
      ![
        join(raw["directory"], ".ohmyhost"),
        join(raw["directory"], ".ohmyhost/production"),
      ].includes(raw["metadata_directory"]) ||
      typeof raw["api_origin"] !== "string" ||
      typeof raw["actor_id"] !== "string" ||
      typeof raw["organization_id"] !== "string" ||
      !ULID.test(raw["organization_id"]) ||
      typeof raw["project_id"] !== "string" ||
      !ULID.test(raw["project_id"]) ||
      (raw["operation_id"] !== null &&
        (typeof raw["operation_id"] !== "string" || !ULID.test(raw["operation_id"]))) ||
      !isSourcePublicationIdempotencyKey(raw["idempotency_key"]) ||
      typeof raw["snapshot_sha256"] !== "string" ||
      !DIGEST.test(raw["snapshot_sha256"])
    )
      throw new LocalSourcePublicationError("source_local_state_invalid");
    parseManagedSourceRequest("upload", raw["request"]);
    const origin = new URL(raw["api_origin"]);
    if (
      origin.origin !== raw["api_origin"] ||
      origin.username !== "" ||
      origin.password !== "" ||
      !["https:", "http:"].includes(origin.protocol)
    )
      throw new LocalSourcePublicationError("source_local_state_invalid");
    return raw as unknown as PendingPublication;
  } catch (error) {
    if (missing(error)) return null;
    if (error instanceof LocalSourcePublicationError) throw error;
    throw new LocalSourcePublicationError("source_local_state_invalid");
  } finally {
    await handle?.close();
  }
}

async function writePending(
  record: PendingPublication,
  create: boolean,
  completed = false,
): Promise<void> {
  const parent = join(record.directory, ".ohmyhost");
  for (const directory of [
    parent,
    record.metadata_directory,
    join(record.metadata_directory, "publications"),
  ]) {
    try {
      await fs.mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if (!existing(error)) throw new LocalSourcePublicationError("source_local_state_invalid");
    }
    await checkedDirectory(directory);
    await fs.chmod(directory, 0o700);
  }
  const target = completed ? completedPath(record) : pendingPath(record);
  const temporary = create ? target : `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(record)}\n`, { mode: 0o600, flag: "wx" });
    if (!create) await fs.rename(temporary, target);
  } catch (error) {
    if (existing(error) && create)
      throw new LocalSourcePublicationError("source_publication_pending");
    throw new LocalSourcePublicationError("source_local_state_invalid");
  } finally {
    if (!create) await fs.unlink(temporary).catch(() => undefined);
  }
}

function assertSameAttempt(left: PendingPublication, right: PendingPublication): void {
  if (
    left.idempotency_key !== right.idempotency_key ||
    left.snapshot_sha256 !== right.snapshot_sha256 ||
    canonicalRequest(left.request) !== canonicalRequest(right.request)
  )
    throw new LocalSourcePublicationError("source_publication_pending");
}
function canonicalRequest(request: ManagedSourceUploadRequest): string {
  return JSON.stringify([
    request.mode,
    request.expected_source_generation,
    request.expected_source_connection_id,
    request.expected_commit_sha,
    request.message,
  ]);
}
async function checkedDirectory(path: string): Promise<void> {
  const status = await fs.lstat(path);
  if (!status.isDirectory() || status.isSymbolicLink() || (await fs.realpath(path)) !== path)
    throw new LocalSourcePublicationError("source_local_state_invalid");
}
function missing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
function existing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
