// The rules an Agent turn would apply, applied to a page's tool call instead.
//
// A Mini App's page is not a turn: there is no session to scope a rule to and no
// turn owner to ask. So this file takes the same rule engine's verdict — `allow` /
// `ask` / `deny` — through a port the Host implements, and routes `ask` to a prompt
// that belongs to the Mini App view.
//
// Three fallbacks decide the shape of everything here, and all three fail closed:
//
//   * **No rule port** — the Host cannot state a rule, so every tool is `ask`. It is
//     not "unrestricted"; it is "nobody has allowed this yet".
//   * **A rule store that throws** — also `ask`. A broken store must not read as
//     permission.
//   * **`ask` with nobody to ask** — the call is refused with
//     `TOOL_APPROVAL_REQUIRED`, never dispatched.
//
// The one answer that outlives the call is `allowAlways`: it writes the same global
// allow rule the Agent path reads, so approving once here also stops the prompt on a
// later Agent turn. A failed write costs a future prompt, not the current call.

import { MiniAppToolError } from './contracts.js';

/** What the rules say about one tool, as the Mini App path reads them. */
export type MiniAppToolRuleVerdict = 'allow' | 'ask' | 'deny';

/** The tool a call targets. `builtin` tools are the Host's own and never ask. */
export interface MiniAppToolTarget {
  readonly name: string;
  readonly builtin?: boolean;
  /** Present when the target came from a connector, for the prompt's wording. */
  readonly kind?: string;
  readonly owner?: string;
  readonly tool?: string;
}

/** One read of the rules, judged per tool. `check` must not outlive the snapshot. */
export interface MiniAppToolRuleSnapshot {
  check(name: string, input: unknown): MiniAppToolRuleVerdict;
}

/**
 * The Host's rules, as far as a Mini App can reach them: global rules and the global
 * mode only, never a turn's scope.
 */
export interface MiniAppToolRulePort {
  snapshot(): Promise<MiniAppToolRuleSnapshot>;
  /** Writes the global allow rule. Rejects when the store cannot be written. */
  allowAlways(name: string): Promise<void> | void;
}

export interface MiniAppToolApprovalItem {
  readonly name: string;
  readonly kind?: string;
  readonly owner?: string;
  readonly tool?: string;
  readonly argumentsPreview?: string;
}

export interface MiniAppToolApprovalRequest {
  /** `call` asks about one dispatching call; `request` asks which tools to allow. */
  readonly mode: 'call' | 'request';
  readonly pluginId: string;
  readonly tools: readonly MiniAppToolApprovalItem[];
  readonly signal?: AbortSignal;
}

export type MiniAppToolApprovalDecision = 'allow' | 'deny' | 'allowAlways';

export interface MiniAppToolApprovalAnswer {
  readonly decision: MiniAppToolApprovalDecision;
  /** The tools ticked in a `request` prompt. */
  readonly names?: readonly string[];
}

/** `unavailable` is "nobody could answer", which is not the same as a refusal. */
export type MiniAppToolApprovalOutcome = MiniAppToolApprovalAnswer | 'unavailable';

export interface MiniAppToolApprovalPort {
  request(input: MiniAppToolApprovalRequest): Promise<MiniAppToolApprovalOutcome>;
}

export interface MiniAppToolPermissionPorts {
  readonly permissions?: MiniAppToolRulePort;
  readonly approvals?: MiniAppToolApprovalPort;
}

export interface MiniAppToolJudgement {
  /** The rule as it stood before the prompt, for the Host's audit record. */
  rule: MiniAppToolRuleVerdict | 'builtin';
  decision?: MiniAppToolApprovalDecision;
  /** True when `allowAlways` could not be written. The call still proceeds. */
  ruleWriteFailed?: boolean;
}

export interface JudgeMiniAppToolCallInput {
  readonly pluginId: string;
  readonly target: MiniAppToolTarget;
  readonly arguments: unknown;
  readonly signal?: AbortSignal;
}

const ARGUMENTS_PREVIEW_MAX_CHARS = 2_000;

/**
 * One call's permission step: the rules decide, `ask` goes to the Mini App prompt.
 *
 * Throws a `not_dispatched` `MiniAppToolError` when the call may not run, so the
 * caller can answer the page without wondering whether anything reached the tool.
 */
export async function judgeMiniAppToolCall(
  ports: MiniAppToolPermissionPorts,
  input: JudgeMiniAppToolCallInput,
): Promise<MiniAppToolJudgement> {
  const rule = await currentMiniAppToolRule(input.target, ports.permissions, input.arguments);
  if (input.target.builtin === true) return { rule: 'builtin' };
  if (rule === 'allow') return { rule };
  if (rule === 'deny') throw new MiniAppToolError('TOOL_NOT_PERMITTED');

  const answer = ports.approvals
    ? await ports.approvals.request({
        mode: 'call',
        pluginId: input.pluginId,
        tools: [{ ...promptItem(input.target), argumentsPreview: previewArguments(input.arguments) }],
        ...(input.signal ? { signal: input.signal } : {}),
      })
    : 'unavailable';
  if (answer === 'unavailable') throw new MiniAppToolError('TOOL_APPROVAL_REQUIRED');
  if (answer.decision === 'deny') throw new MiniAppToolError('TOOL_NOT_PERMITTED');

  const judgement: MiniAppToolJudgement = { rule, decision: answer.decision };
  if (answer.decision === 'allowAlways') {
    judgement.ruleWriteFailed = !(await rememberAllow(ports.permissions, input.target.name));
  }
  return judgement;
}

