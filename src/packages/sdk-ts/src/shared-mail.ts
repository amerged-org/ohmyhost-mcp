import type { Client } from "./generated/client/index.js";
import {
  listWorkspaceMailDomains,
  createWorkspaceMailDomain,
  getWorkspaceMailDomain,
  retireWorkspaceMailDomain,
  authorizeWorkspaceMailDomainDns,
  getWorkspaceMailDomainDnsAuthorization,
  getProjectMailDomainBinding,
  putProjectMailDomainBinding,
  detachProjectMailDomainBinding,
  getApplicationDomainIdentity,
  declareApplicationDomainIdentity,
  revokeApplicationDomainIdentity,
  verifyApplicationDomainIdentity,
  authorizeApplicationDomainIdentityDns,
  getApplicationDomainIdentityDnsAuthorization,
  revokeWorkspaceMailDomainDnsAuthorization,
  revokeApplicationDomainIdentityDnsAuthorization,
} from "./generated/sdk.gen.js";
import { assertSharedMailResponse } from "./shared-mail-response.js";

type Mutation = { idempotencyKey: string };
type Revision = { expectedRevision: number };
export type SharedMailCommand =
  | ({ organizationId: string } & (
      | { action: "domains_list" }
      | ({ action: "domain_create"; domain: string; sending: true } & Mutation)
      | { action: "domain_get"; mailDomainId: string }
      | ({ action: "domain_retire"; mailDomainId: string } & Revision & Mutation)
      | ({ action: "domain_dns_authorize"; mailDomainId: string; zone: string } & Revision &
          Mutation)
      | { action: "domain_dns_status"; mailDomainId: string }
      | ({ action: "domain_dns_revoke"; mailDomainId: string } & Revision & Mutation)
    ))
  | ({ projectId: string; environmentId: string } & (
      | { action: "binding_get" }
      | ({
          action: "binding_set";
          mailDomainId: string;
          sending: boolean;
          senderAddresses: readonly string[];
          defaultFrom: string;
          defaultReplyTo: string | null;
        } & Revision &
          Mutation)
      | ({ action: "binding_detach" } & Revision & Mutation)
    ))
  | ({ projectId: string } & (
      | { action: "identity_get" | "identity_authorization_status" }
      | ({ action: "identity_declare"; hostname: string } & Mutation)
      | ({
          action: "identity_verify" | "identity_revoke" | "identity_authorization_revoke";
        } & Revision &
          Mutation)
      | ({ action: "identity_authorize"; zone: string } & Revision & Mutation)
    ));

/** One exact REST adapter is used by local and remote customer clients. */
export async function executeSharedMail(client: Client, input: SharedMailCommand) {
  const options = { client };
  let result: unknown;
  switch (input.action) {
    case "domains_list":
      result = await listWorkspaceMailDomains({ organization_id: input.organizationId }, options);
      break;
    case "domain_create":
      result = await createWorkspaceMailDomain(
        {
          organization_id: input.organizationId,
          "Idempotency-Key": input.idempotencyKey,
          createWorkspaceMailDomainRequest: { domain: input.domain, sending: input.sending },
        },
        options,
      );
      break;
    case "domain_get":
      result = await getWorkspaceMailDomain(
        { organization_id: input.organizationId, mail_domain_id: input.mailDomainId },
        options,
      );
      break;
    case "domain_retire":
      result = await retireWorkspaceMailDomain(
        {
          organization_id: input.organizationId,
          mail_domain_id: input.mailDomainId,
          "Idempotency-Key": input.idempotencyKey,
          mailRevisionRequest: { expected_revision: input.expectedRevision },
        },
        options,
      );
      break;
    case "domain_dns_authorize":
      result = await authorizeWorkspaceMailDomainDns(
        {
          organization_id: input.organizationId,
          mail_domain_id: input.mailDomainId,
          "Idempotency-Key": input.idempotencyKey,
          sharedMailDnsAuthorizationRequest: {
            expected_revision: input.expectedRevision,
            zone: input.zone,
          },
        },
        options,
      );
      break;
    case "domain_dns_revoke":
      result = await revokeWorkspaceMailDomainDnsAuthorization(
        {
          organization_id: input.organizationId,
          mail_domain_id: input.mailDomainId,
          "Idempotency-Key": input.idempotencyKey,
          mailRevisionRequest: { expected_revision: input.expectedRevision },
        },
        options,
      );
      break;
    case "identity_authorization_revoke":
      result = await revokeApplicationDomainIdentityDnsAuthorization(
        {
          project_id: input.projectId,
          "Idempotency-Key": input.idempotencyKey,
          mailRevisionRequest: { expected_revision: input.expectedRevision },
        },
        options,
      );
      break;
    case "domain_dns_status":
      result = await getWorkspaceMailDomainDnsAuthorization(
        { organization_id: input.organizationId, mail_domain_id: input.mailDomainId },
        options,
      );
      break;
    case "binding_get":
      result = await getProjectMailDomainBinding(
        { project_id: input.projectId, environment_id: input.environmentId },
        options,
      );
      break;
    case "binding_set":
      result = await putProjectMailDomainBinding(
        {
          project_id: input.projectId,
          environment_id: input.environmentId,
          "Idempotency-Key": input.idempotencyKey,
          projectMailDomainBindingRequest: {
            mail_domain_id: input.mailDomainId,
            sending: input.sending,
            sender_addresses: [...input.senderAddresses],
            default_from: input.defaultFrom,
            default_reply_to: input.defaultReplyTo,
            expected_revision: input.expectedRevision,
          },
        },
        options,
      );
      break;
    case "binding_detach":
      result = await detachProjectMailDomainBinding(
        {
          project_id: input.projectId,
          environment_id: input.environmentId,
          "Idempotency-Key": input.idempotencyKey,
          mailRevisionRequest: { expected_revision: input.expectedRevision },
        },
        options,
      );
      break;
    case "identity_get":
      result = await getApplicationDomainIdentity({ project_id: input.projectId }, options);
      break;
    case "identity_declare":
      result = await declareApplicationDomainIdentity(
        {
          project_id: input.projectId,
          "Idempotency-Key": input.idempotencyKey,
          applicationDomainIdentityRequest: { hostname: input.hostname },
        },
        options,
      );
      break;
    case "identity_verify":
      result = await verifyApplicationDomainIdentity(
        {
          project_id: input.projectId,
          "Idempotency-Key": input.idempotencyKey,
          mailRevisionRequest: { expected_revision: input.expectedRevision },
        },
        options,
      );
      break;
    case "identity_revoke":
      result = await revokeApplicationDomainIdentity(
        {
          project_id: input.projectId,
          "Idempotency-Key": input.idempotencyKey,
          mailRevisionRequest: { expected_revision: input.expectedRevision },
        },
        options,
      );
      break;
    case "identity_authorize":
      result = await authorizeApplicationDomainIdentityDns(
        {
          project_id: input.projectId,
          "Idempotency-Key": input.idempotencyKey,
          sharedMailDnsAuthorizationRequest: {
            expected_revision: input.expectedRevision,
            zone: input.zone,
          },
        },
        options,
      );
      break;
    case "identity_authorization_status":
      result = await getApplicationDomainIdentityDnsAuthorization(
        { project_id: input.projectId },
        options,
      );
      break;
  }
  assertSharedMailResponse(result, input);
  return result;
}
