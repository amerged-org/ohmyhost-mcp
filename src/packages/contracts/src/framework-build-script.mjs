export const PINNED_BUN_VERSION = "1.2.22";

/**
 * The installed Next.js release must satisfy the same window as source admission.
 * @param {unknown} version
 * @returns {boolean}
 */
export function isAdmittedNextVersion(version) {
  if (typeof version !== "string") return false;
  const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.exec(version);
  if (match === null) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return false;
  return (
    (major === 15 && minor === 5 && patch >= 26) ||
    (major === 16 && minor === 3 && patch >= 6 && patch <= 7)
  );
}

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
