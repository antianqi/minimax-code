// The WebSocket admission.
//
// Two things about a refusal decide whether the person can act on it. The
// status has to name the cause (401 says the credential, 403 says the host or
// the origin), and the response has to reach the browser at all: a socket
// that is destroyed right after the write can lose the status line, and the
// browser then reports "WebSocket is closed before the connection is
// established" for every cause alike.

import { describe, expect, it } from "vitest";

import { admitWebSocketUpgrade } from "../../src/server/access-policy.js";
import { credentialFromCookie, credentialPresented } from "../../src/server/credentials.js";

interface RecordedSocket {
  readonly written: string;
  readonly ended: boolean;
  readonly destroyed: boolean;
}

/**
 * A socket that records what the refusal did to it.
 *
 * The real one is a TCP socket; what matters here is which of the three ways
 * of closing it the refusal chose.
 */
function recordingSocket(): RecordedSocket & { readonly socket: unknown } {
  const record = { written: "", ended: false, destroyed: false, socket: undefined as unknown };
  record.socket = {
    write(chunk: string) {
      record.written += chunk;
      return true;
    },
    end(chunk?: string) {
      if (chunk !== undefined) record.written += chunk;
      record.ended = true;
      return record.socket;
    },
    destroy() {
      record.destroyed = true;
      return record.socket;
    },
  };
  return record;
}

function requestWith(headers: Record<string, string>): unknown {
  return { headers };
}

const context = {
  host: "0.0.0.0",
  tcpPort: () => 2233,
  credential: { token: "current-token" },
  dev: false,
};

describe("the WebSocket admission", () => {
  it("full access skips credentials while retaining Host and Origin checks", () => {
    const openContext = { ...context, fullAccess: true };
    const record = recordingSocket();
    expect(admitWebSocketUpgrade(
      requestWith({ host: "192.168.31.19:2233", origin: "http://192.168.31.19:2233" }) as never,
      new URL("ws://192.168.31.19:2233/"), record.socket as never, openContext,
    )).toEqual({ admitted: true });
    expect(admitWebSocketUpgrade(
      requestWith({ host: "192.168.31.19:2233", origin: "http://other.example" }) as never,
      new URL("ws://192.168.31.19:2233/"), recordingSocket().socket as never, openContext,
    )).toMatchObject({ admitted: false, status: 403, reason: "Forbidden Origin" });
    expect(admitWebSocketUpgrade(
      requestWith({ host: "other.example:2233" }) as never,
      new URL("ws://other.example:2233/"), recordingSocket().socket as never,
      { ...openContext, host: "127.0.0.1" },
    )).toMatchObject({ admitted: false, status: 403, reason: "Forbidden Host" });
  });

  it("admits a request from the page's own origin that presents the credential", () => {
    const record = recordingSocket();
    const outcome = admitWebSocketUpgrade(
      requestWith({ host: "192.168.31.19:2233", origin: "http://192.168.31.19:2233" }) as never,
      new URL("ws://192.168.31.19:2233/?token=current-token"),
      record.socket as never,
      context,
    );
    expect(outcome.admitted).toBe(true);
    expect(record.written).toBe("");
    expect(record.ended).toBe(false);
  });

  it("refuses a foreign origin with a status line the browser can read", () => {
    const record = recordingSocket();
    const outcome = admitWebSocketUpgrade(
      requestWith({ host: "192.168.31.19:2233", origin: "http://192.168.31.19:50473" }) as never,
      new URL("ws://192.168.31.19:2233/?token=current-token"),
      record.socket as never,
      context,
    );
    expect(outcome.admitted).toBe(false);
    expect(outcome.status).toBe(403);
    expect(record.written).toContain("403 Forbidden Origin");
    // Ended, not destroyed: a destroyed socket can drop the response before
    // it reaches the browser, and the browser then names no cause at all.
    expect(record.ended).toBe(true);
    expect(record.destroyed).toBe(false);
  });

  it("refuses a stale credential with 401", () => {
    const record = recordingSocket();
    const outcome = admitWebSocketUpgrade(
      requestWith({ host: "192.168.31.19:2233", origin: "http://192.168.31.19:2233" }) as never,
      new URL("ws://192.168.31.19:2233/?token=token-of-an-earlier-run"),
      record.socket as never,
      context,
    );
    expect(outcome.admitted).toBe(false);
    expect(outcome.status).toBe(401);
    expect(record.written).toContain("401 Unauthorized");
    expect(record.ended).toBe(true);
  });

  it("accepts the credential the cookie carries", () => {
    const record = recordingSocket();
    const outcome = admitWebSocketUpgrade(
      requestWith({
        host: "192.168.31.19:2233",
        origin: "http://192.168.31.19:2233",
        cookie: "webui_credential=current-token",
      }) as never,
      new URL("ws://192.168.31.19:2233/"),
      record.socket as never,
      context,
    );
    expect(outcome.admitted).toBe(true);
  });
});

