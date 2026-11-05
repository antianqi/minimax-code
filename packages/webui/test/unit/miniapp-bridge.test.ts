// The Mini App page bridge's host half, and the composer append behind it.
//
// The property the ticket names is negative and easy to lose: declining leaves the
// existing draft untouched. So each refusal case asserts that `writeDraft` was
// never called, not merely that the returned code was a refusal — a handler that
// wrote first and asked afterwards would pass a code-only assertion.
//
// The sender check is the other half. Any window can post to this one, so the
// tests pin that only the framed document on the framed origin is answered, and
// that a view URL which cannot be parsed answers nothing at all.

import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";

import {
  webuiMiniAppBridgeAppend,
  webuiMiniAppBridgeRequest,
  webuiMiniAppBridgeSenderAllowed,
  webuiMiniAppDraftWithAppend,
} from "../../src/client/features/miniapp/application/miniapp-bridge.js";
import {
  WEBUI_MINIAPP_BRIDGE_APPEND_REQUEST,
  WEBUI_MINIAPP_COMPOSER_MAX_TEXT_LENGTH,
} from "../../src/shared/contracts/miniapp.js";
import { miniAppPageBridge } from "../../src/server/miniapp/bridge.js";
import { miniAppRouteShim } from "../../src/server/miniapp/route-shim.js";
import { miniappFrameUrl } from "../../src/client/platform/miniapp-frame-url.js";

const VIEW_URL = "http://127.0.0.1:49152";

function frame(): object {
  return { contentWindow: true };
}

describe("reading a bridge request", () => {
  it("accepts the declared request shape and nothing else", () => {
    expect(
      webuiMiniAppBridgeRequest({ type: WEBUI_MINIAPP_BRIDGE_APPEND_REQUEST, requestId: "r-1", text: "hi" }),
    ).toEqual({ requestId: "r-1", text: "hi" });
    expect(webuiMiniAppBridgeRequest({ type: "something-else", requestId: "r-1", text: "hi" })).toBeUndefined();
    expect(webuiMiniAppBridgeRequest({ type: WEBUI_MINIAPP_BRIDGE_APPEND_REQUEST, text: "hi" })).toBeUndefined();
    expect(webuiMiniAppBridgeRequest({ type: WEBUI_MINIAPP_BRIDGE_APPEND_REQUEST, requestId: "r", text: 7 })).toBeUndefined();
    expect(webuiMiniAppBridgeRequest(null)).toBeUndefined();
    expect(webuiMiniAppBridgeRequest("text")).toBeUndefined();
  });
});

describe("the injected page capability list", () => {
  it("reports implemented methods and leaves unsupported native APIs unavailable", () => {
    const window = { mcode: {}, parent: {}, addEventListener: vi.fn() };
    // The page script reads these at load: it measures the page's own background
    // (`document.documentElement` / `document.body`) and watches for the host
    // painting over it (`MutationObserver`). A served document has all three; this
    // context is a bare vm, so the harness supplies them.
    const surface = {
      style: {
        getPropertyValue: () => "",
        getPropertyPriority: () => "",
        setProperty: () => undefined,
        removeProperty: () => undefined,
      },
      classList: { contains: () => false, toggle: () => undefined },
    };
    class MutationObserverStub {
      observe() {}
      disconnect() {}
    }
    const document = { documentElement: surface, body: surface };
    runInNewContext(miniAppPageBridge("fixture.miniapp").script, { window, Map, Math, Date, Promise, Error, document, MutationObserver: MutationObserverStub, WeakMap });
    const has = (window.mcode as { miniapp: { capabilities: { has(name: string): boolean } } })
      .miniapp.capabilities.has;

    expect(has("message.append")).toBe(true);
    expect(has("agent.sessions")).toBe(true);
    expect(has("agent.session")).toBe(true);
    // Honoured as a watch over the runtime's settled turns, so a page stops treating
    // its task list as unsupported.
    expect(has("agent.observe")).toBe(true);
    expect(has("speech.transcribe")).toBe(false);
    // Honoured as a floating box inside this page, so the page stops treating its
    // window features as unsupported.
    expect(has("window")).toBe(true);
  });
});

