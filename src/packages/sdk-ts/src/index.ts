export {
  createClient,
  createConfig,
  type Client as OhMyHostClient,
  type Config as OhMyHostClientConfig,
} from "./generated/client/index.js";
export * from "./generated/index.js";
export * from "./managed-mail.js";
export * from "./managed-mail-attachment.js";

export * from "./shared-mail.js";
