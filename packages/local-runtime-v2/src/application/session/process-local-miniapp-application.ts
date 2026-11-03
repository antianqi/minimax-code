import type { MiniAppSurfaceSummary } from '@mavis/shared/miniapp-surface';

import {
  miniAppBusyReason,
  deriveMiniAppNodePort,
  probeMiniAppPortOwnership,
  type MiniAppStatus,
  type MiniAppSupervisor,
} from '../../service/miniapp/index.js';
import type {
  AvailableMiniAppDefinition,
  MiniAppPluginControl,
} from '../../service/plugin-system/index.js';
import type { MiniAppToolSessions } from '../../service/miniapp/tool-sessions.js';
import type { MiniAppToolApprovals } from '../../service/miniapp/tool-approvals.js';
import type {
  LocalRuntimeApplication,
  ProcessLocalMiniAppLaunch,
} from './process-local-application-contract.js';

type ProcessLocalMiniAppApplication = NonNullable<LocalRuntimeApplication['miniApps']>;

/** Projects installed MiniApp definitions and Supervisor state for the Electron bridge. */
export function createProcessLocalMiniAppApplication(
  plugins: MiniAppPluginControl,
  supervisor:
    | Pick<MiniAppSupervisor, 'inspect' | 'launchCredential' | 'ownerClient' | 'stopElsewhere'>
    | undefined,
  tools?: MiniAppToolSessions,
  approvals?: MiniAppToolApprovals,
): ProcessLocalMiniAppApplication | undefined {
  if (!supervisor) return undefined;

  const requireDefinition = async (pluginId: string): Promise<AvailableMiniAppDefinition> => {
    const miniApp = (await plugins.listAvailableMiniApps()).find(
      (candidate) => candidate.pluginId === pluginId,
    );
    if (!miniApp) throw applicationError('NOT_FOUND');
    return miniApp;
  };

  const launch = (
    miniApp: AvailableMiniAppDefinition,
    status: MiniAppStatus | undefined,
  ): ProcessLocalMiniAppLaunch => {
    const active = status?.active;
    if (
      status?.phase !== 'active' ||
      !active?.origin ||
      !active.processGeneration ||
      active.pluginId !== miniApp.pluginId
    ) {
      throw applicationError(status?.failureCode ?? 'RUNTIME_FAILED');
    }
    const credential = supervisor.launchCredential(miniApp.pluginId);
    if (credential === undefined) throw applicationError('RUNTIME_FAILED');
    return {
      miniApp: summary(miniApp, status),
      launch: {
        origin: active.origin,
        surfacePath: active.surfacePath,
        runId: active.processGeneration,
        credential,
      },
    };
  };

  const open = async (
    pluginId: string,
    signal?: AbortSignal,
  ): Promise<ProcessLocalMiniAppLaunch> => {
    signal?.throwIfAborted();
    const miniApp = await requireDefinition(pluginId);
    try {
      await plugins.activateMiniApp({ pluginId, ...(signal ? { signal } : {}) });
    } catch (error) {
      const busyReason = miniAppBusyReason(error);
      if (!busyReason) throw error;
      throw Object.assign(applicationError('BUSY', { cause: error }), { busyReason });
    }
    signal?.throwIfAborted();
    return launch(miniApp, supervisor.inspect(pluginId)[0]);
  };

  /**
   * The generation a page's view belongs to.
   *
   * A page cannot name it: the client that framed the document knows the plugin, and the
   * runtime knows which process is serving it. Reading it here keeps the connector
   * gateway's registration key the Host's fact rather than a page's claim.
   */
  const runningGeneration = (pluginId: string): string | undefined =>
    supervisor.inspect(pluginId)[0]?.active?.processGeneration;

  const listRows = async (
    definitions: readonly AvailableMiniAppDefinition[],
    statuses: ReadonlyMap<string, MiniAppStatus>,
  ): Promise<readonly MiniAppSurfaceSummary[]> =>
    Promise.all(
      definitions.map(async (miniApp) => {
        const status = statuses.get(miniApp.pluginId);
        if (status?.phase === 'active' || status?.phase === 'starting' || status?.phase === 'preparing') {
          return summary(miniApp, status);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 500);
        timer.unref();
        try {
          const ownership = await probeMiniAppPortOwnership({
            port: deriveMiniAppNodePort(miniApp.pluginId),
            timeoutMs: 500,
            signal: controller.signal,
          });
          const ownedElsewhere = ownership === 'guarded';
          const ownerClient = ownedElsewhere && supervisor.ownerClient
            ? await supervisor.ownerClient(miniApp.pluginId).catch(() => undefined)
            : undefined;
          return summary(miniApp, status, ownedElsewhere, ownerClient);
        } catch {
          return summary(miniApp, status);
        } finally {
          clearTimeout(timer);
        }
      }),
    );

  return {
    list: async () => {
      const definitions = await plugins.listAvailableMiniApps();
      const statuses = new Map(supervisor.inspect().map((status) => [status.pluginId, status]));
      return { miniApps: await listRows(definitions, statuses) };
    },
    listInstalled: async () => {
      const definitions = await plugins.listInstalledMiniApps();
      const statuses = new Map(supervisor.inspect().map((status) => [status.pluginId, status]));
      return { miniApps: await listRows(definitions, statuses) };
    },
    // Neither call needs the Supervisor: a switch is a stored decision, and the gateways read it
    // when a call arrives, so turning one off does not restart or stop anything here.
    listPermissions: (pluginId) => plugins.listMiniAppPermissions(pluginId),
    setPermission: (input) => plugins.setMiniAppPermission(input),
    /**
     * The prompts waiting for a person.
     *
     * The subscription starts with the list as it stands: a client that connects after a
     * prompt appeared must render it, not wait for the next change.
     */
    watchToolApprovals(onPending) {
      if (!approvals) return () => undefined;
      onPending(approvals.pending());
      return approvals.subscribe(onPending);
    },
    /**
     * One answer.
     *
     * The package is resolved first, so a request for a package this Host does not serve
     * is `NOT_FOUND` before the queue is touched; an id that is gone, or belongs to
     * another package, is `NOT_FOUND` too rather than a silent no-op.
     */
    async replyToolApproval(input) {
      await requireDefinition(input.pluginId);
      if (!approvals) throw applicationError('UNAVAILABLE');
      const settled = approvals.answer({
        requestId: input.requestId,
        pluginId: input.pluginId,
        decision: input.decision,
        ...(input.names !== undefined ? { names: input.names } : {}),
      });
      if (!settled) throw applicationError('NOT_FOUND');
      return { success: true as const };
    },
    /**
     * One page tool request.
     *
     * The package is resolved first, so a request for a package this Host does not serve
     * is refused as `NOT_FOUND` rather than as an absent channel. A channel this Host did
     * not compose is `UNAVAILABLE`, which is not the same answer as "no tools".
     */
    async callTool(input) {
      await requireDefinition(input.pluginId);
      if (!tools) throw applicationError('UNAVAILABLE');
      const generation = input.processGeneration ?? runningGeneration(input.pluginId);
      return tools.run({
        ...input,
        ...(generation !== undefined ? { processGeneration: generation } : {}),
      });
    },
    open: ({ pluginId, signal }) => open(pluginId, signal),
    /**
     * Stops one Mini App, whichever client is running it.
     *
     * A Mini App this client owns is stopped through its publication. One that
     * another client owns cannot be stopped that way — this client has no
     * generation of it — so the process serving it is ended instead. The port
     * probe is what proves another client owns it, and it is the same probe the
     * row's label comes from, so the button and the label cannot disagree.
     */
    stop: async ({ pluginId, signal }) => {
      await requireDefinition(pluginId);
      const status = supervisor.inspect(pluginId)[0];
      if (
        status?.phase === 'active' ||
        status?.phase === 'starting' ||
        status?.phase === 'preparing'
      ) {
        await plugins.stopMiniApp({ pluginId, ...(signal ? { signal } : {}) });
        return;
      }
      const stopped = await supervisor.stopElsewhere(pluginId, {
        ...(signal ? { signal } : {}),
      });
      if (stopped.stopped) return;
      // Nothing of another client's was running either: the refusal the
      // publication raises is the honest answer.
      await plugins.stopMiniApp({ pluginId, ...(signal ? { signal } : {}) });
    },
  };
}