describe("the sender check", () => {
  it("answers only the framed window on the framed origin", () => {
    const target = frame();
    expect(
      webuiMiniAppBridgeSenderAllowed({ origin: VIEW_URL, viewUrl: VIEW_URL, source: target, frame: target }),
    ).toBe(true);
    // A second frame, or the page's own window: not the document this view framed.
    expect(
      webuiMiniAppBridgeSenderAllowed({ origin: VIEW_URL, viewUrl: VIEW_URL, source: frame(), frame: target }),
    ).toBe(false);
    // The right window, a foreign origin.
    expect(
      webuiMiniAppBridgeSenderAllowed({
        origin: "https://example.test",
        viewUrl: VIEW_URL,
        source: target,
        frame: target,
      }),
    ).toBe(false);
    // A different port on loopback is a different origin.
    expect(
      webuiMiniAppBridgeSenderAllowed({
        origin: "http://127.0.0.1:49153",
        viewUrl: VIEW_URL,
        source: target,
        frame: target,
      }),
    ).toBe(false);
  });

  it("answers nothing when the view URL cannot be parsed", () => {
    const target = frame();
    expect(
      webuiMiniAppBridgeSenderAllowed({ origin: VIEW_URL, viewUrl: "not a url", source: target, frame: target }),
    ).toBe(false);
  });
});

describe("a confirmed append", () => {
  const request = { requestId: "r-1", text: "从 Mini App 追加" };

  it("appends to the draft the host read, keeping what the person wrote", async () => {
    const writeDraft = vi.fn();
    const confirm = vi.fn(() => true);
    const result = await webuiMiniAppBridgeAppend({
      request,
      sessionId: "session-1",
      pluginName: "Dashboard",
      confirm,
      readDraft: () => "我自己的草稿",
      writeDraft,
    });
    expect(result).toEqual({ success: true });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(writeDraft).toHaveBeenCalledWith("我自己的草稿\n从 Mini App 追加");
  });

  it("detects the plugin name in the question it asks, so the confirmation names the page", async () => {
    const confirm = vi.fn((_question: string) => false);
    await webuiMiniAppBridgeAppend({
      request,
      sessionId: "session-1",
      pluginName: "Dashboard",
      confirm,
      readDraft: () => "",
      writeDraft: vi.fn(),
    });
    expect(confirm.mock.calls[0]![0]).toContain("Dashboard");
  });

  it("leaves the draft untouched when the person declines", async () => {
    const writeDraft = vi.fn();
    const result = await webuiMiniAppBridgeAppend({
      request,
      sessionId: "session-1",
      pluginName: "Dashboard",
      confirm: () => false,
      readDraft: () => "已有草稿",
      writeDraft,
    });
    expect(result).toEqual({ success: false, code: "user_cancelled" });
    expect(writeDraft).not.toHaveBeenCalled();
  });

  it("refuses text past the contract's bound without asking the person", async () => {
    const writeDraft = vi.fn();
    const confirm = vi.fn(() => true);
    const result = await webuiMiniAppBridgeAppend({
      request: { requestId: "r-2", text: "x".repeat(WEBUI_MINIAPP_COMPOSER_MAX_TEXT_LENGTH + 1) },
      sessionId: "session-1",
      pluginName: "Dashboard",
      confirm,
      readDraft: () => "",
      writeDraft,
    });
    expect(result).toEqual({ success: false, code: "text_too_large" });
    expect(confirm).not.toHaveBeenCalled();
    expect(writeDraft).not.toHaveBeenCalled();
  });

  it("refuses an append with no composer to target", async () => {
    const writeDraft = vi.fn();
    const result = await webuiMiniAppBridgeAppend({
      request,
      pluginName: "Dashboard",
      confirm: () => true,
      readDraft: () => "",
      writeDraft,
    });
    expect(result).toEqual({ success: false, code: "target_unavailable" });
    expect(writeDraft).not.toHaveBeenCalled();
  });

  it("appends after a draft that already ends in a newline without adding a blank line", () => {
    expect(webuiMiniAppDraftWithAppend("", "x")).toBe("x");
    expect(webuiMiniAppDraftWithAppend("a", "x")).toBe("a\nx");
    expect(webuiMiniAppDraftWithAppend("a\n", "x")).toBe("a\nx");
  });
});

