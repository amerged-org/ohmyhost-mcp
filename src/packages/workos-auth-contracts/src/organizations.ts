import { expectRecord, expectString, parseIsoDate, WorkosContractError } from "./parsing.js";

export type WorkosMembershipState = "active" | "inactive" | "pending";

export interface WorkosOrganizationSnapshot {
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly memberships: readonly {
    readonly id: string;
    readonly userId: string;
    readonly status: WorkosMembershipState;
    readonly roles: readonly string[];
    readonly createdAt: string;
    readonly updatedAt: string;
  }[];
  readonly fetchedAt: string;
}

const parseMembership = (value: unknown, organizationId: string) => {
  const input = expectRecord(value, "invalid_membership");
  if (input["organization_id"] !== organizationId) {
    throw new WorkosContractError(
      "organization_mismatch",
      "Membership belongs to a different organization",
    );
  }
  if (
    input["status"] !== "active" &&
    input["status"] !== "inactive" &&
    input["status"] !== "pending"
  ) {
    throw new WorkosContractError("invalid_membership", "Membership status is invalid");
  }
  const rawRoles = input["roles"];
  if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
    throw new WorkosContractError("invalid_membership", "Membership roles are required");
  }
  const roles = rawRoles.map((value) => {
    const role = expectRecord(value, "invalid_role");
    return expectString(role["slug"], "role.slug");
  });
  const uniqueRoles = [...new Set(roles)].sort();
  if (uniqueRoles.length > 1) {
    throw new WorkosContractError(
      "unsupported_multiple_roles",
      "Membership has unsupported multiple roles",
    );
  }
  return {
    id: expectString(input["id"], "membership.id"),
    userId: expectString(input["user_id"], "membership.user_id"),
    status: input["status"],
    roles: uniqueRoles,
    createdAt: parseIsoDate(input["created_at"], "membership.created_at"),
    updatedAt: parseIsoDate(input["updated_at"], "membership.updated_at"),
  } satisfies WorkosOrganizationSnapshot["memberships"][number];
};

export const parseWorkosOrganizationSnapshot = (
  value: unknown,
  fetchedAt: Date,
): WorkosOrganizationSnapshot => {
  const input = expectRecord(value, "invalid_organization_snapshot");
  const organization = expectRecord(input["organization"], "invalid_organization");
  const organizationId = expectString(organization["id"], "organization.id");
  if (!Array.isArray(input["memberships"])) {
    throw new WorkosContractError("invalid_organization_snapshot", "Membership list is required");
  }
  const memberships = input["memberships"].map((item) => parseMembership(item, organizationId));
  const seenIds = new Set<string>();
  const seenUsers = new Set<string>();
  for (const membership of memberships) {
    if (seenIds.has(membership.id) || seenUsers.has(membership.userId)) {
      throw new WorkosContractError(
        "duplicate_membership",
        "Membership snapshot contains duplicates",
      );
    }
    seenIds.add(membership.id);
    seenUsers.add(membership.userId);
  }
  return {
    organization: {
      id: organizationId,
      name: expectString(organization["name"], "organization.name"),
      createdAt: parseIsoDate(organization["created_at"], "organization.created_at"),
      updatedAt: parseIsoDate(organization["updated_at"], "organization.updated_at"),
    },
    memberships: memberships.sort((left, right) => left.userId.localeCompare(right.userId)),
    fetchedAt: fetchedAt.toISOString(),
  };
};

export const canonicalizeWorkosOrganizationSnapshot = (
  snapshot: WorkosOrganizationSnapshot,
): string =>
  JSON.stringify({ organization: snapshot.organization, memberships: snapshot.memberships });

export interface WorkosOrganizationSnapshotSource {
  fetchCurrentOrganizationSnapshot(workosOrganizationId: string): Promise<unknown>;
}

export interface WorkosOrganizationSnapshotSink {
  applyCurrentSnapshot(input: {
    readonly triggerEventId: string;
    readonly snapshot: WorkosOrganizationSnapshot;
    readonly canonicalSnapshot: string;
  }): Promise<{ readonly changed: boolean; readonly mappingRevision: number }>;
}