function summary(
  miniApp: AvailableMiniAppDefinition,
  status: MiniAppStatus | undefined,
  ownedElsewhere = false,
  ownerClient?: string,
): MiniAppSurfaceSummary {
  const runtimeStatus = mapRuntimeStatus(status?.phase);
  return {
    pluginId: miniApp.pluginId,
    source: miniApp.source,
    ...(miniApp.enabled !== undefined ? { enabled: miniApp.enabled } : {}),
    ...(miniApp.displayName ? { displayName: miniApp.displayName } : {}),
    ...(miniApp.description ? { description: miniApp.description } : {}),
    ...(miniApp.iconPath ? { iconUrl: localIconUrl(miniApp.iconPath) } : {}),
    runtime: {
      kind: 'process',
      status: runtimeStatus,
      ...(runtimeStatus === 'failed' && status?.failureCode
        ? { errorCode: status.failureCode }
        : {}),
      ...(ownedElsewhere
        ? {
            ownership: 'other-client' as const,
            ...(ownerClient ? { ownerClient } : {}),
          }
        : {}),
    },
  };
}

function localIconUrl(iconPath: string): string {
  return `/mavis/api/file/preview?path=${encodeURIComponent(iconPath)}`;
}

function mapRuntimeStatus(
  phase: MiniAppStatus['phase'] | undefined,
): MiniAppSurfaceSummary['runtime']['status'] {
  if (phase === 'active') return 'running';
  if (phase === 'starting' || phase === 'preparing') return 'starting';
  if (phase === 'failed' || phase === 'quarantined') return 'failed';
  return 'stopped';
}

function applicationError(code: string, options?: ErrorOptions): Error & { readonly code: string } {
  return Object.assign(new Error('Mini App surface action failed', options), { code });
}
