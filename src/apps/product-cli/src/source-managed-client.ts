import {
  changeManagedSource,
  commitManagedSourceUpload,
  createManagedSourceUpload,
  diffManagedSource,
  getManagedSourceUpload,
  getProjectSource,
  initializeManagedSource,
  listManagedSourceFiles,
  listManagedSourceVersions,
  putManagedSourceBlob,
  restoreManagedSource,
  switchManagedSource,
  type OhMyHostClient,
} from "@ohmyhost/sdk-ts";
import { assertManagedSourceResponse } from "@ohmyhost/contracts/managed-sources";

import type { ManagedSourceApi } from "./source-publisher.js";
import {
  parseOperation,
  parseProjectSourceBinding,
  ResponseContractError,
} from "./runtime-contract.js";

/** Shared SDK composition for CLI and local MCP; no provider or hand-written REST calls. */
export class GeneratedSdkManagedSourceApi implements ManagedSourceApi {
  public constructor(private readonly client: () => OhMyHostClient) {}

  public async getSource(projectId: string) {
    const value = await getProjectSource(
      { project_id: projectId, include_binding: true },
      { client: this.client() },
    );
    if (value !== null) parseProjectSourceBinding(value);
    return value;
  }
  public async initialize(input: Parameters<ManagedSourceApi["initialize"]>[0]) {
    return parseOperation(
      await initializeManagedSource(
        {
          project_id: input.projectId,
          "Idempotency-Key": input.idempotencyKey,
          managedSourceInitializeRequest: input.body,
        },
        { client: this.client() },
      ),
    );
  }
  public async files(input: Parameters<ManagedSourceApi["files"]>[0]) {
    const value = await listManagedSourceFiles(
      {
        project_id: input.projectId,
        ...(input.commitSha === undefined ? {} : { commit_sha: input.commitSha }),
        ...(input.path === undefined ? {} : { path: input.path }),
      },
      { client: this.client() },
    );
    checkedResponse("files", value);
    return value;
  }
  public async versions(input: Parameters<ManagedSourceApi["versions"]>[0]) {
    const value = await listManagedSourceVersions(
      {
        project_id: input.projectId,
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.beforeCommitSha === undefined
          ? {}
          : { before_commit_sha: input.beforeCommitSha }),
      },
      { client: this.client() },
    );
    checkedResponse("versions", value);
    return value;
  }
  public async diff(input: Parameters<ManagedSourceApi["diff"]>[0]) {
    const value = await diffManagedSource(
      {
        project_id: input.projectId,
        from_commit_sha: input.fromCommitSha,
        to_commit_sha: input.toCommitSha,
      },
      { client: this.client() },
    );
    checkedResponse("diff", value);
    return value;
  }
  public async changes(input: Parameters<ManagedSourceApi["changes"]>[0]) {
    return parseOperation(
      await changeManagedSource(
        {
          project_id: input.projectId,
          "Idempotency-Key": input.idempotencyKey,
          managedSourceChangesRequest: {
            ...input.body,
            changes: input.body.changes.map((change) => ({ ...change })),
          },
        },
        { client: this.client() },
      ),
    );
  }
  public async restore(input: Parameters<ManagedSourceApi["restore"]>[0]) {
    return parseOperation(
      await restoreManagedSource(
        {
          project_id: input.projectId,
          "Idempotency-Key": input.idempotencyKey,
          managedSourceRestoreRequest: input.body,
        },
        { client: this.client() },
      ),
    );
  }
  public async createUpload(input: Parameters<ManagedSourceApi["createUpload"]>[0]) {
    return parseOperation(
      await createManagedSourceUpload(
        {
          project_id: input.projectId,
          "Idempotency-Key": input.idempotencyKey,
          managedSourceUploadRequest: input.body,
        },
        { client: this.client() },
      ),
    );
  }
  public async getUpload(input: Parameters<ManagedSourceApi["getUpload"]>[0]) {
    const value = await getManagedSourceUpload(
      { project_id: input.projectId, operation_id: input.operationId },
      { client: this.client() },
    );
    checkedResponse("upload", value);
    return value;
  }
  public async putBlob(input: Parameters<ManagedSourceApi["putBlob"]>[0]) {
    const value = await putManagedSourceBlob(
      {
        project_id: input.projectId,
        operation_id: input.operationId,
        "Idempotency-Key": input.idempotencyKey,
        managedSourceBlobRequest: input.body,
      },
      { client: this.client() },
    );
    checkedResponse("blob", value);
    return value;
  }
  public async commitUpload(input: Parameters<ManagedSourceApi["commitUpload"]>[0]) {
    return parseOperation(
      await commitManagedSourceUpload(
        {
          project_id: input.projectId,
          operation_id: input.operationId,
          "Idempotency-Key": input.idempotencyKey,
          managedSourceFinalizeRequest: {
            ...input.body,
            files: input.body.files.map((file) => ({ ...file })),
          },
        },
        { client: this.client() },
      ),
    );
  }
  public async switchSource(input: Parameters<ManagedSourceApi["switchSource"]>[0]) {
    return parseOperation(
      await switchManagedSource(
        {
          project_id: input.projectId,
          "Idempotency-Key": input.idempotencyKey,
          managedSourceSwitchRequest: {
            ...input.body,
            files: input.body.files.map((file) => ({ ...file })),
          },
        },
        { client: this.client() },
      ),
    );
  }
}

function checkedResponse(
  kind: Parameters<typeof assertManagedSourceResponse>[0],
  value: unknown,
): void {
  try {
    assertManagedSourceResponse(kind, value);
  } catch {
    throw new ResponseContractError();
  }
}
