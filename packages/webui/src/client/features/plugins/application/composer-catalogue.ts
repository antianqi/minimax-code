// The Composer-facing plugin catalogue.
//
// The composer needed two things from this business and had to reach past the
// owner for both:
//
//   * it called `pluginManagement({ action: "listInstalledPlugins", ... })`
//     directly — a raw wire verb, spelled by a caller that had no business
//     knowing it — and then re-derived the rows it wanted out of whatever came
//     back, with its own copy of the "the runtime spells this list three ways"
//     rule;
//   * it read runtime skills through the port's own `listSkills` member and
//     cached them in a ref inside the component, so the skills the composer
//     showed and the skills the plugin manager listed were two unrelated
//     requests with two unrelated lifetimes.
//
// The skill read is the runtime ROSTER — `listRuntimeSkills`, the list a turn
// can load — and not the management catalogue. The palette shows what the
// agent can run; the management page shows what is installed. They are
// different lists in the runtime, and the palette was reading the wrong one:
// the catalogue is paged, carries no plugin skills, and stops at the runtime's
// first page, so the palette offered a fraction of the roster.
//
// Both are the same mistake: the composer's view of what is installed is a
// business fact, so it is answered here and the composer asks a question.
//
// The identity rule matters here. This read is keyed and cached
// under its own key, deliberately not shared with the management owner's
// selection: opening the composer menu must not overwrite what the plugin
// manager is showing, and a management reload must not blank the mention list.
// Two readers, two identities, one wire.
//
// The catalogue SHAPE — `WebuiComposerPluginCatalogue`, `WebuiComposerPluginSummary`
// and `WebuiComposerSkillSummary` — lives in the published sibling
// `composer-catalogue.public.ts`, so the composer and its `+` menu read the
// owner's published types rather than a peer's private module. The creator and
// the runtime cache stay here because a peer reads the catalogue, it does not
// build one.

import {
  webuiPluginRows,
  type WebuiPluginActions,
} from "../contracts/plugin-actions.js";
import type {
  WebuiComposerPluginCatalogue,
  WebuiComposerPluginSummary,
  WebuiComposerSkillScope,
  WebuiComposerSkillSummary,
} from "./composer-catalogue.public.js";

/** How many installed plugins the composer asks for. */
const COMPOSER_PLUGIN_LIMIT = 200;

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

/**
 * The cache key of one roster read.
 *
 * The scope is the key, because the scope is what decides the answer: the same
 * agent read for another session is another roster, and reading it twice would
 * cost a round trip to learn the same thing.
 */
function skillSlotKey(scope: WebuiComposerSkillScope | undefined): string {
  return JSON.stringify([
    scope?.sessionId ?? "",
    scope?.workspaceDir ?? "",
  ]);
}

/**
 * One roster row, read as the palette's summary.
 *
 * The runtime spells a skill's description twice — the raw one and the
 * displayable one — and the displayable one wins, because that is the copy the
 * palette shows.
 */
function toSkillSummary(
  row: Record<string, unknown>,
): WebuiComposerSkillSummary | undefined {
  const name = text(row, "name");
  if (!name) return undefined;
  const displayName = text(row, "displayName");
  const description = text(row, "displayDescription") || text(row, "description");
  const sourceKind = text(row, "sourceKind");
  const sourceType = row.sourceType;
  const enabled = row.enabled;
  return {
    name,
    ...(displayName ? { displayName } : {}),
    ...(description ? { description } : {}),
    ...(typeof enabled === "boolean" ? { enabled } : {}),
    ...(sourceKind ? { sourceKind } : {}),
    ...(typeof sourceType === "number" ? { sourceType } : {}),
  };
}

/**
 * The creator's surface: the published read catalogue plus the application's
 * teardown.
 *
 * `dispose` is deliberately **not** on `WebuiComposerPluginCatalogue`. That
 * published type is what the composer renders, and a rendering peer has no
 * business ending the owner's life; the assembly built the catalogue and is the
 * only thing that can fence it.
 */
export interface WebuiComposerPluginCatalogueOwner extends WebuiComposerPluginCatalogue {
  /**
   * Fence the cache: no later read start reaches the runtime, an in-flight read
   * cannot repopulate a slot, and a reader that asks afterwards settles with a
   * refusal instead of a stale answer.
   */
  readonly dispose: () => void;
}

