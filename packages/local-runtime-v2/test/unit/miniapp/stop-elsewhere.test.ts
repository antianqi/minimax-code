import { describe, expect, it } from 'vitest';

import { createProcessLocalMiniAppApplication } from '../../../src/application/session/process-local-miniapp-application.js';
import type {
  MiniAppStatus,
  MiniAppSupervisor,
} from '../../../src/service/miniapp/index.js';
import type { MiniAppPluginControl } from '../../../src/service/plugin-system/index.js';

type Supervisor = Pick<
  MiniAppSupervisor,
  'inspect' | 'launchCredential' | 'ownerClient' | 'stopElsewhere'
>;

function harness(input: {
  readonly phase: MiniAppStatus['phase'];
  readonly stoppedElsewhere?: { readonly stopped: boolean; readonly reason?: string };
  readonly refuseLocalStop?: () => Error;
}) {
  const published: string[] = [];
  const elsewhere: string[] = [];
  const plugins = {
    listAvailableMiniApps: async () => [
      { pluginId: 'demo', source: 'official' as const },
    ],
    stopMiniApp: async () => {
      published.push('demo');
      const refusal = input.refuseLocalStop?.();
      if (refusal) throw refusal;
    },
  } as unknown as MiniAppPluginControl;
  const supervisor = {
    inspect: () =>
      [
        {
          pluginId: 'demo',
          phase: input.phase,
          retiringGenerationIds: [],
          leaseCount: 0,
          logs: [],
        } satisfies MiniAppStatus,
      ],
    launchCredential: () => undefined,
    ownerClient: async () => undefined,
    stopElsewhere: async (pluginId: string) => {
      elsewhere.push(pluginId);
      return input.stoppedElsewhere ?? { stopped: true };
    },
  } as unknown as Supervisor;
  return {
    application: createProcessLocalMiniAppApplication(plugins, supervisor),
    published,
    elsewhere,
  };
}

describe('stopping a Mini App', () => {
  it('stops a Mini App this client runs through its publication', async () => {
    const { application, published, elsewhere } = harness({ phase: 'active' });

    await application?.stop({ pluginId: 'demo' });

    expect(published).toEqual(['demo']);
    // This client owns it, so nothing of another client's is touched.
    expect(elsewhere).toEqual([]);
  });

  it('ends the process of a Mini App another client is running', async () => {
    const { application, published, elsewhere } = harness({ phase: 'cold' });

    await application?.stop({ pluginId: 'demo' });

    expect(elsewhere).toEqual(['demo']);
    // The publication does not own it, so it is not asked to stop it.
    expect(published).toEqual([]);
  });

  it('still refuses when there is nothing of another client\'s to stop', async () => {
    const { application, published, elsewhere } = harness({
      phase: 'cold',
      stoppedElsewhere: { stopped: false, reason: 'not-running' },
      refuseLocalStop: () => new Error('Mini App definition is not accepted'),
    });

    await expect(application?.stop({ pluginId: 'demo' })).rejects.toThrow(
      'Mini App definition is not accepted',
    );
    expect(elsewhere).toEqual(['demo']);
    // The refusal the publication raises is the honest answer.
    expect(published).toEqual(['demo']);
  });
});
