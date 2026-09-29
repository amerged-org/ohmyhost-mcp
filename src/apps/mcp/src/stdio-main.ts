#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { listSavedProfiles, resolveProductCliEnvironment } from "@ohmyhost/product-cli";

import { createAuthenticatedLocalMcpClient } from "./local-client.js";
import { createLocalOhmyhostMcpServer } from "./local-server.js";

const environment = {
  ...(process.env["OHMYHOST_ENVIRONMENT"] === undefined
    ? {}
    : { OHMYHOST_ENVIRONMENT: process.env["OHMYHOST_ENVIRONMENT"] }),
  ...(process.env["OHMYHOST_TOKEN"] === undefined
    ? {}
    : { OHMYHOST_TOKEN: process.env["OHMYHOST_TOKEN"] }),
  ...(process.env["OHMYHOST_PROFILE"] === undefined
    ? {}
    : { OHMYHOST_PROFILE: process.env["OHMYHOST_PROFILE"] }),
};
resolveProductCliEnvironment(environment);

serveStdio(
  () =>
    createLocalOhmyhostMcpServer({
      environment,
      // Every tool call chooses its own saved login; nothing this process remembers can retarget it.
      authenticatedClient: (signal, request) =>
        createAuthenticatedLocalMcpClient(signal, {
          environment,
          ...(request === undefined ? {} : { request }),
        }),
      listProfiles: (signal) => listSavedProfiles(signal, { environment }),
    }),
  { onerror: (error) => process.stderr.write(`${error.message}\n`) },
);
