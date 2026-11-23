import {
  frameworkConversionDetail,
  hasConfigurationFields,
  parseFrameworkConversionDiagnostic,
  type FrameworkConversionDiagnostic,
} from "./framework-admission.js";
import { renderConfigurationExample } from "./framework-source-rules.js";
import { previewFailureSay } from "./previews.js";
import { PROBLEM_POLICY, type ProblemChatGuidance, type ProblemCode } from "./problem-policy.js";

type ChatGuidance = { next_step: string; say_to_user?: string };
type ChatResult = Readonly<Record<string, unknown>>;

export interface ChatArgumentIssue {
  readonly argument: string;
  readonly reason: string;
}

type ChatToolSchema<Result, JsonSchema> = {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly jsonSchema: JsonSchema;
    readonly types?: { readonly input: unknown; readonly output: Result };
    validate(value: unknown): { value: Result };
  };
};

/** Keep the advertised schema and let the tool render its validation result as a chat problem. */
export function chatToolInput<Result, JsonSchema>(schema: {
  readonly "~standard": { readonly jsonSchema: JsonSchema };
  safeParse(value: unknown): Result;
}): ChatToolSchema<Result, JsonSchema> {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "ohmyhost",
      jsonSchema: schema["~standard"].jsonSchema,
      validate: (value: unknown) => ({ value: schema.safeParse(value) }),
    },
  };
}

/** Zod issue metadata from tool-owned schemas. Never include received values or unknown keys. */
type ToolInputIssue = {
  readonly path: readonly PropertyKey[];
  readonly code: string;
  readonly message: string;
  readonly expected?: string;
  readonly format?: string;
  readonly pattern?: string;
  readonly minimum?: number | bigint;
  readonly maximum?: number | bigint;
  readonly values?: readonly unknown[];
};

export function chatArgumentIssues(issues: readonly ToolInputIssue[]): ChatArgumentIssue[] {
  return issues.slice(0, 20).map((issue) => ({
    argument: typeof issue.path[0] === "string" ? issue.path[0] : "arguments",
    reason: argumentIssueReason(issue),
  }));
}

const REST_FIELD_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_]*(?:\.(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+))*(?![\s\S])/u;

export function parseInvalidRequestFields(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) return null;
  const fields: string[] = [];
  for (const field of value) {
    if (
      typeof field !== "string" ||
      field.length > 128 ||
      !REST_FIELD_PATTERN.test(field) ||
      fields.includes(field)
    )
      return null;
    fields.push(field);
  }
  return Object.freeze(fields);
}

export function chatRestArgumentIssues(value: unknown): readonly ChatArgumentIssue[] | undefined {
  return parseInvalidRequestFields(value)?.map((argument) => ({
    argument,
    reason: "Check this argument against the tool schema.",
  }));
}

function argumentIssueReason(issue: ToolInputIssue): string {
  switch (issue.code) {
    case "invalid_type":
      return `Expected a ${issue.expected ?? "supported value"}.`;
    case "invalid_value":
      return issue.values?.length && issue.values.length <= 10
        ? `Expected ${issue.values.map((value) => JSON.stringify(value)).join(" or ")}.`
        : "Use a value allowed by the tool.";
    case "invalid_format":
      return issue.format === "regex"
        ? issue.pattern === undefined
          ? "Use the required format."
          : `Expected text matching ${issue.pattern}.`
        : `Expected ${issue.format ?? "the required format"}.`;
    case "too_small":
      return `The minimum is ${String(issue.minimum)}.`;
    case "too_big":
      return `The maximum is ${String(issue.maximum)}.`;
    case "unrecognized_keys":
      return "Remove fields outside the tool schema.";
    case "custom":
      return issue.message === "Invalid input"
        ? "Check this argument against the tool schema."
        : issue.message;
    default:
      return "Check the allowed types and values in the tool schema.";
  }
}

