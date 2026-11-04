import { describe, expect, it, afterEach } from "vitest";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  markWebuiEventWatcherDown,
  markWebuiEventWatcherHealthy,
  registerWebuiEventWatcher,
  unregisterWebuiEventWatcher,
} from "../../src/client/platform/connection-health.js";
import {
  ConnectionStatus as BaseConnectionStatus,
  projectWebuiConnectionState,
  type ConnectionStatusProps,
} from "../../src/client/shell/ConnectionStatus.js";
import { createWebuiSessionStore } from "../../src/client/application/session-store.js";
import { WebuiSessionStoreProvider } from "../../src/client/bindings/application-context.js";
import type { WebuiStreamState } from "../../src/client/features/turn/projection/stream-state.js";

/**
 * One application store for this suite. It replaces the module-level runtime
 * map the component used to read: a case seeds the session key it claims, then
 * the local `ConnectionStatus` renders the real component inside the provider
 * so the binding reads that store.
 */
const store = createWebuiSessionStore();

function ConnectionStatus(props: ConnectionStatusProps): ReactElement {
  return (
    <WebuiSessionStoreProvider store={store}>
      <BaseConnectionStatus {...props} />
    </WebuiSessionStoreProvider>
  );
}

/**
 * Each case claims its own session key rather than sharing one and inheriting
 * the previous case's phase.
 */
function seed(
  sessionId: string,
  patch: Partial<Pick<WebuiStreamState, "phase" | "refusal" | "status">>,
): string {
  store.updateSession(sessionId, (current) => ({
    ...current,
    stream: { ...current.stream, ...patch },
  }));
  return sessionId;
}

describe("projectWebuiConnectionState", () => {
  it("maps the reconnect phase to reconnecting", () => {
    expect(projectWebuiConnectionState("reconnecting")).toBe("reconnecting");
  });

  it("maps both terminal failure phases to failed", () => {
    expect(projectWebuiConnectionState("error")).toBe("failed");
    expect(projectWebuiConnectionState("refused")).toBe("failed");
  });

  it("treats every working-subscription phase as connected", () => {
    for (const phase of ["idle", "streaming", "waiting", "done"] as const)
      expect(projectWebuiConnectionState(phase)).toBe("connected");
  });
});

describe("ConnectionStatus", () => {
  it("reads a default session as connected", () => {
    const markup = renderToStaticMarkup(<ConnectionStatus sessionId="cs-default" />);
    expect(markup).toContain('data-connection-state="connected"');
    expect(markup).toContain("已连接");
  });

  it("announces the region politely so a change is read without stealing focus", () => {
    const markup = renderToStaticMarkup(<ConnectionStatus sessionId="cs-a11y" />);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('data-testid="webui-connection-status"');
  });

  it("keeps a reconnect silent: a recovering link is not the reader's business", () => {
    // A reconnect retries itself within a few hundred milliseconds. Announcing
    // it put a notice on screen at every page load and every tab wake, so the
    // region renders nothing at all while the loop is mid-attempt.
    const sessionId = seed("cs-reconnect", { phase: "reconnecting" });
    expect(renderToStaticMarkup(<ConnectionStatus sessionId={sessionId} />)).toBe("");
  });

  it("keeps a failure out of the inline region too: the toast is its surface", () => {
    const sessionId = seed("cs-error", { phase: "error" });
    expect(renderToStaticMarkup(<ConnectionStatus sessionId={sessionId} />)).toBe("");
  });

  it("keys the home screen when no session is selected", () => {
    const markup = renderToStaticMarkup(<ConnectionStatus />);
    expect(markup).toContain('data-connection-state="connected"');
  });

  it("tracks a phase change through the store subscription", () => {
    const sessionId = "cs-live";
    expect(renderToStaticMarkup(<ConnectionStatus sessionId={sessionId} />))
      .toContain('data-connection-state="connected"');
    // Both trouble phases collapse to the same inline answer: nothing.
    for (const phase of ["reconnecting", "refused"] as const) {
      store.updateSession(sessionId, (current) => ({
        ...current,
        stream: { ...current.stream, phase },
      }));
      expect(renderToStaticMarkup(<ConnectionStatus sessionId={sessionId} />)).toBe("");
    }
  });

  it("appends a host class name without dropping its own", () => {
    const markup = renderToStaticMarkup(<ConnectionStatus sessionId="cs-class" className="ml-2" />);
    expect(markup).toContain("ml-2");
    expect(markup).toContain("webui-connection-status");
  });
});

