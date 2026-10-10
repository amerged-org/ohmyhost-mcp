export {
  compareStableVersions,
  FRAMEWORK_VERSION_POLICY,
  frameworkVersionMinimum,
  frameworkVersionVerdict,
  isAdmittedFrameworkBuildScript,
  nextBuildArguments,
  parseStableVersion,
  PINNED_BUN_VERSION,
} from "./framework-build-script.mjs";
export type {
  FrameworkVersionPackage,
  FrameworkVersionPolicy,
  FrameworkVersionPolicyEntry,
} from "./framework-build-script.mjs";
