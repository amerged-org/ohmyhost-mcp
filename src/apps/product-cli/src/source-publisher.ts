import { createHash } from "node:crypto";

import {
  assertManagedSourceResponse,
  parseManagedSourceRequest,
  type ManagedSourceBlobRequest,
  type ManagedSourceChangesRequest,
  type ManagedSourceFinalizeRequest,
  type ManagedSourceInitializeRequest,
  type ManagedSourceRestoreRequest,
  type ManagedSourceSwitchRequest,
  type ManagedSourceUploadReceipt,
  type ManagedSourceUploadRequest,
} from "@ohmyhost/contracts/managed-sources";
import type { Operation } from "@ohmyhost/sdk-ts";

import { parseOperation, ResponseContractError } from "./runtime-contract.js";
import type { SourceSnapshot } from "./source-workspace.js";

/** Product operations only. The composition supplies the generated SDK and its current login. */
export interface ManagedSourceApi {
  getSource(projectId: string): Promise<unknown>;
  initialize(input: {
    projectId: string;
    idempotencyKey: string;
    body: ManagedSourceInitializeRequest;
  }): Promise<Operation>;
  files(input: { projectId: string; commitSha?: string; path?: string }): Promise<unknown>;
  versions(input: {
    projectId: string;
    limit?: number;
    beforeCommitSha?: string;
  }): Promise<unknown>;
  diff(input: { projectId: string; fromCommitSha: string; toCommitSha: string }): Promise<unknown>;
  changes(input: {
    projectId: string;
    idempotencyKey: string;
    body: ManagedSourceChangesRequest;
  }): Promise<Operation>;
  restore(input: {
    projectId: string;
    idempotencyKey: string;
    body: ManagedSourceRestoreRequest;
  }): Promise<Operation>;
  createUpload(input: {
    projectId: string;
    idempotencyKey: string;
    body: ManagedSourceUploadRequest;
  }): Promise<Operation>;
  getUpload(input: { projectId: string; operationId: string }): Promise<ManagedSourceUploadReceipt>;
  putBlob(input: {
    projectId: string;
    operationId: string;
    idempotencyKey: string;
    body: ManagedSourceBlobRequest;
  }): Promise<unknown>;
  commitUpload(input: {
    projectId: string;
    operationId: string;
    idempotencyKey: string;
    body: ManagedSourceFinalizeRequest;
  }): Promise<Operation>;
  switchSource(input: {
    projectId: string;
    idempotencyKey: string;
    body: ManagedSourceSwitchRequest;
  }): Promise<Operation>;
}

export function isSourcePublicationIdempotencyKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !/[^\x20-\xff]/u.test(value) &&
    !/\p{Cc}/u.test(value)
  );
}

/** One stable current-file snapshot is staged and finalized as one source operation. */
export async function publishSourceSnapshot(input: {
  readonly api: ManagedSourceApi;
  readonly projectId: string;
  readonly request: ManagedSourceUploadRequest;
  readonly snapshot: SourceSnapshot;
  readonly idempotencyKey: string;
  readonly signal: AbortSignal;
  readonly accepted?: (operation: Operation) => Promise<void>;
  readonly rejected?: (error: unknown) => Promise<void>;
}): Promise<{ readonly operation: Operation; readonly receipt: ManagedSourceUploadReceipt }> {
  if (!isSourcePublicationIdempotencyKey(input.idempotencyKey))
    throw new TypeError("Managed source publication input is invalid");
  parseManagedSourceRequest("upload", input.request);
  const files = input.snapshot.files.map((file) => ({
    path: file.path,
    sha256: file.sha256,
    byte_length: file.byteLength,
    executable: file.executable,
  }));
  const manifest = parseManagedSourceRequest("finalize", {
    files,
    expected_source_generation: input.request.expected_source_generation,
  });
  input.signal.throwIfAborted();
  let accepted: Operation;
  try {
    accepted = await input.api.createUpload({
      projectId: input.projectId,
      body: input.request,
      idempotencyKey: input.idempotencyKey,
    });
  } catch (error) {
    await input.rejected?.(error);
    throw error;
  }
  parseOperation(accepted);
  await input.accepted?.(accepted);
  const receipt = await input.api.getUpload({
    projectId: input.projectId,
    operationId: accepted.id,
  });
  assertManagedSourceResponse("upload", receipt);
  if (
    receipt.operation_id !== accepted.id ||
    receipt.expected_source_generation !== input.request.expected_source_generation ||
    receipt.expected_commit_sha !== input.request.expected_commit_sha
  )
    throw new ResponseContractError();
  // A lost finalize response must be observed under the same operation, never uploaded again.
  if (receipt.state !== "staging") return { operation: accepted, receipt };
  for (const file of input.snapshot.files) {
    input.signal.throwIfAborted();
    const body = parseManagedSourceRequest("blob", {
      path: file.path,
      content_base64: file.contentBase64,
      sha256: file.sha256,
      executable: file.executable,
    });
    const stored = await input.api.putBlob({
      projectId: input.projectId,
      operationId: accepted.id,
      body,
      idempotencyKey: stepKey(input.idempotencyKey, input.snapshot.sha256, file.path),
    });
    assertManagedSourceResponse("blob", stored);
    const value = stored as Record<string, unknown>;
    if (
      value["path"] !== file.path ||
      value["sha256"] !== file.sha256 ||
      value["byte_length"] !== file.byteLength ||
      value["executable"] !== file.executable
    )
      throw new ResponseContractError();
  }
  input.signal.throwIfAborted();
  const idempotencyKey = stepKey(input.idempotencyKey, input.snapshot.sha256, "finalize");
  const operation =
    input.request.mode === "switch"
      ? await input.api.switchSource({
          projectId: input.projectId,
          idempotencyKey,
          body: parseManagedSourceRequest("switch", {
            ...manifest,
            upload_operation_id: accepted.id,
            expected_source_connection_id: input.request.expected_source_connection_id,
          }),
        })
      : await input.api.commitUpload({
          projectId: input.projectId,
          operationId: accepted.id,
          idempotencyKey,
          body: manifest,
        });
  parseOperation(operation);
  if (operation.id !== accepted.id) throw new ResponseContractError();
  const completed = await input.api.getUpload({
    projectId: input.projectId,
    operationId: operation.id,
  });
  assertManagedSourceResponse("upload", completed);
  if (
    completed.operation_id !== operation.id ||
    completed.expected_source_generation !== input.request.expected_source_generation ||
    completed.expected_commit_sha !== input.request.expected_commit_sha
  )
    throw new ResponseContractError();
  return { operation, receipt: completed };
}

function stepKey(key: string, snapshot: string, step: string): string {
  return `source-${createHash("sha256")
    .update(JSON.stringify([key, snapshot, step]))
    .digest("hex")}`;
}
