// The startup diagnosis.
//
// A page whose WebSocket was refused cannot say why: the browser reports
// "WebSocket is closed before the connection is established" for a service
// that is gone, for a service that restarted (the per-start credential in the
// address is then stale) and for a handshake the service answered with a
// refusal. These cases pin the one request that tells the three apart.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  diagnoseWebuiStartup,
  httpBaseFromWebsocketUrl,
} from "../../src/client/platform/startup-diagnosis.js";

describe("the startup diagnosis", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the service's HTTP address off the socket address", () => {
    expect(httpBaseFromWebsocketUrl("ws://192.168.31.19:2233")).toBe(
      "http://192.168.31.19:2233",
    );
    expect(httpBaseFromWebsocketUrl("wss://example.test/")).toBe("https://example.test");
  });

  it("names a service that refuses the credential this page holds", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => ({ status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      diagnoseWebuiStartup({
        websocketUrl: "ws://192.168.31.19:2233",
        token: "stale-token",
      }),
    ).resolves.toBe("credential_rejected");
    // The question is whether the token in the address still works, so the
    // cookie must not answer it.
    const request = fetch.mock.calls[0]?.[1];
    expect(request?.credentials).toBe("omit");
  });

  it("calls a service that answered anything else reachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200 })));
    await expect(
      diagnoseWebuiStartup({
        websocketUrl: "ws://192.168.31.19:2233",
        token: "token",
      }),
    ).resolves.toBe("service_reachable");
  });

  it("calls a service that did not answer unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network error");
      }),
    );
    await expect(
      diagnoseWebuiStartup({
        websocketUrl: "ws://192.168.31.19:2233",
        token: "token",
      }),
    ).resolves.toBe("service_unreachable");
  });
});
