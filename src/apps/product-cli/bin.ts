#!/usr/bin/env node

import { runProductionCli } from "./composition.js";

const controller = new AbortController();
process.once("SIGINT", () => controller.abort(new DOMException("Cancelled", "AbortError")));
process.once("SIGTERM", () => controller.abort(new DOMException("Cancelled", "AbortError")));

process.exitCode = await runProductionCli(
  process.argv.slice(2),
  {
    ...(process.env["OHMYHOST_ENVIRONMENT"] === undefined
      ? {}
      : { OHMYHOST_ENVIRONMENT: process.env["OHMYHOST_ENVIRONMENT"] }),
    ...(process.env["OHMYHOST_TOKEN"] === undefined
      ? {}
      : { OHMYHOST_TOKEN: process.env["OHMYHOST_TOKEN"] }),
  },
  {
    writeStdout: (value) => process.stdout.write(value),
    writeStderr: (value) => process.stderr.write(value),
  },
  controller.signal,
);
