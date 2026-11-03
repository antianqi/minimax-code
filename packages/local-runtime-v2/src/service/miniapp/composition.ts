import { join } from 'node:path';

import type { AppDb } from '../../infra/db/client.js';
import type { HostProcessConnectorGateway } from '../host-connector-system/index.js';
import type { MiniAppAgentGateway } from './agent/contracts.js';
import type { MiniAppCandidate, MiniAppSupervisor, MiniAppPermissionSwitchPort } from './contracts.js';
import {
  initializeMiniAppSupervisor,
  type InitializeMiniAppSupervisorOptions,
} from './initialize.js';
import type { MiniAppMcpHostPort } from './tool-source-mcp.js';
import type { MiniAppToolAuditPort } from './tool-gateway.js';
import type { MiniAppToolApprovalPort, MiniAppToolRulePort } from './tool-permission.js';
import type { MiniAppToolSessions } from './tool-sessions.js';
import { createMiniAppToolHost } from './tool-host.js';
import {
  createMiniAppToolApprovals,
  type MiniAppToolApprovals,
} from './tool-approvals.js';

export type RuntimeMiniAppOptions = Omit<
  InitializeMiniAppSupervisorOptions,
  | 'db'
  | 'connectorGateway'
  | 'verifyCandidate'
  | 'materializePackage'
  | 'resolvePluginDataDir'
  | 'nowMs'
>;

export interface RuntimeMiniAppServices {
  readonly miniApp?: MiniAppSupervisor;
  /**
   * The page's tool channel, when the Host serves one.
   *
   * Absent is not "no tools": it is a Host that has not composed the channel at all,
   * and a page asking through it is told the capability is unavailable rather than
   * being shown an empty shelf.
   */
  readonly miniAppTools?: MiniAppToolSessions;
  /**
   * The prompts a page's `ask` is waiting on.
   *
   * Exposed so the Host can push them to a person and settle them; the channel exists
   * whether or not a client is listening, and an unanswered prompt ends as a refusal.
   */
  readonly miniAppToolApprovals?: MiniAppToolApprovals;
}

export interface RuntimeMiniAppServiceOptions {
  readonly miniApp?: RuntimeMiniAppOptions;
}

export function resolveRuntimeMiniAppOptions(
  input: RuntimeMiniAppServiceOptions & {
    /** The runtime owner policy's `wiring.miniAppService` cell for this host. */
    readonly miniAppService?: boolean;
  },
): RuntimeMiniAppOptions | undefined {
  // Explicit options stay reachable: a caller that constructs the runtime with them has asked for the
  // service by name, including the case with no declared owner kind.
  if (input.miniApp) return input.miniApp;
  return input.miniAppService === true ? {} : undefined;
}

export function createDeferredRuntimeOwnersLifecycle(): {
  readonly ready: () => Promise<void>;
  readonly close: () => Promise<void>;
  bind(lifecycle: {
    readonly ready: () => Promise<void>;
    readonly close: () => Promise<void>;
  }): void;
} {
  let lifecycle:
    | { readonly ready: () => Promise<void>; readonly close: () => Promise<void> }
    | undefined;
  const requireLifecycle = () => {
    if (!lifecycle) throw new Error('Runtime owner lifecycle is not bound');
    return lifecycle;
  };
  return {
    ready: () => requireLifecycle().ready(),
    close: () => requireLifecycle().close(),
    bind(next) {
      if (lifecycle) throw new Error('Runtime owner lifecycle is already bound');
      lifecycle = next;
    },
  };
}

/** Narrow Plugin publication capability consumed only by MiniApp Host composition. */
export interface MiniAppPluginPublicationCapability {
  readonly hostConnectorGateway: HostProcessConnectorGateway;
  /** The user's switches, so the Connector session can read a provider's state per request. */
  readonly miniAppPermissionSwitches?: MiniAppPermissionSwitchPort;
  /** The installed MCP servers the Host serves; absent when the Host serves none. */
  readonly miniAppMcp?: MiniAppMcpHostPort;
  /** Whether the installed package's manifest declares `toolAccess: ['call']`. */
  readonly declaresMiniAppToolAccess: (pluginId: string) => Promise<boolean>;
  attachMiniAppPublication(input: { readonly supervisor: MiniAppSupervisor }): void;
  verifyMiniAppCandidate(candidate: MiniAppCandidate): Promise<boolean>;
  materializeMiniAppRuntimePackage(input: {
    readonly sourceRoot: string;
    readonly targetRoot: string;
  }): Promise<void>;
}

/**
 * The page's tool channel, at the boundary that owns the pieces it joins.
 *
 * Built once per runtime, like the gateways it fronts: a session is opened per page
 * request and a port per `(plugin, generation)`, so nothing here grows with traffic.
 * A Host with no MCP servers composes no channel at all — the page bridge then answers
 * `capability_unavailable`, which is the truth, rather than an empty tool list, which
 * would read as "this Host has no tools".
 */
export function composeMiniAppToolHost(
  plugin: Pick<
    MiniAppPluginPublicationCapability,
    | 'hostConnectorGateway'
    | 'miniAppPermissionSwitches'
    | 'miniAppMcp'
    | 'declaresMiniAppToolAccess'
  >,
  /** The Host's record; the one the Connector gateway writes is the same sink. */
  audit?: MiniAppToolAuditPort,
  /** The Host's rules and prompt. Absent means every tool is `ask` and nothing answers it. */
  ports?: {
    readonly rules?: MiniAppToolRulePort;
    readonly approvals?: MiniAppToolApprovalPort;
  },
): MiniAppToolSessions | undefined {
  if (!plugin.miniAppMcp) return undefined;
  return createMiniAppToolHost({
    mcp: plugin.miniAppMcp,
    connectorGateway: plugin.hostConnectorGateway,
    declaresToolAccess: (pluginId) => plugin.declaresMiniAppToolAccess(pluginId),
    ...(plugin.miniAppPermissionSwitches
      ? { permissionSwitches: plugin.miniAppPermissionSwitches }
      : {}),
    ...(audit ? { audit } : {}),
    ...(ports?.rules ? { permissions: ports.rules } : {}),
    ...(ports?.approvals ? { approvals: ports.approvals } : {}),
  });
}

