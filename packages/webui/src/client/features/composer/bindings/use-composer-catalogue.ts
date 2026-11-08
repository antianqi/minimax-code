/**
 * What the composer can offer: the installed plugins, the runtime's skill
 * roster, and each one's own loading and failure state.
 *
 * Three effects and a callback used to sit in the component, each with its own
 * cancelled flag, its own "not available" answer and its own copy of the read
 * scope — the plugins list (loaded when the `+` menu shows it or a mention is
 * being typed), the skills submenu, and the slash palette's pool, which had to
 * empty itself and re-read whenever the session or workspace changed. Nothing
 * about them was presentation except the strings; the queries, their scope and
 * their lifetime are what this binding takes.
 *
 * The composer keeps the display decision: sectioning the palette and turning a
 * skill summary into a palette row stay in the `ui/` module that owns that
 * vocabulary. This hook answers with the roster.
 *
 * Behaviour is unchanged: a catalogue that is absent answers empty rather than
 * rejecting, a palette read that fails leaves the fixtures in place, and a
 * scope change empties the pool before the new read so the previous session's
 * skills are never shown under the new session's composer.
 */
import { useCallback, useEffect, useState } from "react";

import type {
  WebuiComposerPluginCatalogue,
  WebuiComposerPluginSummary,
} from "../../plugins/application/composer-catalogue.public.js";
import type { WebuiSlashSkillSummary } from "../ui/slash-palette.js";

/** The `+` menu's section, or undefined when it is closed. */
export type ComposerCatalogueMenu = "root" | "skills" | "plugins" | undefined;

export interface UseComposerCatalogueOptions {
  /** The plugins business's read model; absent when this assembly has none. */
  readonly catalogue: WebuiComposerPluginCatalogue | undefined;
  /** The session whose agent and working directory the roster is read for. */
  readonly sessionId: string | undefined;
  readonly workspaceDir: string | undefined;
  /** The `+` menu's current section — it decides which list is read. */
  readonly menu: ComposerCatalogueMenu;
  /** An `@` mention is being typed, which needs the plugin rows. */
  readonly wantsMentionChoices: boolean;
}

export interface ComposerCatalogue {
  readonly available: boolean;
  readonly plugins: readonly WebuiComposerPluginSummary[];
  readonly pluginsLoading: boolean;
  readonly pluginsError: string | undefined;
  readonly skills: readonly WebuiSlashSkillSummary[];
  readonly skillsLoading: boolean;
  readonly skillsError: string | undefined;
}

export function useComposerCatalogue({
  catalogue,
  sessionId,
  workspaceDir,
  menu,
  wantsMentionChoices,
}: UseComposerCatalogueOptions): ComposerCatalogue {
  const [installedPlugins, setInstalledPlugins] = useState<readonly WebuiComposerPluginSummary[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [pluginsError, setPluginsError] = useState<string>();
  const [skillsMenuLoading, setSkillsMenuLoading] = useState(false);
  const [skillsMenuError, setSkillsMenuError] = useState<string>();
  const [slashSkills, setSlashSkills] = useState<readonly WebuiSlashSkillSummary[]>([]);

  useEffect(() => {
    if (menu !== "plugins" && !wantsMentionChoices) return;
    if (!catalogue?.available) {
      setInstalledPlugins([]);
      return;
    }
    let cancelled = false;
    setPluginsLoading(true);
    setPluginsError(undefined);
    // The rows are already the shape this menu renders, so there is no local
    // copy of the runtime's naming rules here any more.
    catalogue.installedPlugins()
      .then((plugins) => { if (!cancelled) setInstalledPlugins(plugins); })
      .catch((error: unknown) => {
        if (!cancelled) setPluginsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!cancelled) setPluginsLoading(false); });
    return () => { cancelled = true; };
  }, [menu, wantsMentionChoices, catalogue]);

  // The skills submenu and the slash palette render the same pool, so they read
  // it through one loader. The request cache is the catalogue's, keyed by the
  // read's scope, rather than a ref in this binding: a second reader joins the
  // request the first one started instead of replacing the pool underneath it.
  const readSlashSkills = useCallback((): Promise<
    readonly WebuiSlashSkillSummary[]
  > => {
    if (!catalogue) return Promise.reject(new Error("技能目录暂不可用"));
    // The roster is read for the session the composer is on. The runtime
    // resolves that session's agent and working directory from the session
    // itself, so the read names NO agent: the shell's agent name is a
    // placeholder until the session list arrives ("main" is not an agent the
    // runtime knows), and a roster read that names an unknown agent comes
    // back empty. With no session the runtime answers with its default
    // agent's roster.
    return catalogue.runtimeSkills({
      ...(sessionId ? { sessionId } : {}),
      ...(workspaceDir ? { workspaceDir } : {}),
    });
  }, [catalogue, sessionId, workspaceDir]);

  useEffect(() => {
    if (menu !== "skills") return;
    if (!catalogue) {
      setSkillsMenuError("技能目录暂不可用");
      return;
    }
    let cancelled = false;
    setSkillsMenuLoading(true);
    setSkillsMenuError(undefined);
    readSlashSkills()
      .then((skills) => { if (!cancelled) setSlashSkills(skills); })
      .catch((error: unknown) => {
        if (!cancelled) setSkillsMenuError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!cancelled) setSkillsMenuLoading(false); });
    return () => { cancelled = true; };
  }, [menu, catalogue, readSlashSkills]);

  // The slash palette's own pool, pulled when the catalogue is wired up.
  // The fallback (fixtures resolved at module init) keeps the popover
  // functional even if the read is unavailable or rejects; once the live roster
  // returns, fetched entries replace the fixtures in the sectioning pass.
  //
  // The read is scoped, so it follows the scope: another session is another
  // roster, and the old one goes rather than standing in for it. The pool is
  // emptied first for the same reason — showing the previous session's skills
  // under the new session's composer would be a lie.
  useEffect(() => {
    if (!catalogue) return;
    let cancelled = false;
    setSlashSkills([]);
    readSlashSkills()
      .then((skills) => {
        if (cancelled) return;
        setSlashSkills(skills);
      })
      .catch(() => {
        // The popover keeps using the fixtures when the read rejects; the
        // submenu reports the failure in its own state.
      });
    return () => {
      cancelled = true;
    };
  }, [catalogue, readSlashSkills]);

  return {
    available: catalogue?.available === true,
    plugins: installedPlugins,
    pluginsLoading,
    pluginsError,
    skills: slashSkills,
    skillsLoading: skillsMenuLoading,
    skillsError: skillsMenuError,
  };
}
