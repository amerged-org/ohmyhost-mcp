import {
  appendFile,
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

/**
 * Which project this working copy deploys to for one organization. The same checkout may be linked
 * once per organization, so a second account never overwrites or inherits the first one's link.
 */
export interface ProjectLinkMetadata {
  readonly version: 2;
  readonly api_origin: string;
  readonly organization_id: string;
  readonly project_id: string;
  readonly installation_id: string;
  readonly repository_full_name: string;
}

/** A link written before links named their organization; it is verified before any use. */
export interface LegacyProjectLink {
  readonly project_id: string;
  readonly installation_id: string;
  readonly repository_full_name: string;
}

export interface DirectoryLinks {
  readonly links: readonly ProjectLinkMetadata[];
  readonly legacy: LegacyProjectLink | null;
}

export interface ProjectLinkStore {
  save(metadata: ProjectLinkMetadata): Promise<void>;
}

const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const LINKS = "links";
const LEGACY_LINK = "link.json";

/** Every usable link of this directory for this API; unreadable files are not links. */
export async function readProjectLinks(
  directory: string,
  apiOrigin: string,
): Promise<DirectoryLinks> {
  let names: string[] = [];
  try {
    names = await readdir(join(directory, LINKS));
  } catch {
    names = [];
  }
  const links: ProjectLinkMetadata[] = [];
  for (const name of names.sort()) {
    const organizationId = /^([0-7][0-9A-HJKMNP-TV-Z]{25})\.json$/u.exec(name)?.[1];
    if (organizationId === undefined) continue;
    const link = await readJson(join(directory, LINKS, name));
    if (
      isRecord(link, [
        "version",
        "api_origin",
        "organization_id",
        "project_id",
        "installation_id",
        "repository_full_name",
      ]) &&
      link["version"] === 2 &&
      link["api_origin"] === apiOrigin &&
      link["organization_id"] === organizationId &&
      typeof link["project_id"] === "string" &&
      ULID.test(link["project_id"]) &&
      typeof link["installation_id"] === "string" &&
      typeof link["repository_full_name"] === "string"
    )
      links.push(link as unknown as ProjectLinkMetadata);
  }
  const legacy = await readJson(join(directory, LEGACY_LINK));
  return {
    links,
    legacy:
      typeof legacy === "object" &&
      legacy !== null &&
      legacy["version"] === 1 &&
      legacy["api_origin"] === apiOrigin &&
      typeof legacy["project_id"] === "string" &&
      ULID.test(legacy["project_id"]) &&
      typeof legacy["installation_id"] === "string" &&
      typeof legacy["repository_full_name"] === "string"
        ? {
            project_id: legacy["project_id"],
            installation_id: legacy["installation_id"],
            repository_full_name: legacy["repository_full_name"],
          }
        : null,
  };
}

export type LinkedProject =
  | {
      readonly outcome: "linked";
      readonly projectId: string;
      /** Null for a legacy link, whose organization is still to be verified. */
      readonly organizationId: string | null;
    }
  | { readonly outcome: "none" }
  | { readonly outcome: "ambiguous"; readonly organizationIds: readonly string[] };

/**
 * The project a command in this directory means when it names none. With a known organization only
 * that organization's link counts; otherwise exactly one link must exist.
 */
export function chooseLinkedProject(
  directory: DirectoryLinks,
  organizationId: string | undefined,
): LinkedProject {
  if (organizationId !== undefined) {
    const link = directory.links.find((candidate) => candidate.organization_id === organizationId);
    if (link !== undefined)
      return { outcome: "linked", projectId: link.project_id, organizationId };
    return directory.legacy === null
      ? { outcome: "none" }
      : { outcome: "linked", projectId: directory.legacy.project_id, organizationId: null };
  }
  const candidates = [
    ...directory.links.map((link) => ({
      projectId: link.project_id,
      organizationId: link.organization_id as string | null,
    })),
    ...(directory.legacy === null
      ? []
      : [{ projectId: directory.legacy.project_id, organizationId: null }]),
  ];
  const [only] = candidates;
  if (candidates.length === 1 && only !== undefined) return { outcome: "linked", ...only };
  if (candidates.length === 0) return { outcome: "none" };
  return {
    outcome: "ambiguous",
    organizationIds: directory.links.map((link) => link.organization_id),
  };
}

/** The organization a directory link records for this project, if one does. */
export function linkedOrganization(
  directory: DirectoryLinks,
  projectId: string,
): string | undefined {
  const organizations = new Set(
    directory.links
      .filter((link) => link.project_id === projectId)
      .map((link) => link.organization_id),
  );
  const [organizationId] = organizations;
  return organizations.size === 1 ? organizationId : undefined;
}

/** Drops the pre-organization link once its replacement is written; it is never guessed at. */
export async function removeLegacyProjectLink(directory: string): Promise<void> {
  await unlink(join(directory, LEGACY_LINK));
}

export class OwnerOnlyProjectLinkStore implements ProjectLinkStore {
  /** repositoryRoot: when it is a Git working tree, the link directory is kept out of Git. */
  public constructor(
    private readonly directory: string,
    private readonly repositoryRoot?: string,
  ) {}

  public async save(metadata: ProjectLinkMetadata): Promise<void> {
    if (!ULID.test(metadata.organization_id)) throw new TypeError("Invalid linked organization");
    const links = join(this.directory, LINKS);
    for (const directory of [this.directory, links]) {
      await mkdir(directory, { mode: 0o700, recursive: true });
      await chmod(directory, 0o700);
    }
    const target = join(links, `${metadata.organization_id}.json`);
    const temporary = join(links, `.link-${process.pid}.tmp`);
    await writeFile(temporary, `${JSON.stringify(metadata)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
    await chmod(target, 0o600);
    if (this.repositoryRoot !== undefined) await ignoreLinkDirectory(this.repositoryRoot);
  }
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const isRecord = (value: unknown, keys: readonly string[]): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");

async function ignoreLinkDirectory(root: string): Promise<void> {
  try {
    await stat(join(root, ".git"));
  } catch {
    return;
  }
  const file = join(root, ".gitignore");
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch {
    current = "";
  }
  const lines = current.split(/\r?\n/u).map((line) => line.trim());
  if (lines.some((line) => /^\/?\.ohmyhost\/?$/u.test(line))) return;
  await appendFile(file, `${current === "" || current.endsWith("\n") ? "" : "\n"}/.ohmyhost/\n`);
}