/**
 * `list()` and `request()`: the verdict for every tool, judged against one read.
 *
 * One read because a listing of twenty tools should not mean twenty reads of the same
 * rule file, and because a listing that showed two different rule generations would be
 * a listing of two different moments.
 */
export async function currentMiniAppToolRules(
  targets: readonly MiniAppToolTarget[],
  permissions: MiniAppToolRulePort | undefined,
): Promise<readonly MiniAppToolRuleVerdict[]> {
  const needsRules = targets.some((target) => target.builtin !== true);
  const snapshot = needsRules ? await readRuleSnapshot(permissions) : undefined;
  return targets.map((target) => {
    if (target.builtin === true) return 'allow';
    if (!snapshot) return 'ask';
    try {
      return snapshot.check(target.name, {});
    } catch {
      return 'ask';
    }
  });
}

export interface RequestMiniAppToolPermissionsInput {
  readonly pluginId: string;
  readonly targets: readonly MiniAppToolTarget[];
  readonly signal?: AbortSignal;
}

export interface MiniAppToolPermissionOutcome {
  readonly permissions: Readonly<Record<string, MiniAppToolRuleVerdict>>;
  /** True when the person could not be asked: the page has to try again later. */
  readonly approvalRequired: boolean;
}

/**
 * Ask about the tools whose rule is still `ask`; the ones already allowed or denied
 * stay out of the prompt.
 *
 * The answer is the state of every target afterwards, re-read rather than assumed: a
 * write that failed leaves the tool as it was, and the page should see that.
 */
export async function requestMiniAppToolPermissions(
  ports: MiniAppToolPermissionPorts,
  input: RequestMiniAppToolPermissionsInput,
): Promise<MiniAppToolPermissionOutcome> {
  const before = await currentRules(input.targets, ports.permissions);
  const pending = input.targets.filter((target) => before[target.name] === 'ask');
  if (pending.length === 0) return { permissions: before, approvalRequired: false };

  const answer = ports.approvals
    ? await ports.approvals.request({
        mode: 'request',
        pluginId: input.pluginId,
        tools: pending.map(promptItem),
        ...(input.signal ? { signal: input.signal } : {}),
      })
    : 'unavailable';
  if (answer === 'unavailable') return { permissions: before, approvalRequired: true };
  if (answer.decision !== 'allowAlways') return { permissions: before, approvalRequired: false };

  const ticked = new Set(answer.names ?? []);
  for (const target of pending) {
    if (ticked.has(target.name)) await rememberAllow(ports.permissions, target.name);
  }
  return {
    permissions: await currentRules(input.targets, ports.permissions),
    approvalRequired: false,
  };
}

/**
 * The rule a call to `target` meets now. Builtin tools never ask; without a rule port
 * every call is `ask`; a store that cannot be read is `ask` too.
 */
async function currentMiniAppToolRule(
  target: MiniAppToolTarget,
  permissions: MiniAppToolRulePort | undefined,
  input: unknown,
): Promise<MiniAppToolRuleVerdict> {
  if (target.builtin === true) return 'allow';
  if (!permissions) return 'ask';
  try {
    const snapshot = await permissions.snapshot();
    return snapshot.check(target.name, input);
  } catch {
    return 'ask';
  }
}

async function readRuleSnapshot(
  permissions: MiniAppToolRulePort | undefined,
): Promise<MiniAppToolRuleSnapshot | undefined> {
  try {
    return await permissions?.snapshot();
  } catch {
    return undefined;
  }
}

async function currentRules(
  targets: readonly MiniAppToolTarget[],
  permissions: MiniAppToolRulePort | undefined,
): Promise<Readonly<Record<string, MiniAppToolRuleVerdict>>> {
  const verdicts = await currentMiniAppToolRules(targets, permissions);
  return Object.fromEntries(targets.map((target, index) => [target.name, verdicts[index] ?? 'ask']));
}

/** A failed rule write only costs a future prompt; the person's answer still holds. */
async function rememberAllow(
  permissions: MiniAppToolRulePort | undefined,
  name: string,
): Promise<boolean> {
  try {
    await permissions?.allowAlways(name);
    return permissions !== undefined;
  } catch {
    return false;
  }
}

function promptItem(target: MiniAppToolTarget): MiniAppToolApprovalItem {
  return {
    name: target.name,
    ...(target.kind !== undefined ? { kind: target.kind } : {}),
    ...(target.owner !== undefined ? { owner: target.owner } : {}),
    ...(target.tool !== undefined ? { tool: target.tool } : {}),
  };
}

/** Arguments reach the prompt as text, bounded: a preview, never the record. */
function previewArguments(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value, null, 2) ?? '{}';
  } catch {
    json = '{}';
  }
  return json.length > ARGUMENTS_PREVIEW_MAX_CHARS
    ? `${json.slice(0, ARGUMENTS_PREVIEW_MAX_CHARS)}…`
    : json;
}