export function renderChatProblem(
  code: string,
  facts: {
    readonly status?: number;
    readonly suggestedAction?: string;
    readonly retryable?: boolean;
    readonly requestId?: unknown;
    readonly retryAfterSeconds?: unknown;
    readonly issues?: readonly ChatArgumentIssue[];
    readonly frameworkDiagnostic?: FrameworkConversionDiagnostic | null;
  } = {},
) {
  const policy = Object.hasOwn(PROBLEM_POLICY, code)
    ? PROBLEM_POLICY[code as ProblemCode]
    : undefined;
  const localAction = policy === undefined ? facts.suggestedAction : undefined;
  const guidance: ProblemChatGuidance =
    policy ??
    (localAction === undefined
      ? {
          side: "ours",
          next_step:
            "If the outcome is unclear, use operation_get or read the affected resource before repeating a write. Use feedback_submit if the problem persists.",
        }
      : { side: "yours", next_step: localAction });
  const parsed = parseFrameworkConversionDiagnostic(facts.frameworkDiagnostic);
  const diagnostic =
    parsed?.code === "source_syntax_error"
      ? code === "source_syntax_error"
        ? parsed
        : null
      : code === "framework_conversion_required"
        ? parsed
        : null;
  const configuration = hasConfigurationFields(diagnostic) ? diagnostic : null;
  const message =
    configuration === null
      ? frameworkConversionDetail(diagnostic)
      : "ohmyhost.yaml is invalid. Correct the reported fields.";
  const { requestId, retryAfterSeconds } = facts;
  const hasRetryDelay =
    typeof retryAfterSeconds === "number" &&
    Number.isSafeInteger(retryAfterSeconds) &&
    retryAfterSeconds >= 1 &&
    retryAfterSeconds <= 86400;
  return {
    code,
    ...(localAction === undefined ? { status: facts.status ?? policy?.status ?? 503 } : {}),
    retryable: facts.retryable ?? policy?.retryable ?? false,
    ...(typeof requestId === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(requestId)
      ? { request_id: requestId }
      : {}),
    ...(hasRetryDelay ? { retry_after_seconds: retryAfterSeconds } : {}),
    side: guidance.side,
    next_step:
      diagnostic?.code === "companion_entry_required"
        ? "Add a Worker module with export default { fetch } at the named file with source_changes, then call deployment_plan again. Only paths under /api/ reach the module."
        : configuration !== null
          ? "Read ohmyhost.yaml with source_files and correct the reported fields using valid_example when present. Preserve valid project settings. Save with source_changes and call deployment_plan again."
          : code === "service_unavailable" && hasRetryDelay
            ? "Nothing was changed. Read again after retry_after_seconds."
            : guidance.next_step,
    ...(guidance.not_helpful === undefined ? {} : { not_helpful: guidance.not_helpful }),
    ...(guidance.say_to_user === undefined ? {} : { say_to_user: guidance.say_to_user }),
    ...(code === "invalid_request" && facts.issues?.length ? { issues: facts.issues } : {}),
    ...(message === null ? {} : { message }),
    ...(configuration === null
      ? {}
      : {
          fields: configuration.fields,
          ...(configuration.example === null
            ? {}
            : { valid_example: renderConfigurationExample(configuration.example) }),
        }),
    ...(diagnostic?.code === "source_syntax_error"
      ? { path: diagnostic.path, line: diagnostic.line, column: diagnostic.column }
      : {}),
  };
}

export const CHAT_ACCESS_INSTRUCTIONS =
  "Continue an existing app in its reachable workspace with its saved project binding. Reuse a matching local CLI/MCP profile or private token source unless the user chooses remote. Verify identity and workspace. Remote availability alone never selects remote. On a remote identity or workspace mismatch, stop the access-link loop. Treat unreachable local context as an access gap, not deleted credentials. Never substitute a Review/demo account or change the saved source. ";

