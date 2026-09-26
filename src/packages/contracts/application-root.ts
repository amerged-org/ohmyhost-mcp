declare const applicationRootBrand: unique symbol;
export type ApplicationRoot = string & {
  readonly [applicationRootBrand]: "ApplicationRoot";
};

export const APPLICATION_ROOT_PATTERN =
  /^(?:\.|[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*)$/u;
export const APPLICATION_ROOT_MAX_BYTES = 64;
export const APPLICATION_ROOT_MAX_SEGMENTS = 8;
export const APPLICATION_ROOT_MAX_SEGMENT_BYTES = 63;

export const APPLICATION_ROOT_CONFORMANCE_CORPUS = Object.freeze({
  accepted: Object.freeze([
    Object.freeze({ name: "repository root", value: "." }),
    Object.freeze({ name: "single segment", value: "site" }),
    Object.freeze({ name: "portable segment punctuation", value: "apps/web.v2_test-prod" }),
    Object.freeze({ name: "maximum segment bytes", value: "a".repeat(63) }),
    Object.freeze({
      name: "maximum total bytes",
      value: `${"a".repeat(31)}/${"b".repeat(32)}`,
    }),
    Object.freeze({ name: "maximum segment count", value: "a/b/c/d/e/f/g/h" }),
  ]),
  rejected: Object.freeze([
    Object.freeze({ name: "empty string", value: "" }),
    Object.freeze({ name: "absolute path", value: "/site" }),
    Object.freeze({ name: "parent traversal", value: "../site" }),
    Object.freeze({ name: "embedded traversal", value: "apps/../site" }),
    Object.freeze({ name: "leading dot segment", value: "./site" }),
    Object.freeze({ name: "trailing separator", value: "site/" }),
    Object.freeze({ name: "repeated separator", value: "apps//site" }),
    Object.freeze({ name: "backslash", value: "apps\\site" }),
    Object.freeze({ name: "colon syntax", value: "C:site" }),
    Object.freeze({ name: "leading whitespace", value: " site" }),
    Object.freeze({ name: "trailing whitespace", value: "site " }),
    Object.freeze({ name: "control character", value: "site\nweb" }),
    Object.freeze({ name: "unicode", value: "café" }),
    Object.freeze({ name: "percent ambiguity", value: "site%2fweb" }),
    Object.freeze({ name: "hidden segment", value: ".site" }),
    Object.freeze({ name: "nine segments", value: "a/b/c/d/e/f/g/h/i" }),
    Object.freeze({ name: "segment over 63 bytes", value: "a".repeat(64) }),
    Object.freeze({
      name: "path over 64 bytes",
      value: `${"a".repeat(32)}/${"b".repeat(32)}`,
    }),
    Object.freeze({ name: "non-string", value: 1 }),
  ]),
  ustarEnvelope: Object.freeze([
    Object.freeze({
      name: "maximum accepted application root",
      repositoryNameBytes: 100,
      separatorBytes: 3,
      commitShaBytes: 40,
      applicationRootBytes: 64,
      inspectionLeafBytes: 24,
      archivePathBytes: 231,
      ustarPathEnvelopeBytes: 255,
      fitsWithoutPax: true,
    }),
  ]),
});

export function normalizeApplicationRoot(value: unknown = "."): ApplicationRoot {
  if (typeof value !== "string" || !APPLICATION_ROOT_PATTERN.test(value)) {
    throw new TypeError("Application root is invalid");
  }
  const encoder = new TextEncoder();
  const encoded = encoder.encode(value);
  const segments = value === "." ? [] : value.split("/");
  if (
    encoded.byteLength > APPLICATION_ROOT_MAX_BYTES ||
    segments.length > APPLICATION_ROOT_MAX_SEGMENTS ||
    segments.some(
      (segment) => encoder.encode(segment).byteLength > APPLICATION_ROOT_MAX_SEGMENT_BYTES,
    )
  ) {
    throw new TypeError("Application root is invalid");
  }
  return value as ApplicationRoot;
}
