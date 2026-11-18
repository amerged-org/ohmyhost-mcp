import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";

import schema from "../schemas/ohmyhost.schema.json" with { type: "json" };
import { normalizeApplicationRoot, type ApplicationRoot } from "./application-root.js";
import { normalizeCrons } from "./functions.js";
import { normalizeBrowserPolicy, type BrowserPolicy } from "./browser-capabilities.js";
import { isCustomerEgressOrigin } from "./egress-origin.js";

export * from "./application-root.js";
export * from "./framework-admission.js";
export * from "./operation-deployment-result.js";
export * from "./operation-data-change-result.js";
export * from "./operation-failure.js";
export * from "./functions.js";
export * from "./browser-capabilities.js";
export * from "./problem-policy.js";
export * from "./secret-names.js";
export * from "./project-data-changes.js";
export * from "./preview-view.js";
export type * from "./previews.js";

export type OhmyhostRuntimeMode = "static" | "edge" | "functions" | "auto";

/** Build settings of an application; the functions runtime installs dependencies only. */
export type OhmyhostApplicationBuild = Readonly<{
  install: string;
  command: string;
  output: string;
  /** Maximum private immutable Next.js prerender cache, in MiB; defaults to 32. */
  ssg_cache_max_mib?: number;
  /** Opt into the writable, deployment-scoped Next.js revalidatePath cache. */
  next_revalidate_path?: boolean;
}>;
export type OhmyhostFunctionsBuild = Readonly<{ install: string }>;

export interface OhmyhostConfig {
  readonly version: 1;
  readonly project: string;
  readonly applicationRoot: ApplicationRoot;
  readonly build: OhmyhostApplicationBuild | OhmyhostFunctionsBuild;
  readonly runtime: Readonly<{
    mode: OhmyhostRuntimeMode;
    healthcheck: string;
    egress: Readonly<{ allow: readonly string[] }>;
    browser?: BrowserPolicy;
  }>;
  readonly database?: Readonly<{
    enabled: boolean;
    migrations?: string;
  }>;
  readonly auth?: Readonly<{
    provider: "none" | "better-auth" | "omh-native";
  }>;
  readonly mail?: Readonly<{
    enabled: boolean;
  }>;
  readonly storage?: Readonly<{
    provider: "r2";
    /** Must equal the project's hosting region (`us` by default, `eu` when the project was created there). */
    jurisdiction: "us" | "eu";
    public: false;
  }>;
  /** `jurisdiction` is required when `enabled` is true; it has no default. */
  readonly ai?: Readonly<{
    enabled: boolean;
    jurisdiction?: "eu" | "any";
  }>;
  readonly browser?: Readonly<{ enabled: boolean }>;
  readonly functions?: Readonly<{ crons: readonly string[] }>;
}

const validateOhmyhostConfig = new Ajv2020({
  allErrors: true,
  strict: true,
}).compile<OhmyhostConfig>(schema);

export function parseOhmyhostConfig(value: unknown): OhmyhostConfig {
  if (!validateOhmyhostConfig(value)) {
    throw new TypeError(`ohmyhost.yaml is invalid: ${formatErrors(validateOhmyhostConfig.errors)}`);
  }

  const input = value as OhmyhostConfig;
  const config: OhmyhostConfig = {
    version: 1,
    project: input.project,
    applicationRoot: normalizeApplicationRoot(input.applicationRoot),
    build:
      input.runtime.mode === "functions"
        ? Object.freeze({ install: input.build.install })
        : Object.freeze({
            install: input.build.install,
            command: (input.build as OhmyhostApplicationBuild).command,
            output: (input.build as OhmyhostApplicationBuild).output,
            ...((input.build as OhmyhostApplicationBuild).ssg_cache_max_mib === undefined
              ? {}
              : { ssg_cache_max_mib: (input.build as OhmyhostApplicationBuild).ssg_cache_max_mib }),
            ...((input.build as OhmyhostApplicationBuild).next_revalidate_path === true
              ? { next_revalidate_path: true }
              : {}),
          }),
    runtime: Object.freeze({
      mode: input.runtime.mode,
      healthcheck: normalizeHealthcheck(input.runtime.healthcheck),
      egress: Object.freeze({
        allow: normalizeEgressOrigins(input.runtime.egress?.allow),
      }),
      ...(input.runtime.browser === undefined
        ? {}
        : { browser: normalizeBrowserPolicy(input.runtime.browser) }),
    }),
    ...(input.database === undefined
      ? {}
      : {
          database: Object.freeze({
            enabled: input.database.enabled,
            ...(input.database.migrations === undefined
              ? {}
              : { migrations: input.database.migrations }),
          }),
        }),
    ...(input.auth === undefined ? {} : { auth: Object.freeze({ provider: input.auth.provider }) }),
    ...(input.mail === undefined ? {} : { mail: Object.freeze({ enabled: input.mail.enabled }) }),
    ...(input.storage === undefined
      ? {}
      : {
          storage: Object.freeze({
            provider: input.storage.provider,
            jurisdiction: input.storage.jurisdiction,
            public: input.storage.public,
          }),
        }),
    ...(input.ai === undefined
      ? {}
      : {
          ai: Object.freeze({
            enabled: input.ai.enabled,
            ...(input.ai.jurisdiction === undefined ? {} : { jurisdiction: input.ai.jurisdiction }),
          }),
        }),
    ...(input.browser === undefined
      ? {}
      : { browser: Object.freeze({ enabled: input.browser.enabled }) }),
    ...(input.functions === undefined
      ? {}
      : {
          functions: Object.freeze({ crons: normalizeCrons(input.functions.crons) }),
        }),
  };

  return Object.freeze(config);
}

function normalizeHealthcheck(value: string | undefined): string {
  const candidate = value ?? "/";
  if (
    candidate !== candidate.trim() ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("?") ||
    candidate.includes("#") ||
    candidate.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new TypeError("ohmyhost.yaml runtime healthcheck is invalid");
  }
  return candidate;
}

// Egress is routed and staged by DNS name on the default HTTPS port, so every origin must pass the one shared rule.
function normalizeEgressOrigins(value: readonly string[] | undefined): readonly string[] {
  const origins = [...(value ?? [])];
  for (const origin of origins) {
    if (!isCustomerEgressOrigin(origin)) {
      throw new TypeError("ohmyhost.yaml runtime egress origin is invalid");
    }
  }
  origins.sort();
  return Object.freeze(origins);
}

/** The application build of a static or edge configuration. */
export function requireApplicationBuild(config: OhmyhostConfig): OhmyhostApplicationBuild {
  if (config.runtime.mode === "functions" || !("command" in config.build)) {
    throw new TypeError(
      "ohmyhost.yaml build.command and build.output require an application runtime",
    );
  }
  return config.build;
}

export function parseOhmyhostConfigYaml(source: string): OhmyhostConfig {
  if (typeof source !== "string") {
    throw new TypeError("ohmyhost.yaml must be a string");
  }

  let value: unknown;
  try {
    value = parseYaml(source) as unknown;
  } catch {
    throw new TypeError("ohmyhost.yaml is not valid YAML");
  }

  return parseOhmyhostConfig(value);
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(({ instancePath, message }) => `${instancePath || "/"} ${message ?? "is invalid"}`)
    .join("; ");
}
