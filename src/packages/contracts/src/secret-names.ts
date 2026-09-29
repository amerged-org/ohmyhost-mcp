/** Customer names and the platform's installed keys share one rule in API, CLI and MCP. */
export const USER_SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,127}$/u;
const FIXED_PLATFORM_NAMES = new Set([
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "DATABASE_URL",
  "HYPERDRIVE",
  "ASSETS",
  "FILES",
  "IMAGES",
  "STORAGE",
]);
const INSTALLED_PLATFORM_KEYS = new Set([
  "OHMYHOST_STORAGE_KEY",
  "OHMYHOST_MAIL_KEY",
  "BETTER_AUTH_SECRET",
]);

export function isUserSecretName(
  value: unknown,
  action: "set" | "delete" = "set",
): value is string {
  if (typeof value !== "string" || !USER_SECRET_NAME_PATTERN.test(value)) return false;
  return action === "delete"
    ? !INSTALLED_PLATFORM_KEYS.has(value)
    : !value.startsWith("OHMYHOST_") && !FIXED_PLATFORM_NAMES.has(value);
}
