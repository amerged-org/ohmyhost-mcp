/**
 * What every dynamic-dispatch call that runs customer code carries. The public gateway, the
 * functions scheduler and the deploy health probe all read this module, so no path runs customer
 * code under looser limits than the live request path, and the egress context has one shape for
 * the one outbound policy Worker that parses it.
 */
export const WFP_DISPATCH_LIMITS = Object.freeze({
  cpuMs: 50,
  subRequests: 10,
});
export const WFP_EGRESS_CONTEXT_VERSION = 1 as const;

/** The trusted `EGRESS_CONTEXT` parameter the dispatcher hands the outbound policy Worker. */
export type WfpEgressContext = Readonly<{
  version: typeof WFP_EGRESS_CONTEXT_VERSION;
  projectId: string;
  allowedOrigins: readonly string[];
}>;

/**
 * The context of one project: its ULID and the sorted allowed HTTPS origins, nothing else. The
 * outbound Worker fails closed on anything it cannot parse, so every dispatcher builds it here.
 */
export function buildEgressContext(
  projectId: string,
  allowedOrigins: readonly string[],
): WfpEgressContext {
  return Object.freeze({
    version: WFP_EGRESS_CONTEXT_VERSION,
    projectId,
    allowedOrigins: Object.freeze([...allowedOrigins]),
  });
}

export const RUNTIME_LIMIT_DIAGNOSTIC_CODES = [
  "CPU_LIMIT_EXCEEDED",
  "RUNTIME_RESOURCE_LIMIT_EXCEEDED",
] as const;
// Application paths can contain tokens or PII. Retain only known literal routes.
export const RUNTIME_LIMIT_DIAGNOSTIC_ROUTES = [
  "/",
  "/api/auth/change-password",
  "/api/auth/reset-password",
  "/api/auth/sign-in/email",
  "/api/auth/sign-up/email",
] as const;

export function isRuntimeLimitDiagnosticRoute(
  route: unknown,
): route is (typeof RUNTIME_LIMIT_DIAGNOSTIC_ROUTES)[number] {
  return RUNTIME_LIMIT_DIAGNOSTIC_ROUTES.some((literal) => literal === route);
}

export function dispatchRuntimeLimit(error: unknown) {
  // Dynamic dispatch can relay application exceptions. These messages only support the
  // generic fallback. CPU attribution requires a provider outcome such as exceededCpu.
  if (
    !(error instanceof Error) ||
    !/^(?:Worker exceeded resource limits|Worker exceeded (?:the )?CPU time limit|CPU time limit exceeded)\.?$/u.test(
      error.message,
    )
  )
    return null;
  return {
    code: "RUNTIME_RESOURCE_LIMIT_EXCEEDED",
    status: 503,
    message: "Runtime resource limit exceeded: the Worker may have run out of CPU time or memory.",
  } as const;
}
