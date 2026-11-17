/** Public preview response, validated before a CLI or agent presents its private URL. */
export interface PreviewView {
  readonly id: string;
  readonly project_id: string;
  readonly environment: "dev" | "prod";
  readonly status: "cold" | "starting" | "ready" | "sleeping";
  readonly url: string;
  readonly source: Readonly<{ sequence: number; commit_sha: string }> | null;
}

export function parsePreviewView(
  value: unknown,
  scope?: { projectId: string; environment: "dev" | "prod" },
): PreviewView {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid preview response");
  const row = value as Record<string, unknown>;
  const ulid = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
  if (
    Object.keys(row).sort().join(",") !== "environment,id,project_id,source,status,url" ||
    typeof row["id"] !== "string" ||
    !ulid.test(row["id"]) ||
    typeof row["project_id"] !== "string" ||
    !ulid.test(row["project_id"]) ||
    (row["environment"] !== "dev" && row["environment"] !== "prod") ||
    !["cold", "starting", "ready", "sleeping"].includes(String(row["status"])) ||
    typeof row["url"] !== "string" ||
    !/^https:\/\/[a-z2-7]{51}[aq]\.preview(?:\.dev)?\.omh\.st$/u.test(row["url"]) ||
    (scope !== undefined &&
      (row["project_id"] !== scope.projectId || row["environment"] !== scope.environment))
  )
    throw new TypeError("Invalid preview response");
  if (row["source"] !== null) {
    const source = row["source"];
    if (!source || typeof source !== "object" || Array.isArray(source))
      throw new TypeError("Invalid preview response");
    const item = source as Record<string, unknown>;
    if (
      Object.keys(item).sort().join(",") !== "commit_sha,sequence" ||
      typeof item["sequence"] !== "number" ||
      !Number.isSafeInteger(item["sequence"]) ||
      item["sequence"] <= 0 ||
      typeof item["commit_sha"] !== "string" ||
      !/^(?!0{40}$)[0-9a-f]{40}$/u.test(item["commit_sha"])
    )
      throw new TypeError("Invalid preview response");
  }
  return value as PreviewView;
}
