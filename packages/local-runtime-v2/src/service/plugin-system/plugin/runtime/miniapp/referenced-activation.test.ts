import { describe, expect, it, vi } from 'vitest';

import { activateReferencedMiniApps } from './referenced-activation.js';

describe('A turn that names a Mini App starts it before the model request', () => {
  it('activates the Mini App the turn referenced', async () => {
    const activate = vi.fn(async () => undefined);

    const activated = await activateReferencedMiniApps({
      userText: '[@Cutline](plugin://cutline%40official) trim the clip',
      availableMiniApps: [{ pluginId: 'cutline' }, { pluginId: 'minimax-bot' }],
      activate,
    });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith('cutline');
    expect(activated).toEqual(['cutline']);
  });

  it('leaves a referenced plugin that is not a Mini App alone', async () => {
    const activate = vi.fn(async () => undefined);

    const activated = await activateReferencedMiniApps({
      userText: '[@Notes](plugin://notes%40official) summarize',
      availableMiniApps: [{ pluginId: 'cutline' }],
      activate,
    });

    expect(activate).not.toHaveBeenCalled();
    expect(activated).toEqual([]);
  });

  it('keeps the turn going when a referenced Mini App cannot start', async () => {
    const activate = vi.fn(async () => {
      throw new Error('service limit reached');
    });

    await expect(
      activateReferencedMiniApps({
        userText: '[@Cutline](plugin://cutline%40official) trim the clip',
        availableMiniApps: [{ pluginId: 'cutline' }],
        activate,
      }),
    ).resolves.toEqual([]);
  });
});
