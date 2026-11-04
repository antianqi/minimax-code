// The composer-facing plugin catalogue, published.
//
// Two other businesses need to type-check the catalogue: the composer lists
// installed plugins and runtime skills through it, and the composer's `+` menu
// receives the installed-plugin rows. Neither business owns the concept, so
// neither may re-derive the shape, and the types live here where the plugins
// business can keep changing them. The creator and the runtime cache stay
// private to this business; a peer reads the catalogue, it does not build one.
//
// The `.public` suffix changes nothing about what the module is — the classifier
// strips it, so this is still `application/`, still the plugins business's
// catalogue shape.

/** One installed plugin, as the composer's `@` menu needs it. */
export interface WebuiComposerPluginSummary {
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
}

/**
 * The read model the composer mounts: the installed-plugin list the `@` menu
 * offers, the runtime skills the slash palette and the skills submenu render
 * from, and the invalidate hooks the assembly calls off a plugin write.
 */
export interface WebuiComposerPluginCatalogue {
  /** False when the runtime exposes no plugin management at all. */
  readonly available: boolean;
  /**
   * The installed plugins the `@` menu offers. Cached per key, so reopening the
   * menu does not re-ask the runtime for the same answer.
   */
  readonly installedPlugins: () => Promise<readonly WebuiComposerPluginSummary[]>;
  /**
   * The runtime skills the slash palette and the skills submenu render from.
   *
   * This is the runtime ROSTER — the skills the agent can actually run — and
   * not the management catalogue. The two are different lists in the runtime:
   * the roster is what a turn can load (it carries the plugin skills and the
   * workspace's own skills), while the management catalogue is the paged,
   * user-facing list of what is installed. The slash palette shows the roster,
   * the way the Desktop palette does.
   *
   * The scope is the roster's own: the agent names which roster is read, and
   * the session names the workspace the roster is read for, because the
   * runtime resolves a session's working directory from the session itself.
   */
  readonly runtimeSkills: (
    scope?: WebuiComposerSkillScope,
  ) => Promise<readonly WebuiComposerSkillSummary[]>;
  /**
   * A skill write can change any session's roster, so every skill slot goes.
   *
   * The roster a session shows is the roster of the agent that session runs,
   * and the catalogue cannot tell which agent that is: the runtime resolves it
   * from the session, so a slot holds a session's roster without naming the
   * agent behind it. A write aimed at one agent therefore cannot be told
   * apart from a write aimed at another.
   */
  readonly invalidateSkills: () => void;
  /**
   * The installed-plugin read is stale. Every slot goes, because a plugin write
   * can add, remove, rename or reconfigure any of them.
   */
  readonly invalidatePlugins: () => void;
}

/**
 * What a roster read is scoped by.
 *
 * The session names the roster: the runtime resolves that session's agent and
 * its working directory from the session itself, so a read that named an agent
 * could only contradict it — and a name that is not an agent the runtime knows
 * (the shell's placeholder for "no session" is one) makes the runtime answer
 * with an empty roster. The workspace may also be given on its own, for a read
 * that has no session yet (the home composer).
 */
export interface WebuiComposerSkillScope {
  readonly sessionId?: string;
  readonly workspaceDir?: string;
}

/** One runtime skill, as the slash palette and the skills submenu need it. */
export interface WebuiComposerSkillSummary {
  readonly name: string;
  readonly displayName?: string;
  readonly description?: string;
  /** False when the skill is turned off. A turned-off skill is not offered. */
  readonly enabled?: boolean;
  /** The runtime's own kind: "user", "global", "builtin-…", "plugin". */
  readonly sourceKind?: string;
  /** The runtime's own source type. 1 is built in, 2 is the user's own. */
  readonly sourceType?: number;
}