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

/** The error a Worker raises when an invocation exceeds the CPU limit above. */
export function isCpuLimitError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("CPU time limit");
}

/** What a visitor and the deploy health verdict are told when that limit stops an invocation. */
export function cpuLimitMessage(): string {
  return `Runtime limit exceeded: this request used more than ${WFP_DISPATCH_LIMITS.cpuMs} ms of CPU time. This is not a rate limit; reduce the work per request.`;
}
