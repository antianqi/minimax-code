import { describe, expect, it, vi } from 'vitest';

import { activateReferencedMiniApps } from './referenced-activation.js';

const available = [
  { pluginId: 'cutline', source: 'official' as const },
  { pluginId: 'minimax-bot', source: 'official' as const },
];

describe('A turn that names a Mini App starts it before the model request', () => {
  it('activates the Mini App the composer named in plain text', async () => {
    const activate = vi.fn(async () => undefined);

    // The composer's mention panel inserts a plain `@cutline`, which is what
    // the WebUI sends.
    const activated = await activateReferencedMiniApps({
      userText: '你好， @cutline  帮我看一下这个插件可用吗',
      availableMiniApps: available,
      activate,
    });

    expect(activate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledWith('cutline');
    expect(activated).toEqual(['cutline']);
  });

  it('activates the Mini App a linked reference named', async () => {
    const activate = vi.fn(async () => undefined);

    const activated = await activateReferencedMiniApps({
      userText: '[@Cutline](plugin://cutline%40official) trim the clip',
      availableMiniApps: available,
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
      availableMiniApps: available,
      activate,
    });

    expect(activate).not.toHaveBeenCalled();
    expect(activated).toEqual([]);
  });

  it('does not read an address or a longer word as a reference', async () => {
    const activate = vi.fn(async () => undefined);

    await activateReferencedMiniApps({
      userText: 'write to foo@cutline.com and read @cutline-notes',
      availableMiniApps: available,
      activate,
    });

    expect(activate).not.toHaveBeenCalled();
  });

  it('keeps the turn going when a referenced Mini App cannot start', async () => {
    const activate = vi.fn(async () => {
      throw new Error('service limit reached');
    });

    await expect(
      activateReferencedMiniApps({
        userText: '@cutline trim the clip',
        availableMiniApps: available,
        activate,
      }),
    ).resolves.toEqual([]);
  });
});
