export type SaasCnameTarget = "customers.omh.st" | "customers.ohmyho.st";

export function isSaasCnameTarget(value: unknown): value is SaasCnameTarget {
  return value === "customers.omh.st" || value === "customers.ohmyho.st";
}
