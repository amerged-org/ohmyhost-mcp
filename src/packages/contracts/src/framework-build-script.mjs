export const PINNED_BUN_VERSION = "1.2.22";

/**
 * @typedef {"next" | "vite" | "@tanstack/react-start"} FrameworkVersionPackage
 * @typedef {Readonly<{
 *   floors: readonly string[];
 *   denied: readonly (readonly [string, string | null])[];
 * }>} FrameworkVersionPolicyEntry
 * @typedef {Readonly<Record<FrameworkVersionPackage, FrameworkVersionPolicyEntry>>} FrameworkVersionPolicy
 */

/**
 * Security floors per framework package. A stable release is admitted when it is at or above the
 * highest floor whose major is not above its own major, and outside every denied range. There is no
 * upper bound: later patches, minors and majors reach the real build, which reports adapter failures.
 * Denied ranges are half-open [introduced, fixed); a null fix denies every later release.
 *
 * next: GHSA-4jqv-mc3x-m676 and GHSA-mcj8-r9mp-w47p (fixed in 15.5.27 and 16.3.8); GHSA-cjq9-62q9-8jv4,
 *   GHSA-f87g-xv8r-7p7x, GHSA-3w37-wq28-93x7, GHSA-h694-7cp9-m8p3 and GHSA-39w2-rjm5-chcv (16.3.8).
 * @tanstack/react-start: GHSA-qx66-fv34-fjm8 (fixed in 1.168.60).
 * vite: GHSA-64vr-g452-qvp3 (fixed in 5.4.6), the only advisory affecting `vite build` output.
 * @type {FrameworkVersionPolicy}
 */
export const FRAMEWORK_VERSION_POLICY = Object.freeze({
  next: Object.freeze({ floors: Object.freeze(["15.5.27", "16.3.8"]), denied: Object.freeze([]) }),
  vite: Object.freeze({ floors: Object.freeze(["5.4.6"]), denied: Object.freeze([]) }),
  "@tanstack/react-start": Object.freeze({
    floors: Object.freeze(["1.168.60"]),
    denied: Object.freeze([]),
  }),
});

const STABLE_VERSION = /^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/u;

/**
 * @param {unknown} version
 * @returns {readonly [number, number, number] | null}
 */
export function parseStableVersion(version) {
  if (typeof version !== "string") return null;
  const match = STABLE_VERSION.exec(version);
  return match === null
    ? null
    : Object.freeze([Number(match[1]), Number(match[2]), Number(match[3])]);
}

/**
 * @param {readonly [number, number, number]} left
 * @param {readonly [number, number, number]} right
 * @returns {number}
 */
export function compareStableVersions(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/**
 * @param {unknown} packageName
 * @param {FrameworkVersionPolicy} policy
 * @returns {FrameworkVersionPolicyEntry | null}
 */
function packagePolicy(packageName, policy) {
  return typeof packageName === "string" && Object.hasOwn(policy, packageName)
    ? policy[/** @type {FrameworkVersionPackage} */ (packageName)]
    : null;
}

/**
 * The floor that applies to a release line: the highest floor whose major is not above its major.
 * @param {FrameworkVersionPolicyEntry} entry
 * @param {readonly [number, number, number]} version
 * @returns {readonly [number, number, number] | null}
 */
function applicableFloor(entry, version) {
  let floor = null;
  for (const candidate of entry.floors) {
    const parsed = parseStableVersion(candidate);
    if (parsed !== null && parsed[0] <= version[0]) floor = parsed;
  }
  return floor;
}

/**
 * @param {unknown} packageName
 * @param {unknown} version
 * @param {FrameworkVersionPolicy} [policy]
 * @returns {"admitted" | "invalid_version" | "below_security_minimum" | "known_vulnerable"}
 */
export function frameworkVersionVerdict(packageName, version, policy = FRAMEWORK_VERSION_POLICY) {
  const entry = packagePolicy(packageName, policy);
  const parsed = parseStableVersion(version);
  if (entry === null || parsed === null) return "invalid_version";
  const floor = applicableFloor(entry, parsed);
  if (floor === null || compareStableVersions(parsed, floor) < 0) return "below_security_minimum";
  for (const [introduced, fixed] of entry.denied) {
    const from = parseStableVersion(introduced);
    const to = fixed === null ? null : parseStableVersion(fixed);
    if (
      from !== null &&
      compareStableVersions(parsed, from) >= 0 &&
      (to === null || compareStableVersions(parsed, to) < 0)
    )
      return "known_vulnerable";
  }
  return "admitted";
}

/**
 * The lowest release a customer can move to from the line of `version`: its floor (or the lowest
 * floor for an unknown or older line), raised past a denied range that contains it. A range or a
 * prerelease is placed on the line of its numeric core.
 * @param {unknown} packageName
 * @param {unknown} version
 * @param {FrameworkVersionPolicy} [policy]
 * @returns {string}
 */
export function frameworkVersionMinimum(packageName, version, policy = FRAMEWORK_VERSION_POLICY) {
  const entry = packagePolicy(packageName, policy);
  if (entry === null) throw new TypeError("Framework version package is not governed");
  const lowest = parseStableVersion(entry.floors[0]);
  if (lowest === null) throw new TypeError("Framework version policy is invalid");
  const core =
    typeof version === "string"
      ? /^[~^]?((?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5}))(?:[-+].*)?$/u.exec(
          version,
        )
      : null;
  const parsed = parseStableVersion(core?.[1]);
  let minimum = (parsed === null ? null : applicableFloor(entry, parsed)) ?? lowest;
  // Overlapping advisories chain, and a floor can sit inside a denied range: raise the candidate
  // past every fixed range that contains it until none does.
  let candidate = parsed !== null && compareStableVersions(parsed, minimum) >= 0 ? parsed : minimum;
  for (let raised = true; raised; ) {
    raised = false;
    for (const [introduced, fixed] of entry.denied) {
      const from = parseStableVersion(introduced);
      const to = fixed === null ? null : parseStableVersion(fixed);
      if (
        from !== null &&
        to !== null &&
        compareStableVersions(candidate, from) >= 0 &&
        compareStableVersions(candidate, to) < 0
      ) {
        candidate = to;
        minimum = to;
        raised = true;
      }
    }
  }
  return minimum.join(".");
}

/**
 * Next.js 16 and later build with Webpack explicitly; Next.js 15 builds with Webpack by default.
 * @param {unknown} version
 * @returns {readonly string[]}
 */
export function nextBuildArguments(version) {
  const parsed = parseStableVersion(version);
  if (parsed === null) throw new TypeError("Next.js version is invalid");
  return parsed[0] >= 16 ? Object.freeze(["--webpack"]) : Object.freeze([]);
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