export const CHAT_MAIN_PATH_INSTRUCTIONS =
  "Main path: project_create, then source_changes to save a version, then preview_open to show the app. Use preview_open to show an existing app too. Later saves update the same preview without a deployment. " +
  "Preview, Dev site and live site are different: the preview is a private live preview for every plan; the Dev site (Paid only) and the live site are deployments. " +
  "When ready_to_show is true, give the user the preview link and ask whether they would like to see it. Publish with deployment_plan and deployment_create when the user asks to publish, deploy or go live. " +
  "A preview link works for at most 24 hours; if a result carries failure, follow its next_step instead of waiting. " +
  "Results may carry next_step for you and say_to_user for the user. Say it in the user's language. Share IDs, commits, states and codes only on request. ";

export const PREVIEW_OPEN_DESCRIPTION =
  "Open or create the private live preview for this project and environment and return its link, state, expires_at, failure and ready_to_show. Available on Free and Paid. Source saves update it without a deployment. The link is for the user: hand it over when ready_to_show is true. Private means: keep it out of source files, notes and logs. The link is valid for at most 24 hours from creation; the preview sleeps after 10 minutes without activity and wakes when the link is opened, and preview_open makes a new preview and link after the 24 hours. If the start failed, failure carries a code and next_step: follow it instead of waiting.";
export const PREVIEW_GET_DESCRIPTION =
  "Read the private live preview for this project and environment: its link, state, saved and applied version, expires_at, failure and ready_to_show. The link is for the user: hand it over when ready_to_show is true. Private means: keep it out of source files, notes and logs. The link is valid for at most 24 hours from creation. If the start failed, failure carries a code and next_step: follow it instead of waiting.";

export function previewGuidance(view: ChatResult): ChatGuidance | null {
  if (view["source"] === null)
    return {
      next_step:
        "Nothing is saved in this project yet, so the preview has nothing to show. Save the app with source_changes first; the preview follows the saved version.",
    };
  const url = view["url"];
  if (typeof url !== "string" || !Object.hasOwn(view, "source")) return null;
  if (view["ready_to_show"] === true)
    return {
      next_step:
        "The preview shows the saved version. Give the user this link exactly as returned and ask whether they want to see it.",
      say_to_user: `Your app is ready as a private preview: ${url} Do you want to see it?`,
    };
  const failure = view["failure"];
  if (
    typeof failure === "object" &&
    failure !== null &&
    typeof (failure as Record<string, unknown>)["code"] === "string" &&
    typeof (failure as Record<string, unknown>)["next_step"] === "string"
  ) {
    const { code, next_step } = failure as { code: string; next_step: string };
    return {
      next_step,
      say_to_user: previewFailureSay(code) ?? "Your preview could not start. I am looking into it.",
    };
  }
  if (view["status"] === "sleeping")
    return {
      next_step:
        "The preview is paused and starts again when the link is opened. Give the user the link exactly as returned.",
      say_to_user: `Your preview is paused. It starts again when you open the link: ${url}`,
    };
  return {
    next_step:
      "The preview is still starting or applying the saved version, which usually takes under a minute. Read preview_get again in about 10 seconds, for at most 2 minutes, before giving the user the link exactly as returned.",
    say_to_user: "Your preview is starting. This takes up to a minute.",
  };
}

export function sourceSaveGuidance(result: ChatResult): ChatGuidance | null {
  if (result["state"] === "succeeded")
    return {
      next_step:
        "The version is saved. Open the preview with preview_open for this project (environment dev if the workspace is Paid and the project has Dev, prod otherwise) and give the user the link when ready_to_show is true.",
    };
  if (result["state"] === "queued" || result["state"] === "running")
    return {
      next_step:
        "The save is being finished. Read operation_get until it succeeds, then open the preview with preview_open for this project (environment dev if the workspace is Paid and the project has Dev, prod otherwise).",
    };
  return null;
}

export function projectCreateGuidance(
  result: ChatResult,
  starterRequested = true,
): ChatGuidance | null {
  if (result["state"] !== "queued" || typeof result["project_id"] !== "string") return null;
  return {
    next_step: starterRequested
      ? "The project exists and its starter files are being prepared, usually in under a minute. Read source_get until the source is ready, then save the app with source_changes using its current commit and generation. Do not initialize the source again."
      : "The project exists. Read operation_get until it succeeds, then read the source binding with source_get. If there is no source, use source_initialize for managed source or source_link for the chosen GitHub repository.",
    say_to_user: "Your project is set up. I am building the first version now.",
  };
}

