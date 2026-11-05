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
