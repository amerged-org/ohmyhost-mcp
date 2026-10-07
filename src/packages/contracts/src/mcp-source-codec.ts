import {
  assertManagedSourceResponse,
  MANAGED_SOURCE_LIMITS,
  parseManagedSourceRequest,
} from "./managed-sources.js";
import type {
  ManagedSourceChangesRequest,
  ManagedSourceFile,
  ManagedSourceFileResponse,
  ManagedSourceFiles,
  SourceManifestFile,
} from "./managed-sources.js";

/** MCP presentation only: these fields are never part of the canonical REST contract. */
export interface McpSourceTextFileResponse {
  readonly commit_sha: string;
  readonly file: SourceManifestFile & {
    readonly content_text: string;
    readonly encoding: "utf8";
  };
}

export interface McpSourceBinaryFileResponse {
  readonly commit_sha: string;
  readonly file: ManagedSourceFile & {
    readonly encoding: "base64";
    readonly guidance: string;
  };
}

export type McpSourceFileReadResponse =
  | ManagedSourceFiles
  | ManagedSourceFileResponse
  | McpSourceTextFileResponse
  | McpSourceBinaryFileResponse;

/** Allows MCP transports to classify user input separately from invalid upstream data. */
export class McpSourceChangesInputError extends TypeError {
  constructor() {
    super("MCP source changes are invalid");
    this.name = "McpSourceChangesInputError";
  }
}

/**
 * Accepts exactly one own content_text or content_base64 field per MCP change.
 * Missing executable defaults to false; null content_base64 retains deletion semantics.
 * The returned request is exclusively canonical REST data, with its existing limits.
 */
export function normalizeMcpSourceChanges(value: unknown): ManagedSourceChangesRequest {
  try {
    return normalizeSourceChanges(value);
  } catch {
    throw new McpSourceChangesInputError();
  }
}

function normalizeSourceChanges(value: unknown): ManagedSourceChangesRequest {
  const body = record(value);
  const changes = body["changes"];
  if (!Array.isArray(changes) || changes.length < 1 || changes.length > MANAGED_SOURCE_LIMITS.files)
    invalid();
  let textBytes = 0;
  const normalized = changes.map((change: unknown) => {
    const entry = record(change);
    const hasText = Object.hasOwn(entry, "content_text");
    if (hasText === Object.hasOwn(entry, "content_base64")) invalid();
    const result = {
      ...entry,
      executable: Object.hasOwn(entry, "executable") ? entry["executable"] : false,
    } as Record<string, unknown>;
    if (hasText) {
      const text = entry["content_text"];
      if (typeof text !== "string" || text.length > MANAGED_SOURCE_LIMITS.fileBytes) invalid();
      const bytes = new TextEncoder().encode(text);
      if (
        bytes.byteLength > MANAGED_SOURCE_LIMITS.fileBytes ||
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !== text
      )
        invalid();
      textBytes += bytes.byteLength;
      // Bound allocations before producing a batch of encoded strings.
      if (textBytes > MANAGED_SOURCE_LIMITS.uploadBytes) invalid();
      result["content_base64"] = encodeBase64(bytes);
      delete result["content_text"];
    }
    return result;
  });
  return parseManagedSourceRequest("changes", { ...body, changes: normalized });
}

/**
 * Validates the canonical source response before adding MCP-only presentation fields.
 * Manifest and explicit base64 responses remain unchanged. Text mode replaces the
 * payload with content_text only when strict UTF-8 decoding preserves every byte
 * and contains no binary control characters. Otherwise it returns the original
 * base64 payload and binary guidance.
 */
export function formatMcpSourceFileResponse(
  value: unknown,
  format: "text" | "base64" = "text",
): McpSourceFileReadResponse {
  if (format !== "text" && format !== "base64") invalid();
  assertManagedSourceResponse("files", value);
  const response = value as ManagedSourceFiles | ManagedSourceFileResponse;
  if (format === "base64" || !("file" in response)) return response;
  const { content_base64, ...metadata } = response.file;
  const bytes = Uint8Array.from(atob(content_base64), (character) => character.charCodeAt(0));
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (
      !bytes.some(
        (byte) => (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127,
      ) &&
      encodeBase64(new TextEncoder().encode(text)) === content_base64
    ) {
      return {
        commit_sha: response.commit_sha,
        file: { ...metadata, content_text: text, encoding: "utf8" },
      };
    }
  } catch {
    // Non-UTF-8 files retain their canonical payload rather than replacement characters.
  }
  return {
    commit_sha: response.commit_sha,
    file: {
      ...response.file,
      encoding: "base64",
      guidance:
        "Binary file: preserve content_base64 and use content_base64 when writing this file.",
    },
  };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function invalid(): never {
  throw new TypeError("MCP source content is invalid");
}
