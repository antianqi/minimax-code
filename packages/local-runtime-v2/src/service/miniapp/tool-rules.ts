// The Host's rules, as a page's tool call meets them.
//
// A page is not a turn: it has no session to scope a rule to, so only the global rules
// and the global mode decide. This adapter is the one place that reads them, so "what a
// page may do" and "what a turn may do" cannot come to mean two different things — a
// rule written by one is read by the other.
//
// Four properties, each a decision:
//
//   * **`off` allows everything a rule does not deny.** The mode means "do not ask", not
//     "ignore the rules"; a deny survives it.
//   * **`bypassPermissions` turns an `ask` into an `allow`, and nothing else.** Same
//     ceiling as the Agent path: a deny is still a deny.
//   * **A snapshot is one read.** `list()` and `request()` judge many tools against one
//     rule generation; a per-tool read would mix two moments into one listing.
//   * **`allowAlways` writes the global allow rule.** The same rule the Agent path reads,
//     so approving once here stops the prompt on a later turn.
//
// Which store those rules live in is the Host's business: this port names the three
// reads it needs and nothing about where they come from.

import { homedir } from "node:os";

import {
  createToolPermissionContext,
  PermissionEngine,
  type PermissionRule,
} from '@mavis/permission';

import type {
  MiniAppToolRulePort,
  MiniAppToolRuleSnapshot,
  MiniAppToolRuleVerdict,
} from './tool-permission.js';

/** The modes the Host stores, in the order the Agent path names them. */
const PERMISSION_MODES = ['default', 'acceptEdits', 'bypassPermissions', 'auto', 'off'] as const;

type StoredPermissionMode = (typeof PERMISSION_MODES)[number];

/** What this adapter needs from the Host: a mode, a data dir, and the global rules. */
export interface MiniAppToolRuleSource {
  /** The stored mode, unread: an unknown value counts as `auto`, as on the Agent path. */
  readPermissionMode(): string | undefined;
  /** The Host's data dir: path arguments outside it ask, as outside a workspace. */
  readDataDir(): string;
  /** Which policy owns the decision; the Agent path passes its own. */
  readPolicyOwner?(): 'engine' | 'core';
  /** The global rules, read per snapshot. */
  listGlobalRules(): Promise<readonly PermissionRule[]>;
  /** Writes one global allow rule. A failure costs a future prompt, not this call. */
  addGlobalAllowRule(name: string): Promise<void> | void;
}

export function createMiniAppToolRulePort(source: MiniAppToolRuleSource): MiniAppToolRulePort {
  const engine = new PermissionEngine();

  const snapshot = async (): Promise<MiniAppToolRuleSnapshot> => {
    const mode = readPermissionMode(source.readPermissionMode());
    // `off` is "never ask", which is every tool allowed except where a rule denies.
    if (mode === 'off') return { check: () => 'allow' };
    const dataDir = source.readDataDir();
    const context = createToolPermissionContext({
      // `acceptEdits` is an alias for `default` with seeded allow rules; the engine must
      // never see it, as on the Agent path.
      mode: mode === 'acceptEdits' ? 'default' : mode,
      rules: [...(await source.listGlobalRules())],
      // No workspace for a page: the data dir is the nearest thing, and an argument
      // outside it asks, exactly as an argument outside a workspace does.
      workingDirectory: dataDir,
      dataDir,
      homeDir: homedir(),
    });
    const policyOwner = source.readPolicyOwner?.() ?? 'engine';
    return {
      check(name, input): MiniAppToolRuleVerdict {
        const decision = engine.checkPermission(
          name,
          asRecord(input),
          context,
          { policyOwner },
        );
        if (decision.behavior === 'ask' && mode === 'bypassPermissions') return 'allow';
        return decision.behavior;
      },
    };
  };

  return {
    snapshot,
    allowAlways: (name) => source.addGlobalAllowRule(name),
  };
}

function readPermissionMode(value: string | undefined): StoredPermissionMode {
  // As the Agent path reads it: an unknown stored mode counts as `auto`.
  return PERMISSION_MODES.find((mode) => mode === value) ?? 'auto';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
