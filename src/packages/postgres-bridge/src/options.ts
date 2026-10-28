// SPDX-License-Identifier: Apache-2.0
const isDatabaseId = (value: string) => /^[a-z][a-z0-9]{19}$/u.test(value);
const isRoleName = (value: string) => /^[a-z][a-z0-9_]{0,62}$/u.test(value);

export interface ConnectOptions {
  endpoint: string;
  database: string;
  user: string;
  port: number;
}

export function validateOptions(value: ConnectOptions): ConnectOptions {
  let endpoint: URL;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    throw new Error("invalid_endpoint");
  }
  if (
    endpoint.protocol !== "wss:" ||
    !endpoint.hostname ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/" ||
    value.endpoint.length > 2048 ||
    /[\s\\?#@]/.test(value.endpoint)
  )
    throw new Error("invalid_endpoint");
  if (!isDatabaseId(value.database)) throw new Error("invalid_database");
  if (!isRoleName(value.user)) throw new Error("invalid_user");
  if (!Number.isInteger(value.port) || value.port < 0 || value.port > 65535)
    throw new Error("invalid_port");
  return {
    endpoint: endpoint.href,
    database: value.database,
    user: value.user,
    port: value.port,
  };
}

export function upstreamUrl(options: ConnectOptions): string {
  const url = new URL(options.endpoint);
  url.pathname = "/v2";
  url.searchParams.set("database", options.database);
  url.searchParams.set("user", options.user);
  return url.href;
}
