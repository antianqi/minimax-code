import { parsePluginMentions } from '@mavis/shared/plugin-mention';

export interface ReferencedMiniAppActivation {
  readonly userText: string | undefined;
  readonly availableMiniApps: readonly { readonly pluginId: string }[];
  readonly activate: (pluginId: string) => Promise<void>;
  readonly signal?: AbortSignal;
}

/**
 * Starts every Mini App the turn named.
 *
 * A Mini App publishes its own MCP tools only while its runtime runs, so a turn
 * that names one must start it before the model request. A Mini App that cannot
 * start leaves the turn without its tools instead of failing the turn.
 */
export async function activateReferencedMiniApps(
  input: ReferencedMiniAppActivation,
): Promise<readonly string[]> {
  const mentions = parsePluginMentions(input.userText ?? '');
  const started: string[] = [];
  for (const miniApp of input.availableMiniApps) {
    if (!mentions.some((mention) => namesPlugin(mention.pluginId, miniApp.pluginId))) continue;
    if (input.signal?.aborted) break;
    try {
      await input.activate(miniApp.pluginId);
      started.push(miniApp.pluginId);
    } catch {
      // A Mini App that cannot start leaves the turn without its tools.
    }
  }
  return started;
}

/** A mention names a plugin by its name; the mention itself carries the source. */
function namesPlugin(mentionPluginId: string, pluginId: string): boolean {
  return mentionPluginId === pluginId || mentionPluginId.startsWith(`${pluginId}@`);
}
