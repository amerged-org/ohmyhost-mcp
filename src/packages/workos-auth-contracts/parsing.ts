export class WorkosContractError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "WorkosContractError";
  }
}

export const expectRecord = (value: unknown, code = "invalid_object"): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WorkosContractError(code, "WorkOS response must be an object");
  }
  return value as Record<string, unknown>;
};

export function expectString(value: unknown, field: string): string;
export function expectString(
  value: unknown,
  field: string,
  options: { readonly optional: true },
): string | undefined;
export function expectString(
  value: unknown,
  field: string,
  options: { readonly optional?: boolean } = {},
): string | undefined {
  if (value === undefined && options.optional === true) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw new WorkosContractError(
      "invalid_field",
      `WorkOS field ${field} must be a non-empty string`,
    );
  }
  return value;
}

export function expectPositiveInteger(value: unknown, field: string): number;
export function expectPositiveInteger(
  value: unknown,
  field: string,
  options: { readonly optional: true },
): number | undefined;
export function expectPositiveInteger(
  value: unknown,
  field: string,
  options: { readonly optional?: boolean } = {},
): number | undefined {
  if (value === undefined && options.optional === true) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new WorkosContractError("invalid_field", `WorkOS field ${field} must be positive`);
  }
  return value as number;
}

export const parseJsonObject = (body: string): Record<string, unknown> => {
  try {
    return expectRecord(JSON.parse(body) as unknown);
  } catch (error) {
    if (error instanceof WorkosContractError) throw error;
    throw new WorkosContractError("invalid_json", "WorkOS returned invalid JSON");
  }
};

export const parseIsoDate = (value: unknown, field: string): string => {
  const text = expectString(value, field);
  if (text === undefined || !Number.isFinite(Date.parse(text))) {
    throw new WorkosContractError(
      "invalid_field",
      `WorkOS field ${field} must be an ISO timestamp`,
    );
  }
  return new Date(text).toISOString();
};
