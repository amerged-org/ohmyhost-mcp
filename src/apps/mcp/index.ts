import mcpPackage from "../package.json" with { type: "json" };
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { listOhmyhostSkillResources } from "@ohmyhost/agent-skills";

export function createOhmyhostMcpServer(name = "ohmyhost", instructions?: string) {
  const server = new McpServer(
    { name, version: mcpPackage.version },
    instructions === undefined ? undefined : { instructions },
  );
  for (const resource of listOhmyhostSkillResources()) {
    server.registerResource(
      `${resource.skillName}:${resource.relativePath}`,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async (uri) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: resource.mimeType,
            text: resource.text,
          },
        ],
      }),
    );
  }
  return server;
}

export const ohmyhostMcpHandler = createMcpHandler(() => createOhmyhostMcpServer());
