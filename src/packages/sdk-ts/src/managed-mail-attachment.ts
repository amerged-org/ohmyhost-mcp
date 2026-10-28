import type { Client } from "./generated/client/index.js";
import { getManagedMailAttachment } from "./generated/sdk.gen.js";

export interface ManagedMailAttachmentDownload {
  readonly projectId: string;
  readonly environmentId: string;
  readonly messageId: string;
  readonly attachmentId: string;
  readonly signal?: AbortSignal;
}

export type ManagedMailAttachmentResult =
  | Readonly<{ status: "expired" }>
  | Readonly<{ status: "download"; response: Response; body: ReadableStream<Uint8Array> }>;

/** Uses the generated authenticated GET without its automatic binary-to-Blob parser. */
export async function downloadManagedMailAttachment(
  client: Client,
  input: ManagedMailAttachmentDownload,
): Promise<ManagedMailAttachmentResult> {
  if (
    ![input.projectId, input.environmentId, input.messageId].every((id) =>
      /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u.test(id),
    ) ||
    !/^[A-Za-z0-9_-]{1,128}$/u.test(input.attachmentId)
  )
    invalid();
  // The generator's return type is fixed to data-only, despite supporting this explicit fields option.
  const result = (await getManagedMailAttachment(
    {
      project_id: input.projectId,
      environment_id: input.environmentId,
      message_id: input.messageId,
      attachment_id: input.attachmentId,
    },
    {
      client,
      parseAs: "stream",
      responseStyle: "fields",
      throwOnError: true,
      signal: input.signal,
    },
  )) as unknown as { response: Response; data: unknown };
  const response = result.response;
  if (
    !(response instanceof Response) ||
    response.status !== 200 ||
    response.body === null ||
    result.data !== response.body
  )
    invalid();
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType === "application/octet-stream") {
    return Object.freeze({ status: "download", response, body: response.body });
  }
  if (contentType !== "application/json") {
    void response.body.cancel().catch(ignoreCancellationError);
    invalid();
  }
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^[0-9]+$/u.test(declared) || Number(declared) > 1024)) {
    void response.body.cancel().catch(ignoreCancellationError);
    invalid();
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(1024);
  let length = 0;
  let finished = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        finished = true;
        break;
      }
      if (!(next.value instanceof Uint8Array) || length + next.value.byteLength > bytes.byteLength)
        invalid();
      bytes.set(next.value, length);
      length += next.value.byteLength;
    }
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)),
    );
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      (value as Record<string, unknown>)["status"] !== "expired"
    )
      invalid();
    return Object.freeze({ status: "expired" });
  } catch {
    return invalid();
  } finally {
    if (!finished) void reader.cancel().catch(ignoreCancellationError);
    reader.releaseLock();
  }
}

function invalid(): never {
  throw new Error("Mail attachment response contract invalid");
}

function ignoreCancellationError(): void {
  // Cleanup cannot replace the response contract failure.
}
