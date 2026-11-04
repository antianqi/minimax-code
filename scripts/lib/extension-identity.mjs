// The identity of an extension, and where a host learns it.
//
// A Chrome/Edge extension's id is not an opaque string the store hands out.
// It is derived from the public key the build carries in `manifest.key`, and
// the derivation was measured rather than assumed: a build carrying a freshly
// generated RSA public key was loaded into a real Chromium, and the id the
// browser assigned was
//
//     hex(sha256(der)[0..16]), with every hex digit mapped 0-f -> a-p
//
// which is exactly what `extensionIdFromPublicKey` computes. (The id an
// **unpacked** build gets is a different thing entirely — it is derived from
// the directory the build was loaded from, so it differs per machine and per
// path, and no public key can predict it.)
//
// This module exists because of what that measurement means: **the identity
// of a published extension is a build-time constant**. A host that is built
// for one published extension can know its id without asking anybody, so the
// id never has to be an operator's runtime configuration. It was, until now,
// and that is what made the published WebUI package unusable for the person
// it was published for.

import { createHash } from "node:crypto";

/** The public key each store build carries, by surface. */
export const STORE_PUBLIC_KEY_ENV_BY_SURFACE = {
  edge: "MAVIS_BROWSER_STORE_EDGE_PUBLIC_KEY",
  chrome: "MAVIS_BROWSER_STORE_CHROME_PUBLIC_KEY",
};

/** The allowlist variable the **packaged** host reads, by surface. */
export const STORE_EXTENSION_ID_ENV_BY_SURFACE = {
  edge: "MAVIS_BROWSER_STORE_EDGE_EXTENSION_IDS",
  chrome: "MAVIS_BROWSER_STORE_CHROME_EXTENSION_IDS",
};

/** The allowlist variable the **development** host reads, by surface. */
export const DEVELOPMENT_EXTENSION_ID_ENV_BY_SURFACE = {
  edge: "MAVIS_BROWSER_EDGE_EXTENSION_IDS",
  chrome: "MAVIS_BROWSER_CHROME_EXTENSION_IDS",
};

/**
 * The id a build carrying this public key is given.
 *
 * The key is the base64 form of the DER SPKI public key — the same string the
 * build writes into `manifest.key`.
 *
 * The mapping is the browser's own: the hash's first 16 bytes are rendered as
 * hex, and every hex digit is moved onto the letter that sits 97 places above
 * it, which is how `0` becomes `a` and `f` becomes `p`. The result is
 * the 32-letter id the browser shows in `chrome://extensions`.
 *
 * A key that is not a public key at all produces an id that no browser would
 * ever assign, so the value is checked for the shape a browser would produce
 * and a malformed key is refused rather than turned into a plausible-looking
 * id.
 */
export function extensionIdFromPublicKey(publicKeyBase64) {
  if (typeof publicKeyBase64 !== "string" || publicKeyBase64.trim().length === 0) {
    throw new Error("the store's public key is missing");
  }
  const der = Buffer.from(publicKeyBase64.trim(), "base64");
  if (der.length === 0) {
    throw new Error("the store's public key is not valid base64");
  }
  const id = createHash("sha256")
    .update(der)
    .digest()
    .subarray(0, 16)
    .toString("hex")
    .replace(/[0-9a-f]/gu, (digit) => String.fromCharCode(97 + parseInt(digit, 16)));
  if (!/^[a-p]{32}$/u.test(id)) {
    throw new Error("the store's public key does not produce a usable extension id");
  }
  return id;
}

/**
 * The id list one allowlist variable holds.
 *
 * Comma-separated, whitespace ignored, lowercased. A missing or empty value
 * is an empty list, which admits nobody — the same fail-closed reading the
 * host uses.
 */
export function parseExtensionIdList(raw) {
  if (typeof raw !== "string") return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * The published extension ids, computed from the store public keys.
 *
 * A surface whose public key is not in the environment has no published
 * identity, and is reported as absent rather than as an empty id: the caller
 * has to be able to tell "this package was built for a published Chrome
 * extension" from "this package was built for nothing", because the first
 * admits one extension with no configuration and the second admits none.
 */
export function readStoreExtensionIds(env = process.env) {
  const ids = {};
  for (const [surface, variable] of Object.entries(STORE_PUBLIC_KEY_ENV_BY_SURFACE)) {
    const key = env[variable];
    if (typeof key !== "string" || key.trim().length === 0) continue;
    ids[surface] = extensionIdFromPublicKey(key);
  }
  return ids;
}
