import { describe, expect, it, vi } from 'vitest';

import {
  AgentHostTurnCapabilityLifecycle,
  type AgentHostTurnCapabilityProvider,
} from './turn-capability-lifecycle.js';

function providerWithPreparation(
  prepareTurnCapabilities: AgentHostTurnCapabilityProvider['prepareTurnCapabilities'],
): AgentHostTurnCapabilityProvider {
  return {
    waitUntilReady: async () => undefined,
    prepareTurnCapabilities,
    captureTurnCapabilities: () => ({
      revision: 'r1',
      plugins: [],
      skills: [],
      runtimeTools: [],
      runtimeToolBindings: [],
    }),
    onHostIdle: () => undefined,
  };
}

describe('Turn capability preparation knows what the turn asked for', () => {
  it('hands the turn user text to the preparation that runs before the model request', async () => {
    const prepareTurnCapabilities = vi.fn(async () => ({
      runtimeTools: [],
      runtimeToolBindings: [],
    }));
    const lifecycle = new AgentHostTurnCapabilityLifecycle();
    lifecycle.attach(providerWithPreparation(prepareTurnCapabilities));

    await lifecycle.acquire({
      sessionId: 's',
      turnId: 't',
      userText: '[@Cutline](plugin://cutline%40official) trim the clip',
    });

    expect(prepareTurnCapabilities).toHaveBeenCalledTimes(1);
    expect(prepareTurnCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: '[@Cutline](plugin://cutline%40official) trim the clip',
      }),
    );
  });

  it('prepares without a user text when the turn carries none', async () => {
    const prepareTurnCapabilities = vi.fn(async () => ({
      runtimeTools: [],
      runtimeToolBindings: [],
    }));
    const lifecycle = new AgentHostTurnCapabilityLifecycle();
    lifecycle.attach(providerWithPreparation(prepareTurnCapabilities));

    await lifecycle.acquire({ sessionId: 's', turnId: 't' });

    expect(prepareTurnCapabilities).toHaveBeenCalledTimes(1);
    expect(prepareTurnCapabilities).toHaveBeenCalledWith(
      expect.objectContaining({ userText: undefined }),
    );
  });
});