describe("the framed URL", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a loopback view URL as it is", () => {
    expect(miniappFrameUrl("http://127.0.0.1:49152/page?mode=dashboard")).toBe(
      "http://127.0.0.1:49152/page?mode=dashboard",
    );
  });

  it("replaces a wildcard host with the host the page was reached at", () => {
    // A page opened on a LAN address cannot fetch a wildcard, and the
    // loopback address it would fall back to is the reader's own machine.
    vi.stubGlobal("window", { location: { hostname: "192.168.1.129" } });
    expect(miniappFrameUrl("http://0.0.0.0:49152/page?mode=dashboard")).toBe(
      "http://192.168.1.129:49152/page?mode=dashboard",
    );
  });

  it("keeps the proxy's own port, so the Mini App stays on its own origin", () => {
    vi.stubGlobal("window", { location: { hostname: "192.168.1.129" } });
    const framed = miniappFrameUrl("http://0.0.0.0:49152/page");
    expect(new URL(framed).port).toBe("49152");
    expect(new URL(framed).origin).not.toBe("http://192.168.1.129:2233");
  });

  it("keeps a view URL it cannot parse", () => {
    expect(miniappFrameUrl("not a url")).toBe("not a url");
  });
});

describe("the Mini App route shim", () => {
  const LOCATION = {
    href: "http://127.0.0.1:49152/fixture.miniapp/page",
    host: "127.0.0.1:49152",
    origin: "http://127.0.0.1:49152",
  };

  it("names the Mini App on the requests its own page makes", async () => {
    const stamped: (string | null)[] = [];
    const window = {
      location: LOCATION,
      fetch: (
        _input: string,
        init?: { readonly headers?: { get?: (name: string) => string | null } },
      ) => {
        stamped.push(init?.headers?.get?.("x-mcode-miniapp-route") ?? null);
        return Promise.resolve({});
      },
    };
    runInNewContext(miniAppRouteShim("fixture.miniapp"), { window, Headers, URL, Promise });

    await window.fetch("/api/bootstrap");
    expect(stamped[0]).toBe("fixture.miniapp");

    // Another origin is another server's business: a header there would ask
    // for a preflight the Mini App never made.
    await window.fetch("https://elsewhere.example/api");
    expect(stamped[1]).toBe(null);
  });

  it("names the Mini App in a socket URL, where a header cannot travel", () => {
    const opened: string[] = [];
    class FakeWebSocket {
      constructor(url: string) {
        opened.push(url);
      }
    }
    const window = { location: LOCATION, WebSocket: FakeWebSocket };
    runInNewContext(miniAppRouteShim("fixture.miniapp"), { window, URL, Promise });

    new window.WebSocket("ws://127.0.0.1:49152/socket");
    expect(opened[0]).toBe("ws://127.0.0.1:49152/socket?mcode_route=fixture.miniapp");
  });

  it("keeps each Mini App's own storage, on an origin they now share", () => {
    const store = new Map<string, string>();
    const window = {
      location: LOCATION,
      localStorage: {
        get length() {
          return store.size;
        },
        key: (index: number) => [...store.keys()][index] ?? null,
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => store.clear(),
      },
    };
    runInNewContext(miniAppRouteShim("fixture.miniapp"), { window, URL, Promise, Proxy });

    window.localStorage.setItem("theme", "dark");
    expect([...store.keys()]).toEqual(["mcode.miniapp.fixture.miniapp.theme"]);
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(window.localStorage.length).toBe(1);

    // A page that reads a key as a property sees its own value, and one that
    // lists the keys it holds sees its own keys.
    expect((window.localStorage as unknown as Record<string, unknown>).theme).toBe("dark");
    expect(Object.keys(window.localStorage)).toEqual(["theme"]);

    // Another Mini App's key is not this Mini App's key.
    store.set("mcode.miniapp.other.miniapp.theme", "light");
    expect(window.localStorage.getItem("theme")).toBe("dark");
    expect(window.localStorage.length).toBe(1);
    expect(Object.keys(window.localStorage)).toEqual(["theme"]);
  });
});
