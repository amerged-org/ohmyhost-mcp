export interface UserApiKey {
  id: string;
  organization_id: string;
  name: string;
  obfuscated_value: string;
  permissions: string[];
  expires_at: string | null;
  created_at: string;
  last_used_at: string | null;
}
export interface UserApiKeyCreation {
  request_id: string;
  replayed: boolean;
  key: UserApiKey;
  value: string | null;
}
export interface UserApiKeyPage {
  data: UserApiKey[];
  next_cursor: string | null;
}
export const USER_API_KEY_ID = /^api_key_[A-Za-z0-9_]{1,120}$/u;
const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;

function object(value: unknown, fields: string): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== fields.split(",").sort().join(",")
  )
    throw new TypeError("Invalid user key response");
  return value as Record<string, unknown>;
}
function date(value: unknown): boolean {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
export function parseUserApiKey(value: unknown): UserApiKey {
  const v = object(
    value,
    "id,organization_id,name,obfuscated_value,permissions,expires_at,created_at,last_used_at",
  );
  if (
    typeof v["id"] !== "string" ||
    !USER_API_KEY_ID.test(v["id"]) ||
    typeof v["organization_id"] !== "string" ||
    !ulid.test(v["organization_id"]) ||
    typeof v["name"] !== "string" ||
    v["name"].trim() !== v["name"] ||
    v["name"].length < 1 ||
    v["name"].length > 128 ||
    /\p{Cc}/u.test(v["name"]) ||
    typeof v["obfuscated_value"] !== "string" ||
    !/^sk_(?:\.\.\.|…)[A-Za-z0-9_-]{1,12}$/u.test(v["obfuscated_value"]) ||
    !Array.isArray(v["permissions"]) ||
    v["permissions"].length > 100 ||
    new Set(v["permissions"]).size !== v["permissions"].length ||
    v["permissions"].some(
      (p: unknown) => typeof p !== "string" || !/^[A-Za-z0-9_.*:-]{1,128}$/u.test(p),
    ) ||
    !date(v["created_at"]) ||
    (v["expires_at"] !== null && !date(v["expires_at"])) ||
    (v["last_used_at"] !== null && !date(v["last_used_at"]))
  )
    throw new TypeError("Invalid user key metadata");
  return v as unknown as UserApiKey;
}
export function parseUserApiKeyCreation(value: unknown): UserApiKeyCreation {
  const v = object(value, "request_id,replayed,key,value");
  if (
    typeof v["request_id"] !== "string" ||
    !ulid.test(v["request_id"]) ||
    typeof v["replayed"] !== "boolean" ||
    (v["replayed"]
      ? v["value"] !== null
      : typeof v["value"] !== "string" || !/^sk_[A-Za-z0-9_-]{20,128}$/u.test(v["value"]))
  )
    throw new TypeError("Invalid user key creation");
  parseUserApiKey(v["key"]);
  return v as unknown as UserApiKeyCreation;
}
export function parseUserApiKeyPage(value: unknown): UserApiKeyPage {
  const v = object(value, "data,next_cursor");
  if (
    !Array.isArray(v["data"]) ||
    v["data"].length > 20 ||
    (v["next_cursor"] !== null &&
      (typeof v["next_cursor"] !== "string" || !USER_API_KEY_ID.test(v["next_cursor"])))
  )
    throw new TypeError("Invalid user key page");
  const keys = v["data"].map(parseUserApiKey);
  if (new Set(keys.map((key) => key.id)).size !== keys.length)
    throw new TypeError("Duplicate user keys");
  return v as unknown as UserApiKeyPage;
}
