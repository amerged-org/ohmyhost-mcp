export type FrameworkFamilyClassification =
  | "ambiguous"
  | "nextjs"
  | "tanstack-start"
  | "unknown"
  | "vite";

export function classifyFrameworkFamily(
  dependencies: ReadonlySet<string>,
): FrameworkFamilyClassification {
  const next = dependencies.has("next");
  const tanStack = dependencies.has("@tanstack/react-start");
  const vite = dependencies.has("vite");
  if (next && (tanStack || vite)) return "ambiguous";
  if (next) return "nextjs";
  if (tanStack) return "tanstack-start";
  return vite ? "vite" : "unknown";
}
