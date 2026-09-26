import { expectRecord, expectString, parseIsoDate, WorkosContractError } from "./parsing.js";
import type { WorkosMembershipState, WorkosOrganizationSnapshot } from "./organizations.js";

export type WorkosFgaPrincipalKind = "user" | "organization_api_key" | "m2m_service";
export type WorkosUserAuthenticationMethod = "interactive" | "device_flow";
export type WorkosFgaPrincipal =
  | {
      readonly kind: "user";
      readonly id: `user:${string}`;
      readonly authenticationMethod: WorkosUserAuthenticationMethod;
    }
  | { readonly kind: "organization_api_key"; readonly id: `api_key:${string}` }
  | { readonly kind: "m2m_service"; readonly id: `service:${string}` };
export type WorkosFgaResourceType = "organization" | "project" | "environment";
export type WorkosFgaAction =
  | "organization.read"
  | "project.create"
  | "project.read"
  | "project.deploy"
  | "project.transfer"
  | "operation.read"
  | "audit.read";

export const WORKOS_CAPABILITY_OBSERVATION_IDS = [
  "authkit_oidc_metadata",
  "connect_applications_read",
  "connect_client_secrets_metadata_read",
  "fga_resources_read",
  "memberships_read",
  "m2m_token_flow",
  "organizations_read",
  "webhook_endpoints_read",
] as const;

export type WorkosCapabilityObservationId = (typeof WORKOS_CAPABILITY_OBSERVATION_IDS)[number];

export interface WorkosCapabilityObservation {
  readonly id: WorkosCapabilityObservationId;
  readonly available: boolean;
  readonly statusCode: number;
  readonly count?: number;
}

export type WorkosManagementRpcRequest =
  | {
      readonly method: "organizations.get_current_snapshot";
      readonly requestId: string;
      readonly payload: { readonly workosOrganizationId: string };
    }
  | {
      readonly method: "capabilities.probe_read_only";
      readonly requestId: string;
      readonly payload: Record<string, never>;
    }
  | {
      readonly method: "fga.check_candidate";
      readonly requestId: string;
      readonly payload: {
        readonly principal: WorkosFgaPrincipal;
        readonly organizationId: string;
        readonly resource: {
          readonly type: WorkosFgaResourceType;
          readonly id: string;
        };
        readonly action: WorkosFgaAction;
      };
    };

export type WorkosManagementRpcResponse =
  | {
      readonly method: "organizations.get_current_snapshot";
      readonly requestId: string;
      readonly ok: true;
      readonly result: { readonly snapshot: WorkosOrganizationSnapshot };
    }
  | {
      readonly method: "capabilities.probe_read_only";
      readonly requestId: string;
      readonly ok: true;
      readonly result: { readonly observations: readonly WorkosCapabilityObservation[] };
    }
  | {
      readonly method: "fga.check_candidate";
      readonly requestId: string;
      readonly ok: true;
      readonly result: { readonly decision: "allow" | "deny" };
    }
  | {
      readonly method: WorkosManagementRpcRequest["method"];
      readonly requestId: string;
      readonly ok: false;
      readonly error: { readonly code: "invalid_request" | "not_found" | "unavailable" };
    };

export interface WorkosManagementRpc {
  call(request: WorkosManagementRpcRequest): Promise<WorkosManagementRpcResponse>;
}

const assertOnlyKeys = (input: Record<string, unknown>, allowed: readonly string[]) => {
  const allowedKeys = new Set(allowed);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    throw new WorkosContractError("rpc_field_not_allowed", "Management RPC field is not allowed");
  }
};

const parseMembershipState = (value: unknown): WorkosMembershipState => {
  if (value !== "active" && value !== "inactive" && value !== "pending") {
    throw new WorkosContractError("invalid_rpc_membership", "RPC membership status is invalid");
  }
  return value;
};

const parsePrincipalKind = (value: unknown): WorkosFgaPrincipalKind => {
  if (value !== "user" && value !== "organization_api_key" && value !== "m2m_service") {
    throw new WorkosContractError("invalid_rpc_principal", "RPC principal kind is invalid");
  }
  return value;
};

const parseCanonicalPrincipalId = <Prefix extends "user" | "api_key" | "service">(
  value: unknown,
  prefix: Prefix,
): `${Prefix}:${string}` => {
  const id = expectString(value, "principal.id");
  if (!new RegExp(`^${prefix}:[A-Za-z0-9_-]+$`, "u").test(id)) {
    throw new WorkosContractError("invalid_rpc_principal_id", "RPC principal ID is not canonical");
  }
  return id as `${Prefix}:${string}`;
};

