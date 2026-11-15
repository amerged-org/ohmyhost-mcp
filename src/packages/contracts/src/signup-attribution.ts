/** Bounded, explicit campaign parameters carried through the first account signup. */
export function isSignupUtm(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 20 &&
    entries.every(
      ([key, item]) =>
        /^utm_[a-z0-9_]{1,60}$/u.test(key) &&
        typeof item === "string" &&
        Array.from(item).length <= 256,
    ) &&
    new TextEncoder().encode(JSON.stringify(value)).byteLength <= 1024
  );
}
