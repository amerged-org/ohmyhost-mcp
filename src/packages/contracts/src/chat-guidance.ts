type ChatGuidance = { next_step: string; say_to_user?: string };
type ChatResult = Readonly<Record<string, unknown>>;

export const CHAT_MAIN_PATH_INSTRUCTIONS =
  "ohmyho.st hosts the user's app: create a project, save versions of its source, show a private live preview, publish. Main path: project_create, then source_changes to save a version, then preview_open, which returns the project's private preview link; later saves update the preview without a deployment. To show the app, also when continuing an existing project, use preview_open; the Dev site address needs a share link and is not the preview. When ready_to_show is true, give the user that link and ask whether they would like to see it. Publish with deployment_plan and deployment_create when the user asks or agrees; a request that already says deploy, publish or go live is that agreement. Results may carry next_step, written for you, and say_to_user, a plain sentence for the user, to be said in the user's language; the user needs IDs, commits, states and codes only on request. ";

export const PREVIEW_OPEN_DESCRIPTION =
  "Open or create the stable private preview of this exact environment and return its link, state and ready_to_show. Source saves update it without a deployment. The link is for the user: hand it over when ready_to_show is true. Private means: keep it out of source files, notes and logs. It has no expiry until rotated.";
export const PREVIEW_GET_DESCRIPTION =
  "Read the stable private preview of this exact environment: its link, state, saved and applied version, and ready_to_show. The link is for the user: hand it over when ready_to_show is true. Private means: keep it out of source files, notes and logs.";

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
        "The preview shows the saved version. Give the user this link and ask whether they want to see it. Publish only when the user asks or agrees.",
      say_to_user: `Your app is ready as a private preview: ${url} Do you want to see it?`,
    };
  if (view["status"] === "sleeping")
    return {
      next_step:
        "The preview is paused and starts again when the link is opened. Give the user the link.",
      say_to_user: `Your preview is paused. It starts again when you open the link: ${url}`,
    };
  return {
    next_step:
      "The preview is still starting or applying the saved version, which usually takes under a minute. Read preview_get again in about 10 seconds, for at most 2 minutes, before giving the user the link.",
    say_to_user: "Your preview is starting. This takes up to a minute.",
  };
}

export function sourceSaveGuidance(result: ChatResult): ChatGuidance | null {
  if (result["state"] === "succeeded")
    return {
      next_step:
        "The version is saved. Open the preview with preview_open for this project (environment dev on a Paid workspace, prod otherwise) and give the user the link when ready_to_show is true.",
    };
  if (result["state"] === "queued" || result["state"] === "running")
    return {
      next_step:
        "The save is being finished. Read operation_get until it succeeds, then open the preview with preview_open for this project (environment dev on a Paid workspace, prod otherwise).",
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

export function withChatGuidance(
  tool: string,
  value: unknown,
  options: { starterRequested?: boolean } = {},
): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const result = value as ChatResult;
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
    default:
      return value;
  }
  return guidance === null ? value : { ...guidance, ...result };
}