const parsePrincipal = (value: unknown): WorkosFgaPrincipal => {
  const principal = expectRecord(value, "invalid_rpc_principal");
  const kind = parsePrincipalKind(principal["kind"]);
  if (kind === "user") {
    assertOnlyKeys(principal, ["kind", "id", "authenticationMethod"]);
    const authenticationMethod = principal["authenticationMethod"];
    if (authenticationMethod !== "interactive" && authenticationMethod !== "device_flow") {
      throw new WorkosContractError(
        "invalid_rpc_authentication_method",
        "RPC user authentication method is invalid",
      );
    }
    return {
      kind,
      id: parseCanonicalPrincipalId(principal["id"], "user"),
      authenticationMethod,
    };
  }
  assertOnlyKeys(principal, ["kind", "id"]);
  return kind === "organization_api_key"
    ? { kind, id: parseCanonicalPrincipalId(principal["id"], "api_key") }
    : { kind, id: parseCanonicalPrincipalId(principal["id"], "service") };
};

const parseResourceType = (value: unknown): WorkosFgaResourceType => {
  if (value !== "organization" && value !== "project" && value !== "environment") {
    throw new WorkosContractError("invalid_rpc_resource", "RPC resource type is invalid");
  }
  return value;
};

const parseFgaAction = (value: unknown): WorkosFgaAction => {
  if (
    value !== "organization.read" &&
    value !== "project.create" &&
    value !== "project.read" &&
    value !== "project.deploy" &&
    value !== "project.transfer" &&
    value !== "operation.read" &&
    value !== "audit.read"
  ) {
    throw new WorkosContractError("invalid_rpc_action", "RPC action is invalid");
  }
  return value;
};

const parseCanonicalSnapshot = (value: unknown): WorkosOrganizationSnapshot => {
  const input = expectRecord(value, "invalid_rpc_snapshot");
  assertOnlyKeys(input, ["organization", "memberships", "fetchedAt"]);
  const organization = expectRecord(input["organization"], "invalid_rpc_organization");
  assertOnlyKeys(organization, ["id", "name", "createdAt", "updatedAt"]);
  if (!Array.isArray(input["memberships"])) {
    throw new WorkosContractError("invalid_rpc_snapshot", "RPC memberships must be an array");
  }
  const memberships = input["memberships"].map((value) => {
    const membership = expectRecord(value, "invalid_rpc_membership");
    assertOnlyKeys(membership, ["id", "userId", "status", "roles", "createdAt", "updatedAt"]);
    const status = parseMembershipState(membership["status"]);
    const roles = membership["roles"];
    if (!Array.isArray(roles) || roles.length === 0) {
      throw new WorkosContractError("invalid_rpc_membership", "RPC membership roles are invalid");
    }
    const uniqueRoles = [
      ...new Set(roles.map((role) => expectString(role, "membership.role"))),
    ].sort();
    if (uniqueRoles.length > 1) {
      throw new WorkosContractError(
        "unsupported_multiple_roles",
        "Membership has unsupported multiple roles",
      );
    }
    return {
      id: expectString(membership["id"], "membership.id"),
      userId: expectString(membership["userId"], "membership.userId"),
      status,
      roles: uniqueRoles,
      createdAt: parseIsoDate(membership["createdAt"], "membership.createdAt"),
      updatedAt: parseIsoDate(membership["updatedAt"], "membership.updatedAt"),
    };
  });
  return {
    organization: {
      id: expectString(organization["id"], "organization.id"),
      name: expectString(organization["name"], "organization.name"),
      createdAt: parseIsoDate(organization["createdAt"], "organization.createdAt"),
      updatedAt: parseIsoDate(organization["updatedAt"], "organization.updatedAt"),
    },
    memberships,
    fetchedAt: parseIsoDate(input["fetchedAt"], "fetchedAt"),
  };
};

const capabilityObservationIds = new Set<string>(WORKOS_CAPABILITY_OBSERVATION_IDS);

const parseCapabilityObservation = (value: unknown): WorkosCapabilityObservation => {
  const observation = expectRecord(value, "invalid_rpc_capability_observation");
  assertOnlyKeys(observation, ["id", "available", "statusCode", "count"]);
  const id = expectString(observation["id"], "observation.id");
  if (!capabilityObservationIds.has(id)) {
    throw new WorkosContractError(
      "invalid_rpc_capability_observation",
      "RPC capability observation ID is invalid",
    );
  }
  if (typeof observation["available"] !== "boolean") {
    throw new WorkosContractError(
      "invalid_rpc_capability_observation",
      "RPC capability availability is invalid",
    );
  }
  const statusCode = observation["statusCode"];
  if (
    !Number.isSafeInteger(statusCode) ||
    (statusCode as number) < 100 ||
    (statusCode as number) > 599
  ) {
    throw new WorkosContractError(
      "invalid_rpc_capability_observation",
      "RPC capability status code is invalid",
    );
  }
  const count = observation["count"];
  if (count !== undefined && (!Number.isSafeInteger(count) || (count as number) < 0)) {
    throw new WorkosContractError(
      "invalid_rpc_capability_observation",
      "RPC capability count is invalid",
    );
  }
  const parsed = {
    id: id as WorkosCapabilityObservationId,
    available: observation["available"],
    statusCode: statusCode as number,
  };
  return count === undefined ? parsed : { ...parsed, count: count as number };
};