/** Owns optional Supervisor initialization and ordered shutdown at the Host composition boundary. */
export async function composeMiniAppRuntimeCapability(input: {
  readonly options: RuntimeMiniAppOptions | undefined;
  readonly db: AppDb;
  readonly dataDir: string;
  readonly nowMs: () => number;
  readonly plugin: MiniAppPluginPublicationCapability;
  /** Passed through so the child IPC connector can register its arena on the real gateway. */
  readonly agentGateway?: MiniAppAgentGateway;
  /** The Host's record for page tool calls; omitted when the Host keeps none. */
  readonly toolAudit?: MiniAppToolAuditPort;
  /** The Host's rules for page tool calls, and the prompt an `ask` reaches. */
  readonly toolRules?: MiniAppToolRulePort;
  readonly toolApprovals?: MiniAppToolApprovalPort;
  readonly readyOwners: () => Promise<void>;
  readonly closeOwners: () => Promise<void>;
}): Promise<{
  readonly services: RuntimeMiniAppServices;
  readonly ready: () => Promise<void>;
  readonly close: () => Promise<void>;
}> {
  let miniApp: MiniAppSupervisor | undefined;
  let miniAppTools: MiniAppToolSessions | undefined;
  let miniAppToolApprovals: MiniAppToolApprovals | undefined;
  try {
    if (input.options) {
      // The page's channel is composed here, once, for the same reason the gateways are:
      // a session per request and a port per generation, built from pieces the Host owns.
      // One prompt queue for the process: the gateway's `ask` reaches it, and the
      // exposed copy is what the Host pushes to a person and answers from.
      miniAppToolApprovals = createMiniAppToolApprovals();
      miniAppTools = composeMiniAppToolHost(input.plugin, input.toolAudit, {
        ...(input.toolRules ? { rules: input.toolRules } : {}),
        approvals: input.toolApprovals ?? miniAppToolApprovals,
      });
      miniApp = initializeMiniAppSupervisor({
        ...input.options,
        db: input.db,
        connectorGateway: input.plugin.hostConnectorGateway,
        ...(input.agentGateway ? { agentGateway: input.agentGateway } : {}),
        ...(input.plugin.miniAppPermissionSwitches
          ? { permissionSwitches: input.plugin.miniAppPermissionSwitches }
          : {}),
        verifyCandidate: (candidate) => input.plugin.verifyMiniAppCandidate(candidate),
        materializePackage: (materialization) =>
          input.plugin.materializeMiniAppRuntimePackage(materialization),
        // Plugin-authored context.dataDir is persistent state. Keep the shipped physical root.
        resolvePluginDataDir: (pluginId) =>
          join(input.dataDir, 'v2', 'plugin-data', 'liveboards', encodeURIComponent(pluginId)),
        nowMs: input.nowMs,
      });
      input.plugin.attachMiniAppPublication({ supervisor: miniApp });
    }
  } catch (error) {
    await closeAfterInitializationFailure(miniApp, input.closeOwners);
    throw error;
  }
  return {
    services: miniApp
      ? {
          miniApp,
          ...(miniAppTools ? { miniAppTools } : {}),
          ...(miniAppToolApprovals ? { miniAppToolApprovals } : {}),
        }
      : {},
    ready: createCombinedReady(miniApp, input.readyOwners),
    close: createCombinedClose(input.closeOwners, miniApp),
  };
}

function createCombinedReady(
  miniApp: MiniAppSupervisor | undefined,
  readyOwners: () => Promise<void>,
): () => Promise<void> {
  let readyPromise: Promise<void> | undefined;
  return () => {
    readyPromise ??= readyMiniAppAfterOwners(miniApp, readyOwners);
    return readyPromise;
  };
}

async function readyMiniAppAfterOwners(
  miniApp: MiniAppSupervisor | undefined,
  readyOwners: () => Promise<void>,
): Promise<void> {
  await readyOwners();
  await miniApp?.ready();
}

async function closeAfterInitializationFailure(
  miniApp: MiniAppSupervisor | undefined,
  closeOwners: () => Promise<void>,
) {
  for (const close of [closeOwners, () => miniApp?.close()]) {
    try {
      await close();
    } catch {
      // Preserve the initialization error after best-effort cleanup of acquired owners.
    }
  }
}

function createCombinedClose(
  closeOwners: () => Promise<void>,
  miniApp: MiniAppSupervisor | undefined,
): () => Promise<void> {
  let closePromise: Promise<void> | undefined;
  return () => {
    closePromise ??= closeOwnersAndMiniApp(closeOwners, miniApp);
    return closePromise;
  };
}

async function closeOwnersAndMiniApp(
  closeOwners: () => Promise<void>,
  miniApp: MiniAppSupervisor | undefined,
): Promise<void> {
  let firstError: unknown;
  try {
    await closeOwners();
  } catch (error) {
    firstError = error;
  }
  try {
    await miniApp?.close();
  } catch (error) {
    firstError ??= error;
  }
  if (firstError) throw firstError;
}
