// The URL the Mini App frame is loaded from.
//
// The server answers with the address its proxy listener answers at. For a
// listener bound beyond loopback that address is a wildcard (`0.0.0.0`), and
// a browser cannot fetch it — the loopback address it would fall back to is
// the *reader's* own machine, so a page opened on a LAN address would frame
// nothing at all. The wildcard therefore becomes the host the page itself was
// reached at, and the proxy's port stays.
//
// The Mini App keeps an origin of its own either way: the proxy listens on
// its own port, so the framed document is not same-origin with the WebUI and
// cannot read the client credential off its parent frame (ADR 0020).

import { pageHostname } from "./page-host.js";

export function miniappFrameUrl(viewUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(viewUrl);
  } catch {
    return viewUrl;
  }
  if (!isWildcardHost(parsed.hostname)) return viewUrl;
  const hostname = pageHostname();
  if (!hostname) return viewUrl;
  parsed.hostname = hostname;
  return parsed.toString();
}

function isWildcardHost(hostname: string): boolean {
  return hostname === "0.0.0.0" || hostname === "::" || hostname === "";
}