export const parseWorkosManagementRpcRequest = (value: unknown): WorkosManagementRpcRequest => {
  const input = expectRecord(value, "invalid_rpc_request");
  assertOnlyKeys(input, ["method", "requestId", "payload"]);
  const requestId = expectString(input["requestId"], "requestId");
  const payload = expectRecord(input["payload"], "invalid_rpc_payload");
  if (input["method"] === "organizations.get_current_snapshot") {
    assertOnlyKeys(payload, ["workosOrganizationId"]);
    return {
      method: input["method"],
      requestId,
      payload: {
        workosOrganizationId: expectString(payload["workosOrganizationId"], "workosOrganizationId"),
      },
    };
  }
  if (input["method"] === "capabilities.probe_read_only") {
    assertOnlyKeys(payload, []);
    return { method: input["method"], requestId, payload: {} };
  }
  if (input["method"] === "fga.check_candidate") {
    assertOnlyKeys(payload, ["principal", "organizationId", "resource", "action"]);
    const principal = parsePrincipal(payload["principal"]);
    const resource = expectRecord(payload["resource"], "invalid_rpc_resource");
    assertOnlyKeys(resource, ["type", "id"]);
    const resourceType = parseResourceType(resource["type"]);
    const action = parseFgaAction(payload["action"]);
    return {
      method: input["method"],
      requestId,
      payload: {
        principal,
        organizationId: expectString(payload["organizationId"], "organizationId"),
        resource: {
          type: resourceType,
          id: expectString(resource["id"], "resource.id"),
        },
        action,
      },
    };
  }
  throw new WorkosContractError("rpc_method_not_allowed", "Management RPC method is not allowed");
};

export const parseWorkosManagementRpcResponse = (value: unknown): WorkosManagementRpcResponse => {
  const input = expectRecord(value, "invalid_rpc_response");
  const requestId = expectString(input["requestId"], "requestId");
  if (
    input["method"] !== "organizations.get_current_snapshot" &&
    input["method"] !== "capabilities.probe_read_only" &&
    input["method"] !== "fga.check_candidate"
  ) {
    throw new WorkosContractError("rpc_method_not_allowed", "Management RPC method is not allowed");
  }
  if (input["ok"] === false) {
    assertOnlyKeys(input, ["method", "requestId", "ok", "error"]);
    const error = expectRecord(input["error"], "invalid_rpc_error");
    assertOnlyKeys(error, ["code"]);
    if (
      error["code"] !== "invalid_request" &&
      error["code"] !== "not_found" &&
      error["code"] !== "unavailable"
    ) {
      throw new WorkosContractError("invalid_rpc_error", "Management RPC error code is invalid");
    }
    return { method: input["method"], requestId, ok: false, error: { code: error["code"] } };
  }
  if (input["ok"] !== true) {
    throw new WorkosContractError("invalid_rpc_response", "Management RPC status is invalid");
  }
  assertOnlyKeys(input, ["method", "requestId", "ok", "result"]);
  const result = expectRecord(input["result"], "invalid_rpc_result");
  if (input["method"] === "organizations.get_current_snapshot") {
    assertOnlyKeys(result, ["snapshot"]);
    return {
      method: input["method"],
      requestId,
      ok: true,
      result: { snapshot: parseCanonicalSnapshot(result["snapshot"]) },
    };
  }
  if (input["method"] === "capabilities.probe_read_only") {
    assertOnlyKeys(result, ["observations"]);
    if (!Array.isArray(result["observations"])) {
      throw new WorkosContractError(
        "invalid_rpc_result",
        "Management RPC capability observations are invalid",
      );
    }
    const observations = result["observations"].map(parseCapabilityObservation);
    if (new Set(observations.map(({ id }) => id)).size !== observations.length) {
      throw new WorkosContractError(
        "invalid_rpc_result",
        "Management RPC capability observations contain duplicates",
      );
    }
    return {
      method: input["method"],
      requestId,
      ok: true,
      result: { observations },
    };
  }
  assertOnlyKeys(result, ["decision"]);
  if (result["decision"] !== "allow" && result["decision"] !== "deny") {
    throw new WorkosContractError("invalid_rpc_result", "Management RPC decision is invalid");
  }
  return {
    method: input["method"],
    requestId,
    ok: true,
    result: { decision: result["decision"] },
  };
};
