export const PINNED_BUN_VERSION = "1.2.22";

const TYPESCRIPT_BUILD_STAGE = /^tsc(?:[ \t]+(?:--noEmit|-b|--build))?$/u;

/**
 * The same source is consumed by local admission, framework adapters and the build sandbox.
 * @param {"nextjs" | "tanstack-start" | "vite"} framework
 * @param {unknown} script
 * @returns {boolean}
 */
export function isAdmittedFrameworkBuildScript(framework, script) {
  if (typeof script !== "string") return false;
  if (framework === "nextjs") return script === "next build" || script === "next build --webpack";
  if (framework !== "vite" && framework !== "tanstack-start") return false;
  const stages = script.trim().split(/[ \t]*&&[ \t]*/u);
  if (stages.length === 1) return stages[0] === "vite build";
  if (stages.length !== 2) return false;
  return (
    (stages[0] === "vite build" && TYPESCRIPT_BUILD_STAGE.test(stages[1] ?? "")) ||
    (TYPESCRIPT_BUILD_STAGE.test(stages[0] ?? "") && stages[1] === "vite build")
  );
}