export function deploymentGuidance(result: ChatResult): ChatGuidance | null {
  return result["status"] === "active"
    ? {
        next_step:
          "The deployment is online, which does not prove the app works. Open its address and try the app's main action before telling the user it works.",
      }
    : null;
}

export const OPERATION_RECONCILE_DESCRIPTION =
  "Recovers an operation after operation_get reports reconciliation_required. Use the original write’s idempotency key and confirm one attempt. The receipt identifies the original operation for a follow-up operation_get. If recovery is exhausted, stop and keep the original resource.";

export const OPERATION_GET_DESCRIPTION =
  "Read the original operation’s state, work kind, current step, age, usual duration, wait reason and next step. A deployment failure includes the deployment ID for deployment_logs. For waiting_for_mail, read mail_domain_status or GET /v1/projects/{project_id}/environments/{environment_id}/mail-domain.";

export const SOURCE_PREPARATION_GUIDANCE = {
  usual_duration_seconds: 60,
  next_step:
    "Source preparation usually takes under a minute. Read source_get again until the source is ready. Do not initialize the source again.",
} as const;

const usualOperationSeconds = {
  project_create: 60,
  development_environment_add: 60,
  project_handle_change: 120,
  deployment: 600,
  deployment_promotion: 180,
  deployment_rollback: 180,
  source_link: 60,
  source_initialize: 60,
  source_save: 60,
  project_delete: 300,
  project_data_change: 300,
  database_compute_change: 300,
  database_write: 60,
  project_recovery: 600,
  other: 300,
} as const;

export type OperationWorkKind = keyof typeof usualOperationSeconds;
export interface OperationWork {
  readonly kind: OperationWorkKind;
  readonly step: string;
  readonly age_seconds: number;
  readonly usual_duration_seconds: number;
  readonly wait_reason?: string;
  readonly next_step?: string;
}

export function operationWorkGuidance(input: {
  kind: OperationWorkKind;
  state: string;
  step?: string;
  stepAt: string;
  now: Date;
  blocking?: boolean;
  reconciliation?: { state: "required" | "pending"; can_reconcile?: boolean };
  deploymentNextStep?: string;
}): OperationWork {
  const { kind, state, reconciliation } = input;
  const step = input.step ?? state;
  const active = state === "queued" || state === "running";
  const age_seconds = Math.max(
    0,
    Math.floor((input.now.getTime() - Date.parse(input.stepAt)) / 1000),
  );
  const usual_duration_seconds = usualOperationSeconds[kind];
  const work = { kind, step, age_seconds, usual_duration_seconds };
  if (!active) return work;
  if (reconciliation)
    return {
      ...work,
      wait_reason: reconciliation.state === "pending" ? "reconciling" : "reconciliation_required",
      next_step:
        reconciliation.state === "pending"
          ? "Read operation_get for this operation after 60 seconds."
          : reconciliation.can_reconcile === false
            ? PROBLEM_POLICY.reconciliation_exhausted.next_step
            : PROBLEM_POLICY.reconciliation_required.next_step,
    };
  if (input.blocking)
    return {
      ...work,
      wait_reason: "another_operation",
      next_step:
        "Read operation_get for blocking_operation_id. Wait for it to finish before reading this operation again.",
    };
  if (step === "waiting_for_mail" || step === "mail_status_unavailable")
    return {
      ...work,
      wait_reason: step,
      next_step:
        "Read mail_domain_status for the current sender readiness and DNS records, then read operation_get again.",
    };
  if (age_seconds > usual_duration_seconds)
    return {
      ...work,
      wait_reason: "taking_longer_than_usual",
      next_step:
        age_seconds >= 3 * usual_duration_seconds
          ? "Keep waiting. Read operation_get again in 60 seconds. If the step stays unchanged, report it with feedback_submit."
          : "Keep waiting. Read operation_get again in 60 seconds.",
    };
  return {
    ...work,
    wait_reason: step,
    next_step:
      input.deploymentNextStep ?? "Read operation_get again shortly using the same operation ID.",
  };
}