export function createWebuiComposerPluginCatalogue(deps: {
  readonly actions: WebuiPluginActions;
}): WebuiComposerPluginCatalogueOwner {
  const { actions } = deps;
  let disposed = false;
  const disposedRead = (): Promise<never> =>
    Promise.reject(new Error("组件已释放：插件目录在应用销毁后不可再读。"));
  // Separate maps, separate keys: the two readers below must not share a slot.
  //
  // Each map is a cache with no clock, so something has to say when a slot went
  // stale. That is the `invalidate*` pair below, and the assembly calls it off
  // the plugin writes themselves — the catalogue is a reader, and the fact that
  // something it reads changed is owned by whoever wrote it, not by whichever
  // view happens to be looking at a cached answer when it does.
  const pluginReads = new Map<string, Promise<readonly WebuiComposerPluginSummary[]>>();
  // The skill slot is keyed by the SCOPE, not by the agent alone: the same
  // agent's roster differs per workspace, and a session names the workspace.
  const skillReads = new Map<
    string,
    { readonly read: Promise<readonly WebuiComposerSkillSummary[]> }
  >();

  return {
    available: actions.available,

    installedPlugins: () => {
      if (disposed) return disposedRead();
      const key = `installed:${COMPOSER_PLUGIN_LIMIT}`;
      const started = pluginReads.get(key);
      if (started) return started;
      const request = actions
        .invoke("listInstalledPlugins", { limit: COMPOSER_PLUGIN_LIMIT })
        .then((result) =>
          webuiPluginRows(result, "plugins").map((row): WebuiComposerPluginSummary => {
            // The runtime spells a plugin's name three ways; the menu only ever
            // needed one, and which one it picked was decided here.
            const name = text(row, "name") || text(row, "pluginName");
            const displayName = text(row, "displayName") || name;
            const description = text(row, "description");
            return { name, displayName, ...(description ? { description } : {}) };
          }).filter((plugin) => plugin.name),
        )
        .catch((reason: unknown) => {
          // A failed read must not be cached as the answer, or the menu would
          // stay empty until the page reloaded.
          pluginReads.delete(key);
          throw reason;
        })
        .finally(() => {
          // A read that started before teardown does not re-enter the cache
          // afterwards: the fence is the dispose, not the consumer's goodwill.
          if (disposed) pluginReads.delete(key);
        });
      pluginReads.set(key, request);
      return request;
    },

    invalidatePlugins: () => {
      pluginReads.clear();
    },

    invalidateSkills: () => {
      // A skill write can change any session's roster, and a slot holds a
      // session's roster without naming the agent behind it, so every slot
      // goes: the catalogue cannot tell which agent a session runs.
      skillReads.clear();
    },

    runtimeSkills: (scope) => {
      if (disposed) return disposedRead();
      const key = skillSlotKey(scope);
      const started = skillReads.get(key);
      if (started) return started.read;
      // The runtime ROSTER, not the management catalogue. The roster is the
      // list a turn can load: it carries the plugin skills and the workspace's
      // own skills, and the runtime answers it for one agent and one session.
      // The management catalogue is a different list — paged, user-facing, and
      // without the plugin skills — and it is what the management page reads.
      const request = actions
        .invoke("listRuntimeSkills", {
          ...(scope?.sessionId ? { sessionId: scope.sessionId } : {}),
          ...(scope?.workspaceDir ? { workspaceDir: scope.workspaceDir } : {}),
          // The plugin skills are part of the roster the agent can run, so they
          // belong in the palette; the management page reads them separately.
          includePluginSkills: true,
        })
        .then((result) =>
          webuiPluginRows(result, "skills")
            .map(toSkillSummary)
            .filter((skill): skill is WebuiComposerSkillSummary => skill !== undefined)
            // A turned-off skill is not offered: the agent cannot run it, so
            // the palette must not offer it either.
            .filter((skill) => skill.enabled !== false),
        )
        .catch((reason: unknown) => {
          skillReads.delete(key);
          throw reason;
        })
        .finally(() => {
          // Same fence as the plugin slot: a read in flight across teardown does
          // not re-enter the cache afterwards.
          if (disposed) skillReads.delete(key);
        });
      skillReads.set(key, { read: request });
      return request;
    },

    dispose: () => {
      if (disposed) return;
      disposed = true;
      pluginReads.clear();
      skillReads.clear();
    },
  };
}