// The HTTP side of the transport's own endpoint.
//
// The addresses the client hands to the browser outside the socket protocol —
// the two session-transfer routes, the workspace-file download, the
// browser-extension archive and a mini-app's standalone page — are served by
// the same listener the socket is opened against. Each is that endpoint
// spelled over HTTP, and each used to spell the projection itself: the session
// transfer only rewrote `ws:`, so a `wss:` endpoint answered with a `wss:`
// origin that `fetch` cannot use, while the three download builders rewrote the
// shared prefix and answered `https:` for the same input.
//
// One rule, one home. `ws:` and `wss:` share the `ws` prefix, so a single
// substitution reaches `http:` and `https:` respectively, and it leaves host,
// port and any base path alone: the routes are served beside the socket.

/**
 * The transport's endpoint as an HTTP URL, keeping its path.
 *
 * `https:` follows from `wss:` because the substitution replaces only the
 * shared prefix and leaves the trailing `s` in place.
 */
export function websocketSchemeToHttp(websocketUrl: string): string {
  return websocketUrl.replace(/^ws/iu, "http");
}

/**
 * The transport's endpoint as an HTTP base with no trailing separator, which is
 * what a caller appends a route to.
 */
export function httpBaseFromWebsocketUrl(websocketUrl: string): string {
  return websocketSchemeToHttp(websocketUrl.replace(/\/$/u, ""));
}

/**
 * The origin the HTTP routes are served on.
 *
 * Parsed first, so an endpoint this client cannot read is refused rather than
 * rewritten into something plausible: a caller with no origin has nothing to
 * send a request to. `new URL(...).origin` also drops the socket's own path,
 * which is the part the routes are not served under.
 */
export function httpOriginFromWebsocketUrl(websocketUrl: string): string | undefined {
  try {
    return new URL(websocketSchemeToHttp(websocketUrl)).origin;
  } catch {
    return undefined;
  }
}
