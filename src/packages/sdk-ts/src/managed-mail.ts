import { assertManagedMailResponse } from "./managed-mail-response.js";
import type { Client } from "./generated/client/index.js";
import {
  configureManagedMailDomain,
  getManagedMailDomain,
  prepareManagedMailWebhook,
  verifyManagedMailWebhook,
  disableManagedMailReceiving,
  deleteManagedMailDomain,
  listManagedMailMessages,
  getManagedMailMessage,
  retryManagedMailMessage,
} from "./generated/sdk.gen.js";
export type ManagedMailCommand = { projectId: string; environmentId: string } & (
  | {
      action: "configure";
      domain: string;
      sending: boolean;
      receiving: boolean;
      idempotencyKey: string;
    }
  | { action: "status" }
  | { action: "webhook_set"; url: string; idempotencyKey: string }
  | { action: "webhook_verify" | "webhook_disable" | "domain_delete"; idempotencyKey: string }
  | { action: "messages_list"; after?: string }
  | { action: "message_get"; messageId: string }
  | { action: "message_retry"; messageId: string; idempotencyKey: string }
);
/** All client surfaces call the same generated REST operations. */
function requestManagedMail(client: Client, input: ManagedMailCommand) {
  const scope = { project_id: input.projectId, environment_id: input.environmentId };
  switch (input.action) {
    case "configure":
      return configureManagedMailDomain(
        {
          ...scope,
          "Idempotency-Key": input.idempotencyKey,
          managedMailDomainRequest: {
            domain: input.domain,
            sending: input.sending,
            receiving: input.receiving,
          },
        },
        { client },
      );
    case "status":
      return getManagedMailDomain(scope, { client });
    case "webhook_set":
      return prepareManagedMailWebhook(
        {
          ...scope,
          "Idempotency-Key": input.idempotencyKey,
          managedMailWebhookRequest: { url: input.url },
        },
        { client },
      );
    case "webhook_verify":
      return verifyManagedMailWebhook(
        { ...scope, "Idempotency-Key": input.idempotencyKey },
        { client },
      );
    case "webhook_disable":
      return disableManagedMailReceiving(
        { ...scope, "Idempotency-Key": input.idempotencyKey },
        { client },
      );
    case "domain_delete":
      return deleteManagedMailDomain(
        { ...scope, "Idempotency-Key": input.idempotencyKey },
        { client },
      );
    case "messages_list":
      return listManagedMailMessages(
        { ...scope, ...(input.after ? { after: input.after } : {}) },
        { client },
      );
    case "message_get":
      return getManagedMailMessage({ ...scope, message_id: input.messageId }, { client });
    case "message_retry":
      return retryManagedMailMessage(
        { ...scope, message_id: input.messageId, "Idempotency-Key": input.idempotencyKey },
        { client },
      );
  }
}

export async function executeManagedMail(client: Client, input: ManagedMailCommand) {
  const result = await requestManagedMail(client, input);
  assertManagedMailResponse(result, input);
  return result;
}
