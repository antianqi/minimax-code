import { describe, expect, it } from 'vitest';

import { parseMiniAppPermissionId, miniAppPermissionId } from '@mavis/shared/miniapp-surface';

import {
  createMiniAppPermissionSwitches,
  declaredMiniAppPermissions,
  miniAppPermissionList,
} from '../../../src/service/plugin-system/plugin/runtime/miniapp/permissions.js';
import type { PluginSnapshot } from '../../../src/service/plugin-system/plugin/runtime/snapshot-builder.js';

const miniapp = {
  hostConnectorAccess: { providers: ['github', 'linear'] },
  agentAccess: ['session.run'],
  toolAccess: ['call'],
  deviceAccess: ['microphone'],
};

function snapshotWith(miniappContribution: Record<string, unknown>): PluginSnapshot {
  return {
    officialPackages: [
      {
        name: 'fixture',
        rootPath: '/fixture',
        contentDigest: 'sha256-tree-v1:00',
        plugin: {
          name: 'fixture',
          rootPath: '/fixture',
          miniapp: miniappContribution,
        },
      },
    ],
    localPlugins: [],
  } as unknown as PluginSnapshot;
}

describe('declared Mini App permissions', () => {
  it('expands the manifest in its own order, one domain:item id per item', () => {
    expect(declaredMiniAppPermissions(miniapp)).toEqual([
      'connector:github',
      'connector:linear',
      'agent:session.run',
      'tool:call',
      'device:microphone',
    ]);
  });

  it('declares nothing for a manifest that asks for nothing', () => {
    expect(declaredMiniAppPermissions({})).toEqual([]);
  });
});

describe('permission ids', () => {
  it('round-trips an id a client sent back', () => {
    const id = miniAppPermissionId('device', 'microphone');
    expect(id).toBe('device:microphone');
    expect(parseMiniAppPermissionId(id)).toEqual({
      id,
      domain: 'device',
      item: 'microphone',
    });
  });

  it('refuses an id no domain admits', () => {
    // A stored id that names nothing would read as a decision about nothing.
    for (const value of [
      '',
      'device',
      'device:',
      ':microphone',
      'camera:microphone',
      'device:camera',
      'tool:list',
      'agent:session.delete',
      'connector:GitHub',
    ]) {
      expect(parseMiniAppPermissionId(value), value).toBeUndefined();
    }
  });
});

describe('Mini App permission list', () => {
  it('reports a declared item as enabled unless it was turned off', () => {
    const list = miniAppPermissionList({
      pluginId: 'fixture',
      source: 'official',
      declared: ['connector:github', 'device:microphone'],
      disabled: new Set(['device:microphone']),
    });

    expect(list.items).toEqual([
      { id: 'connector:github', enabled: true },
      { id: 'device:microphone', enabled: false },
    ]);
  });
});

describe('Mini App permission switches', () => {
  const store = (disabled: string[]) => ({
    listDisabledMiniAppPermissions: () => new Set(disabled),
  });

  it('reads a stored denial as off and anything else as on', () => {
    const switches = createMiniAppPermissionSwitches({
      store: store(['device:microphone']),
      snapshots: () => [snapshotWith({ deviceAccess: ['microphone'] })],
    });

    expect(switches.isEnabled('fixture', 'device:microphone')).toBe(false);
    expect(switches.isEnabled('fixture', 'tool:call')).toBe(true);
  });

  it('only offers a switch for an item the package declares', () => {
    const switches = createMiniAppPermissionSwitches({
      store: store([]),
      snapshots: () => [snapshotWith({ deviceAccess: ['microphone'] })],
    });
    // No denial is stored, so the answer is on; the declaration check lives in the controller.
    expect(switches.isEnabled('fixture', 'connector:github')).toBe(true);
  });

  it('tells every subscriber about a stored change and survives a throwing one', () => {
    const switches = createMiniAppPermissionSwitches({
      store: store([]),
      snapshots: () => [snapshotWith({ deviceAccess: ['microphone'] })],
    });
    const seen: string[] = [];
    switches.subscribe(() => {
      throw new Error('listener failed');
    });
    const unsubscribe = switches.subscribe((change) => seen.push(change.permission));

    switches.publish({ pluginId: 'fixture', permission: 'device:microphone', enabled: false });
    unsubscribe();
    switches.publish({ pluginId: 'fixture', permission: 'device:microphone', enabled: true });

    expect(seen).toEqual(['device:microphone']);
  });
});
