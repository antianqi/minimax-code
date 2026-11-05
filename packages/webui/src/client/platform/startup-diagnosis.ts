// What a failed startup says about the service.
//
// The page's only channel is its WebSocket, so a refusal leaves the browser
// with one sentence that fits every cause: "WebSocket is closed before the
// connection is established". That sentence names neither the credential nor
// the origin, and a service that is gone, a service that restarted (the
// per-start credential in the URL is then stale) and a service that answered
// the handshake with a refusal all produce it.
//
// One HTTP request separates the three: the page asks the same address for
// the document, with the token it holds and without the cookie, and the
// answer says which of them it is.

/**
 * What the service answered when the page asked it directly.
 *
 *   * `credential_rejected` — the service is there and refused the credential
 *     this page holds. The usual cause is a service that restarted: the
 *     credential is per start, so the address the person kept has the token of
 *     an earlier run.
 *   * `service_reachable` — the service answered, and the refusal is not
 *     about the credential. A handshake refused for its origin looks like
 *     this too.
 *   * `service_unreachable` — nothing answered: the address, the port or the
 *     network is wrong.
 */
export type WebuiStartupDiagnosis =
  | "credential_rejected"
  | "service_reachable"
  | "service_unreachable";

export interface WebuiStartupDiagnosisInput {
  /** The socket address the page was given, which names the service. */
  readonly websocketUrl: string;
  /** The per-start credential this page holds. */
  readonly token: string;
}

/**
 * The HTTP address of the service the socket address names.
 *
 * `ws:`/`wss:` and `http:`/`https:` share their first two letters, so
 * one substitution reaches the other scheme.
 */
export function httpBaseFromWebsocketUrl(websocketUrl: string): string {
  return websocketUrl.replace(/\/$/u, "").replace(/^ws/iu, "http");
}

/**
 * Ask the service what it thinks of this page's credential.
 *
 * The request carries the token in its query and no cookie: the cookie would
 * answer a different question — whether the browser holds a credential at all
 * — and this question is whether the one in the address still works.
 */
export async function diagnoseWebuiStartup(
  input: WebuiStartupDiagnosisInput,
): Promise<WebuiStartupDiagnosis> {
  if (typeof fetch !== "function") return "service_unreachable";
  const url = `${httpBaseFromWebsocketUrl(input.websocketUrl)}/?token=${encodeURIComponent(input.token)}`;
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
    });
    return response.status === 401 ? "credential_rejected" : "service_reachable";
  } catch {
    return "service_unreachable";
  }
}