/**
 * A cookie is the part of a request an untrusted client writes.
 *
 * `decodeURIComponent` throws `URIError` on a malformed escape, and both
 * admission paths run this parse — one inside the synchronous upgrade listener,
 * one inside an unawaited dispatch — so an escaping parser turns a wrong
 * request into an exception raised from code that owns no `try`. The parser
 * answers with a verdict instead: absent, invalid, or the token it found.
 */
describe("the credential a cookie carries", () => {
  it("answers invalid rather than throwing on a malformed percent escape", () => {
    expect(credentialFromCookie("webui_credential=%")).toEqual({
      kind: "invalid",
      reason: "the credential cookie is not valid percent-encoded text",
    });
    // A truncated multi-byte escape is the same failure from a different byte:
    // `decodeURIComponent` refuses both, so both become the one verdict.
    expect(credentialFromCookie("webui_credential=%E0%A4%A").kind).toBe("invalid");
  });

  it("tells no cookie from an undecodable one", () => {
    expect(credentialFromCookie(undefined)).toEqual({ kind: "absent" });
    expect(credentialFromCookie("other=1; another=2")).toEqual({ kind: "absent" });
    expect(credentialFromCookie("webui_credential=")).toEqual({
      kind: "presented",
      token: "",
    });
  });

  it("decodes the value the page was sent", () => {
    const token = "0b6f2e1c-8a4d-4f6b-9c0e-2d7a1b3c4d5e";
    expect(credentialFromCookie(`webui_credential=${encodeURIComponent(token)}`)).toEqual({
      kind: "presented",
      token,
    });
  });

  it("reads every occurrence, and takes the first one that decodes", () => {
    // Two paths can both hold the cookie, and a browser sends both. A
    // decodable value is a fact about the credential, not noise beside a
    // broken one.
    expect(
      credentialFromCookie("webui_credential=%; webui_credential=current-token"),
    ).toEqual({ kind: "presented", token: "current-token" });
    expect(
      credentialFromCookie("webui_credential=first; webui_credential=second"),
    ).toEqual({ kind: "presented", token: "first" });
    expect(credentialFromCookie("webui_credential=%; webui_credential=%")).toEqual({
      kind: "invalid",
      reason: "the credential cookie is not valid percent-encoded text",
    });
  });

  it("refuses a malformed cookie at the WebSocket admission instead of raising", () => {
    const record = recordingSocket();
    const outcome = admitWebSocketUpgrade(
      requestWith({
        host: "192.168.31.19:2233",
        origin: "http://192.168.31.19:2233",
        cookie: "webui_credential=%",
      }) as never,
      new URL("ws://192.168.31.19:2233/"),
      record.socket as never,
      context,
    );
    expect(outcome).toMatchObject({ admitted: false, status: 401, reason: "Unauthorized" });
    expect(record.written).toContain("401 Unauthorized");
  });

  it("lets a valid query token short-circuit a malformed cookie", () => {
    // The query is the credential's first channel, so a page that presents it
    // there is admitted whatever a stale cookie beside it looks like.
    const outcome = admitWebSocketUpgrade(
      requestWith({
        host: "192.168.31.19:2233",
        origin: "http://192.168.31.19:2233",
        cookie: "webui_credential=%",
      }) as never,
      new URL("ws://192.168.31.19:2233/?token=current-token"),
      recordingSocket().socket as never,
      context,
    );
    expect(outcome.admitted).toBe(true);
    expect(
      credentialPresented({ token: "current-token" }, "current-token", "webui_credential=%"),
    ).toBe(true);
    expect(credentialPresented({ token: "current-token" }, null, "webui_credential=%")).toBe(false);
  });
});