export function parseOperationWork(value: unknown): OperationWork {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new TypeError("Invalid operation work");
  const r = value as Record<string, unknown>;
  const { kind, step, age_seconds, usual_duration_seconds, wait_reason, next_step } = r;
  const token = (field: unknown) => typeof field === "string" && /^[a-z][a-z_]{0,63}$/u.test(field);
  const hasWait = wait_reason !== undefined || next_step !== undefined;
  if (
    Object.keys(r).sort().join(",") !==
      (hasWait
        ? "age_seconds,kind,next_step,step,usual_duration_seconds,wait_reason"
        : "age_seconds,kind,step,usual_duration_seconds") ||
    typeof kind !== "string" ||
    !Object.hasOwn(usualOperationSeconds, kind) ||
    !token(step) ||
    typeof age_seconds !== "number" ||
    !Number.isSafeInteger(age_seconds) ||
    age_seconds < 0 ||
    typeof usual_duration_seconds !== "number" ||
    !Number.isSafeInteger(usual_duration_seconds) ||
    usual_duration_seconds < 1 ||
    (hasWait &&
      (!token(wait_reason) ||
        typeof next_step !== "string" ||
        next_step.length < 1 ||
        next_step.length > 500))
  )
    throw new TypeError("Invalid operation work");
  return value as OperationWork;
}

export function withChatGuidance(
  tool: string,
  value: unknown,
  options: { starterRequested?: boolean; local?: boolean } = {},
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  let result = value as ChatResult;
  let guidance: ChatGuidance | null;
  switch (tool) {
    case "preview_get":
    case "preview_open":
      guidance = previewGuidance(result);
      break;
    case "source_changes":
    case "source_upload_commit":
      guidance = sourceSaveGuidance(result);
      break;
    case "project_create":
      guidance = projectCreateGuidance(result, options.starterRequested);
      break;
    case "deployment_get":
      guidance = deploymentGuidance(result);
      break;
    case "identity_get":
      guidance =
        Array.isArray(result["organization_ids"]) && result["organization_ids"].length === 0
          ? {
              next_step: options.local
                ? "Use organization_create if the user needs a workspace. If they already had one, ask them to reconnect their ohmyho.st login."
                : "Use workspace_setup if the user needs a workspace. If they already had one, ask them to reconnect ohmyho.st in the connector settings.",
              say_to_user: "Your account has no workspace yet. Shall I set one up?",
            }
          : null;
      break;
    case "operation_get": {
      const progress = result["progress"];
      if (typeof progress === "object" && progress !== null && "suggested_action" in progress) {
        const chatProgress = Object.fromEntries(
          Object.entries(progress).filter(([key]) => key !== "suggested_action"),
        );
        result = { ...result, progress: chatProgress };
      }
      const work = result["work"];
      if (
        typeof work !== "object" ||
        work === null ||
        !("next_step" in work) ||
        typeof work.next_step !== "string"
      )
        return result;
      guidance = { next_step: work.next_step };
      if (
        result["reconciliation"] &&
        typeof result["reconciliation"] === "object" &&
        "state" in result["reconciliation"] &&
        result["reconciliation"].state === "required" &&
        "can_reconcile" in result["reconciliation"] &&
        result["reconciliation"].can_reconcile === false
      )
        guidance.say_to_user = PROBLEM_POLICY.reconciliation_exhausted.say_to_user;
      break;
    }
    case "source_get":
      return result["status"] === "pending" ? { ...SOURCE_PREPARATION_GUIDANCE, ...result } : value;
    default:
      return value;
  }
  return guidance === null ? value : { ...guidance, ...result };
}
