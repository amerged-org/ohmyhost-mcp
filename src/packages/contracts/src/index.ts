import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import { parse as parseYaml } from "yaml";

import schema from "../schemas/ohmyhost.schema.json" with { type: "json" };
import { normalizeApplicationRoot, type ApplicationRoot } from "./application-root.js";
import { normalizeCrons } from "./functions.js";
import { normalizeBrowserPolicy, type BrowserPolicy } from "./browser-capabilities.js";

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

export type OhmyhostRuntimeMode = "static" | "edge" | "functions" | "auto";

/** Build settings of an application; the functions runtime installs dependencies only. */
export type OhmyhostApplicationBuild = Readonly<{
  install: string;
  command: string;
  output: string;
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
    provider: "none" | "better-auth";
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
  readonly functions?: Readonly<{ crons: readonly string[] }>;
  readonly credits?: Readonly<{
    monthly_budget: number;
    auto_recharge?: Readonly<{
      enabled: boolean;
      threshold?: number;
      amount_usd_micros?: number;
      monthly_cap_usd_micros?: number;
    }>;
  }>;
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
    ...(input.functions === undefined
      ? {}
      : {
          functions: Object.freeze({ crons: normalizeCrons(input.functions.crons) }),
        }),
    ...(input.credits === undefined
      ? {}
      : {
          credits: Object.freeze({
            monthly_budget: input.credits.monthly_budget,
            ...(input.credits.auto_recharge === undefined
              ? {}
              : {
                  auto_recharge: Object.freeze({
                    enabled: input.credits.auto_recharge.enabled,
                    ...(input.credits.auto_recharge.threshold === undefined
                      ? {}
                      : { threshold: input.credits.auto_recharge.threshold }),
                    ...(input.credits.auto_recharge.amount_usd_micros === undefined
                      ? {}
                      : { amount_usd_micros: input.credits.auto_recharge.amount_usd_micros }),
                    ...(input.credits.auto_recharge.monthly_cap_usd_micros === undefined
                      ? {}
                      : {
                          monthly_cap_usd_micros:
                            input.credits.auto_recharge.monthly_cap_usd_micros,
                        }),
                  }),
                }),
          }),
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

function normalizeEgressOrigins(value: readonly string[] | undefined): readonly string[] {
  const origins = [...(value ?? [])];
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new TypeError("ohmyhost.yaml runtime egress origin is invalid");
    }
    if (
      parsed.protocol !== "https:" ||
      parsed.port !== "" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.origin !== origin ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      forbiddenEgressHostname(parsed.hostname)
    ) {
      throw new TypeError("ohmyhost.yaml runtime egress origin is invalid");
    }
  }
  origins.sort();
  return Object.freeze(origins);
}

// Egress is routed and staged by DNS name on the default HTTPS port: an IP literal (public or
// private, v4 or v6) can never become a working origin, and a local name never resolves.
function forbiddenEgressHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(normalized) ||
    normalized.startsWith("[") ||
    normalized.endsWith("]")
  );
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
