import { miniAppPermissionId } from '@mavis/shared/miniapp-surface';

import type { MiniAppPermissionSource } from '../repository.js';
import type { PluginSnapshot } from '../snapshot-builder.js';

/** The parsed Mini App fields that carry declared permissions. */
interface DeclaredPermissionsSource {
  readonly hostConnectorAccess?: { readonly providers: readonly string[] };
  readonly agentAccess?: readonly string[];
  readonly toolAccess?: readonly string[];
  readonly deviceAccess?: readonly string[];
}

export interface MiniAppPermissionTarget {
  readonly pluginId: string;
  readonly source: MiniAppPermissionSource;
  readonly declared: readonly string[];
}

export interface MiniAppPermissionItem {
  readonly id: string;
  readonly enabled: boolean;
}

export interface MiniAppPermissionListResult {
  readonly pluginId: string;
  readonly source: MiniAppPermissionSource;
  readonly items: readonly MiniAppPermissionItem[];
}

export interface MiniAppPermissionChange {
  readonly pluginId: string;
  readonly permission: string;
  readonly enabled: boolean;
}

/** The half of the repository the switches read; the controller owns the writes. */
export interface MiniAppPermissionStore {
  listDisabledMiniAppPermissions(
    pluginId: string,
    source: MiniAppPermissionSource,
  ): ReadonlySet<string>;
}

/**
 * The switches as the gateways read them.
 *
 * The source is resolved per read from the snapshot in hand: one id can be served by an official
 * package and a local one, and when both serve it a decision on either turns the item off. A
 * listener hears every stored change so a gateway can stop what is already running — the Agent
 * gateway aborts a run whose `agent:session.run` was just revoked.
 */
export interface MiniAppPermissionSwitches {
  isEnabled(pluginId: string, permission: string): boolean;
  publish(change: MiniAppPermissionChange): void;
  subscribe(listener: (change: MiniAppPermissionChange) => void): () => void;
}

/** Every switchable item the manifest declares, in manifest order. */
export function declaredMiniAppPermissions(miniapp: DeclaredPermissionsSource): string[] {
  return [
    ...(miniapp.hostConnectorAccess?.providers ?? []).map((provider) =>
      miniAppPermissionId('connector', provider),
    ),
    ...(miniapp.agentAccess ?? []).map((item) => miniAppPermissionId('agent', item)),
    ...(miniapp.toolAccess ?? []).map((item) => miniAppPermissionId('tool', item)),
    ...(miniapp.deviceAccess ?? []).map((item) => miniAppPermissionId('device', item)),
  ];
}

/** The package serving `pluginId` in this snapshot, and which half it came from. */
export function findMiniAppPermissionTarget(
  snapshot: PluginSnapshot,
  pluginId: string,
): MiniAppPermissionTarget | undefined {
  const official = snapshot.officialPackages.find(
    ({ plugin }) => plugin?.name === pluginId && plugin.miniapp !== undefined,
  );
  if (official?.plugin?.miniapp) {
    return {
      pluginId,
      source: 'official',
      declared: declaredMiniAppPermissions(official.plugin.miniapp),
    };
  }
  const local = snapshot.localPlugins.find(
    ({ plugin }) => plugin.name === pluginId && plugin.miniapp !== undefined,
  );
  if (local?.plugin.miniapp) {
    return {
      pluginId,
      source: 'local',
      declared: declaredMiniAppPermissions(local.plugin.miniapp),
    };
  }
  return undefined;
}

/** One package's items with their stored switches, in declared order. */
export function miniAppPermissionList(input: {
  readonly pluginId: string;
  readonly source: MiniAppPermissionSource;
  readonly declared: readonly string[];
  readonly disabled: ReadonlySet<string>;
}): MiniAppPermissionListResult {
  return {
    pluginId: input.pluginId,
    source: input.source,
    items: input.declared.map((id) => ({ id, enabled: !input.disabled.has(id) })),
  };
}

export function createMiniAppPermissionSwitches(options: {
  readonly store: MiniAppPermissionStore;
  readonly snapshots: () => readonly PluginSnapshot[];
}): MiniAppPermissionSwitches {
  const listeners = new Set<(change: MiniAppPermissionChange) => void>();
  const sourcesBySnapshot = new WeakMap<PluginSnapshot, Map<string, MiniAppPermissionSource>>();

  const sourcesIn = (snapshot: PluginSnapshot): Map<string, MiniAppPermissionSource> => {
    const cached = sourcesBySnapshot.get(snapshot);
    if (cached) return cached;
    const sources = new Map<string, MiniAppPermissionSource>();
    for (const { plugin } of snapshot.officialPackages) {
      if (plugin?.miniapp && !sources.has(plugin.name)) sources.set(plugin.name, 'official');
    }
    for (const { plugin } of snapshot.localPlugins) {
      if (plugin.miniapp && !sources.has(plugin.name)) sources.set(plugin.name, 'local');
    }
    sourcesBySnapshot.set(snapshot, sources);
    return sources;
  };

  const sourceOf = (pluginId: string): MiniAppPermissionSource | undefined => {
    for (const snapshot of options.snapshots()) {
      const source = sourcesIn(snapshot).get(pluginId);
      if (source) return source;
    }
    return undefined;
  };

  return {
    isEnabled(pluginId, permission) {
      const source = sourceOf(pluginId);
      // An id this snapshot does not serve counts as on when neither half denies it: the answer is
      // only ever used to gate a call that a served package made.
      const sources: readonly MiniAppPermissionSource[] = source
        ? [source]
        : ['official', 'local'];
      return sources.every(
        (candidate) =>
          !options.store.listDisabledMiniAppPermissions(pluginId, candidate).has(permission),
      );
    },
    publish(change) {
      for (const listener of [...listeners]) {
        try {
          listener(change);
        } catch {
          // The switch is stored and new calls already read it; a listener reports its own failure.
        }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
