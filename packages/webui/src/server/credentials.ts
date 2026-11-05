// Per-start credential generation and validation.
//
// Each service instance generates a fresh token when it starts; a browser
// must present that exact token in the WebSocket URL or the connection is
// refused. The token is opaque to the rest of the service: the goal is to
// stop a neighbouring browser on the same loopback interface from riding
// the connection.
//
// We use Node's `randomUUID` so the token inherits the platform CSPRNG;
// comparing uses a constant-time equality to keep the validation timing
// even whether the guess is right or wrong.

import { randomUUID, timingSafeEqual } from "node:crypto";

export interface WebuiCredential {
  readonly token: string;
}

/**
 * The cookie that carries the per-start credential.
 *
 * The query parameter is the credential's first channel, and it cannot reach
 * the page's own relative requests: a browser that opened
 * `/?token=…` asks for `./client.js` and `./styles.css` without the
 * query, so a page served on a non-loopback interface would load with no
 * script and no styles. The cookie is what those requests carry.
 */
export const WEBUI_CREDENTIAL_COOKIE = "webui_credential";

export function createWebuiCredential(): WebuiCredential {
  return { token: randomUUID() };
}

/**
 * The `Set-Cookie` value that carries the credential.
 *
 * `SameSite=Strict` keeps the cookie away from a request another site
 * made, so the credential is not a cross-site one; `HttpOnly` keeps it out
 * of the page's own script.
 */
export function credentialCookie(token: string): string {
  return `${WEBUI_CREDENTIAL_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Strict; HttpOnly`;
}

/**
 * The credential a request presented in its cookies, if any.
 */
export function credentialFromCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name !== WEBUI_CREDENTIAL_COOKIE) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

/**
 * Whether a request presented the credential, in the query or in the cookie.
 */
export function credentialPresented(
  credential: WebuiCredential,
  queryToken: unknown,
  cookieHeader: string | undefined,
): boolean {
  if (credentialMatches(credential, queryToken)) return true;
  return credentialMatches(credential, credentialFromCookie(cookieHeader));
}

/**
 * Constant-time comparison of two opaque tokens. Returns false when either
 * side is not a string or when their lengths differ. The service refuses
 * the connection in either branch.
 */
export function credentialMatches(
  expected: WebuiCredential,
  presented: unknown,
): boolean {
  if (typeof presented !== "string") return false;
  const expectedBytes = Buffer.from(expected.token, "utf8");
  const presentedBytes = Buffer.from(presented, "utf8");
  if (expectedBytes.length !== presentedBytes.length) return false;
  return timingSafeEqual(expectedBytes, presentedBytes);
}