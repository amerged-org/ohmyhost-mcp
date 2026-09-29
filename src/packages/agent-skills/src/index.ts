import { GENERATED_SKILL_RESOURCES } from "./generated-skill-resources.js";

export const OHMYHOST_SKILL_INSTALL_SOURCE = "amerged-org/docs";

export interface OhmyhostSkillResource {
  readonly skillName: string;
  readonly relativePath: string;
  readonly uri: string;
  readonly title: string;
  readonly description: string;
  readonly mimeType: "text/markdown" | "text/plain";
  readonly text: string;
}

const resources = Object.freeze(
  GENERATED_SKILL_RESOURCES.map((resource) => Object.freeze(resource)),
) satisfies readonly OhmyhostSkillResource[];
const resourcesByUri: ReadonlyMap<string, OhmyhostSkillResource> = new Map(
  resources.map((resource) => [resource.uri, resource]),
);

export function listOhmyhostSkillResources(): readonly OhmyhostSkillResource[] {
  return resources;
}

export function readOhmyhostSkillResource(uri: string): OhmyhostSkillResource {
  const resource = resourcesByUri.get(uri);
  if (!resource) throw new TypeError("Unknown ohmyhost skill resource");
  return resource;
}

export function ohmyhostSkillInstallCommand(skillName: string): string {
  if (!resources.some((resource) => resource.skillName === skillName)) {
    throw new TypeError("Unknown ohmyhost skill");
  }
  return `npx skills add ${OHMYHOST_SKILL_INSTALL_SOURCE} -s ${skillName}`;
}