describe("ConnectionStatus host layout calls", () => {
  it("collapses the connected state when the host asks it to", () => {
    // The shell's usage: 已连接 earns zero pixels. The null return (not an
    // empty div) is the contract — a zero-height leftover would still claim
    // the banner slot's gap and nudge the transcript on every state change.
    const markup = renderToStaticMarkup(
      <ConnectionStatus sessionId="cs-hide-connected" hideWhenConnected />,
    );
    expect(markup).toBe("");
  });

  it("renders no attention state inline, whatever the phase", () => {
    // `hideWhenConnected` is a layout call on the healthy state only; every
    // troubled phase leaves the region empty because its surface is the toast.
    for (const phase of ["reconnecting", "refused", "error"] as const) {
      const sessionId = seed(`cs-hide-${phase}`, { phase });
      expect(
        renderToStaticMarkup(<ConnectionStatus sessionId={sessionId} hideWhenConnected />),
      ).toBe("");
    }
  });

  it("keeps the retry affordance out of the inline region", () => {
    // The button belongs to the failure toast (`connection-status.spec.mjs`
    // proves it end to end); a second copy here would offer two arms for one
    // recovery.
    const failed = seed("cs-retry-wired", { phase: "refused" });
    expect(
      renderToStaticMarkup(<ConnectionStatus sessionId={failed} onRetry={() => {}} />),
    ).not.toContain("webui-connection-status-retry");
  });

  it("is mounted by the shell with the collapsed-when-healthy layout call", () => {
    // Source-level, the same convention the child-row meta and rail wiring
    // tests use: `renderToStaticMarkup` cannot fire the store subscription a
    // real mount needs, and the browser spec proves the placed region for
    // real. What this pins is that the shell actually renders the component —
    // the component once existed with zero consumers, which is exactly
    // the gap that made every connection state invisible.
    const source = readFileSync(
      new URL("../../src/client/shell/WebuiClientFoundationApp.tsx", import.meta.url),
      "utf8",
    );
    const mountAt = source.indexOf("<ConnectionStatus");
    expect(mountAt, "the shell no longer mounts ConnectionStatus").toBeGreaterThanOrEqual(0);
    const mount = source.slice(mountAt, mountAt + 300);
    expect(mount).toContain("hideWhenConnected");
    expect(mount).toContain("onRetry={retrySessionStream}");
    expect(mount).toContain('sessionId={selectedSessionId}');
  });
});

describe("ConnectionStatus and the idle event channel", () => {
  // The health store is module-level and shared with every other suite in
  // this worker, so each case's watcher is unregistered before the next.
  let token: number | undefined;
  afterEach(() => {
    if (token !== undefined) unregisterWebuiEventWatcher(token);
    token = undefined;
  });

  it("stays silent while the event channel is down and the stream is idle", () => {
    // A degraded idle link is the transport reconnecting on its own, so it
    // reads as nothing: no label, no detail, no toast source. The health
    // store still tracks it for whoever needs the diagnostic.
    token = registerWebuiEventWatcher();
    markWebuiEventWatcherHealthy(token);
    markWebuiEventWatcherDown(token);
    expect(
      renderToStaticMarkup(<ConnectionStatus sessionId="cs-idle-degraded" hideWhenConnected />),
    ).toBe("");
  });

  it("stays hidden when the channel is merely booting or healthy again", () => {
    // Never-accepted (boot) is unknown, not degraded; a restored link clears
    // it. Both halves keep the idle page free of a standing banner.
    token = registerWebuiEventWatcher();
    expect(renderToStaticMarkup(<ConnectionStatus sessionId="cs-boot" hideWhenConnected />)).toBe("");
    markWebuiEventWatcherHealthy(token);
    expect(renderToStaticMarkup(<ConnectionStatus sessionId="cs-healthy" hideWhenConnected />)).toBe("");
  });

  it("announces neither the failure nor the degraded channel inline", () => {
    token = registerWebuiEventWatcher();
    markWebuiEventWatcherHealthy(token);
    markWebuiEventWatcherDown(token);
    const failed = seed("cs-both", { phase: "refused", refusal: "连接被重置" });
    expect(
      renderToStaticMarkup(<ConnectionStatus sessionId={failed} hideWhenConnected onRetry={() => {}} />),
    ).toBe("");
  });
});
