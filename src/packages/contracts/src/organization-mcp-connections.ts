/**
 * The connection_id of one workspace MCP consent. The public contract names it as a UUID; the
 * clients accept any hex UUID in the 8-4-4-4-12 form, so a server id that RFC 4122 would refuse is
 * still reachable from the CLI and the MCP tools.
 */
export const MCP_CONNECTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
