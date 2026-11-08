// The Mini App proxy the WebUI service owns.
//
// One listener for every Mini App, and this is where it lives.
//
//   * **A listener outlives a request.** `openMiniApp` registers a Mini App on
//     it, `stopMiniApp` drops that registration, and a service that shuts down
//     while a Mini App is still running has to close the listener too —
//     otherwise the process exits holding the published port, and the next
//     start fails to bind it.
//   * **The port is fixed.** Every Mini App is published on one port, so a Mini
//     App that arrives in the store does not ask the deployment for another
//     firewall rule and another port forward. The Mini Apps are told apart by
//     the path they are served under, not by the port they answer on.
//   * **The listener is bound early.** It is bound when the service starts
//     rather than when the first Mini App opens: the runtime draws its own Mini
//     App ports from the same range, and a listener that waited would lose the
//     port to a Mini App that has no business holding it.

import {
  DEFAULT_MINIAPP_PROXY_PORT,
  startMiniAppProxyHost,
  type MiniAppProxy,
  type MiniAppProxyHost,
  type MiniAppProxyRegistration,
  type MiniAppProxyStarter,
} from "./proxy.js";
import type { WebuiCredential } from "../credentials.js";

export interface MiniAppProxyRegistry {
  /** The Mini Apps that are registered, in registration order. */
  readonly running: () => readonly MiniAppProxy[];
  /** Registers a Mini App on the shared listener, replacing the one it had. */
  readonly start: (registration: MiniAppProxyRegistration) => Promise<MiniAppProxy>;
  /** Drops one Mini App's registration, if it has one. */
  readonly close: (pluginId: string) => Promise<void>;
  /** Closes the listener and every registration. The service calls this on the way down. */
  readonly closeAll: () => Promise<void>;
  /**
   * Binds the shared listener before the first Mini App asks for it.
   *
   * A failure is not fatal: the port may be free by the time a Mini App opens,
   * so the next registration tries again.
   */
  readonly prepare: () => Promise<void>;
  /** The port the listener answers on, once it is bound. */
  readonly boundPort: () => number | undefined;
}

export function createMiniAppProxyRegistry(
  deps: {
    /**
     * A substitute for the registration step.
     *
     * A test observes the registrations through it. It owns whatever listener
     * it starts, so this registry neither binds nor closes one.
     */
    readonly start?: MiniAppProxyStarter;
    /**
     * The address the listener binds.
     *
     * It follows the WebUI service's own bind address, so a service published
     * beyond loopback publishes its Mini App listener with it.
     */
    readonly host?: string;
    /** The port every Mini App is published on. */
    readonly port?: number;
    /**
     * The WebUI's per-start credential, for a listener bound beyond loopback.
     */
    readonly credential?: WebuiCredential;
    /** Explicitly omit the published listener's WebUI token gate. */
    readonly fullAccess?: boolean;
  } = {},
): MiniAppProxyRegistry {
  const proxies = new Map<string, MiniAppProxy>();
  let listener: Promise<MiniAppProxyHost> | undefined;
  let port: number | undefined;

  const ensureListener = async (): Promise<MiniAppProxyHost> => {
    if (!listener) {
      listener = startMiniAppProxyHost({
        ...(deps.host !== undefined ? { host: deps.host } : {}),
        ...(deps.port !== undefined ? { port: deps.port } : {}),
        ...(deps.credential !== undefined ? { credential: deps.credential } : {}),
        ...(deps.fullAccess !== undefined ? { fullAccess: deps.fullAccess } : {}),
      }).catch((error: unknown) => {
        // A listener that could not bind is tried again on the next Mini App:
        // the port may have been freed since.
        listener = undefined;
        throw error;
      });
    }
    const bound = await listener;
    port = bound.port;
    return bound;
  };

  return {
    running: () => [...proxies.values()],
    async start(registration) {
      const pluginId = registration.target.pluginId;
      const existing = proxies.get(pluginId);
      if (existing) {
        proxies.delete(pluginId);
        await existing.close();
      }
      const proxy = deps.start
        ? await deps.start(registration)
        : await (await ensureListener()).register(registration);
      proxies.set(pluginId, proxy);
      return proxy;
    },
    async close(pluginId) {
      const proxy = proxies.get(pluginId);
      if (!proxy) return;
      proxies.delete(pluginId);
      await proxy.close();
    },
    async closeAll() {
      const registrations = [...proxies.values()];
      proxies.clear();
      // Every registration is closed and every failure is kept. Stopping at
      // the first failure would leave the other Mini Apps bound; swallowing it
      // — which this used to do — reported a clean shutdown while a listener
      // still held the published port, so the next start could not bind it and
      // nothing said why.
      const failures: unknown[] = [];
      for (const proxy of registrations) {
        try {
          await proxy.close();
        } catch (error) {
          failures.push(error);
        }
      }
      const bound = listener;
      listener = undefined;
      port = undefined;
      if (bound) {
        // A listener that never bound has nothing to close and its bind failure
        // was already reported by whoever awaited it.
        const host = await bound.catch(() => undefined);
        if (host) {
          try {
            await host.close();
          } catch (error) {
            failures.push(error);
          }
        }
      }
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1)
        throw new AggregateError(failures, "Mini App proxy shutdown failed");
    },
    async prepare() {
      if (deps.start) return;
      try {
        await ensureListener();
      } catch (error) {
        console.warn("[webui] the Mini App proxy could not bind its port", {
          port: deps.port ?? DEFAULT_MINIAPP_PROXY_PORT,
          message: String(error),
        });
      }
    },
    boundPort: () => port,
  };
}
