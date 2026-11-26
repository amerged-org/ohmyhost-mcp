import {
  executeRemoteOperation,
  remoteMcpToolDefinitions,
  type RemoteOperationInputs,
} from "./generated/mcp-remote.gen.js";
import type { Client } from "./generated/client/index.js";

/** Each command is a separate authenticated REST resource in the generated SDK. */
export const containerJobOperations = {
  publish: "publishContainerJobVersion",
  version: "getContainerJobVersion",
  quote: "quoteContainerJobRun",
  start: "startContainerJobRun",
  get: "getContainerJobRun",
  cancel: "cancelContainerJobRun",
  upload: "createContainerJobUpload",
  download: "createContainerJobDownload",
} as const;
export type ContainerJobOperationId =
  (typeof containerJobOperations)[keyof typeof containerJobOperations];
const operations: ReadonlySet<string> = new Set(Object.values(containerJobOperations));
export function isContainerJobOperation(id: string): id is ContainerJobOperationId {
  return operations.has(id);
}
export const containerJobTools = remoteMcpToolDefinitions.filter((d) =>
  isContainerJobOperation(d.operationId),
);

export function executeContainerJob(
  client: Client,
  operation: ContainerJobOperationId,
  input: Record<string, unknown>,
) {
  const contract = containerJobTools.find((tool) => tool.operationId === operation)?.inputSchema;
  const properties = contract?.["properties"],
    required = contract?.["required"];
  if (
    !properties ||
    typeof properties !== "object" ||
    !Array.isArray(required) ||
    Object.keys(input).some((k) => !Object.hasOwn(properties, k)) ||
    required.some((k) => typeof k !== "string" || !Object.hasOwn(input, k))
  )
    throw new TypeError("Invalid container job arguments");
  return executeRemoteOperation(
    operation,
    client,
    input as RemoteOperationInputs[ContainerJobOperationId],
  );
}
