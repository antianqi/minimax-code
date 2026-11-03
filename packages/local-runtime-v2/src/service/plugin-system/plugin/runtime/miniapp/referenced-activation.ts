import { buildPluginId } from '@mavis/shared/plugin-mention';
import { detectPluginReferencesForMessages } from '@mavis/system-reminder';

export interface ReferencedMiniAppActivation {
  readonly userText: string | undefined;
  readonly availableMiniApps: readonly {
    readonly pluginId: string;
    readonly source: 'official' | 'local';
  }[];
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
  const started: string[] = [];
  for (const pluginId of referencedMiniApps(input)) {
    if (input.signal?.aborted) break;
    try {
      await input.activate(pluginId);
      started.push(pluginId);
    } catch {
      // A Mini App that cannot start leaves the turn without its tools.
    }
  }
  return started;
}

/**
 * The Mini Apps the turn named.
 *
 * A reference is a reference the host already recognises, so this uses the
 * detection the @-reminder uses rather than a second rule: the composer's
 * mention panel inserts a plain `@cutline`, and a linked
 * `[@Cutline](plugin://cutline@official)` names the same Plugin. Both count,
 * and a reference that is not a Mini App names nothing here.
 */
function referencedMiniApps(input: ReferencedMiniAppActivation): readonly string[] {
  const userText = input.userText ?? '';
  if (!userText.trim()) return [];
  const inventory = input.availableMiniApps.map((miniApp) => ({
    name: miniApp.pluginId,
    pluginId: buildPluginId(miniApp.pluginId, miniApp.source),
    appTools: [],
    mcpTools: [],
    skills: [],
  }));
  const selected = detectPluginReferencesForMessages(
    [{ content: userText }],
    userText,
    inventory,
  );
  const named = new Set(selected.map((plugin) => plugin.name));
  return input.availableMiniApps
    .filter((miniApp) => named.has(miniApp.pluginId))
    .map((miniApp) => miniApp.pluginId);
}
