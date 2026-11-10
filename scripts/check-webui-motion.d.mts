// Types for `scripts/check-webui-motion.mjs`, used by the motion gate test.

export interface ScannedStylesheet {
  readonly durations: readonly string[];
  readonly keyframes: readonly string[];
}

export interface MotionDurationEntry {
  readonly value: string;
  readonly family: string;
  readonly reason?: string;
}

export interface MotionKeyframeEntry {
  readonly name: string;
  readonly family: string;
  readonly reason?: string;
}

export interface AnimationAssetEntry {
  readonly owner: string;
  readonly renderer: string;
  readonly reason: string;
}

export interface MotionInventory {
  readonly tokens: Record<string, string | undefined>;
  readonly files: Record<string, { readonly durations?: readonly MotionDurationEntry[]; readonly keyframes?: readonly MotionKeyframeEntry[] }>;
  readonly animationAssets?: Record<string, AnimationAssetEntry>;
}

export function scanStylesheet(text: string): ScannedStylesheet;
export function compareMotion(
  scannedByFile: Record<string, ScannedStylesheet>,
  inventory: MotionInventory,
): string[];
export function sourceMotionOwnershipProblems(file: string, text: string): string[];
export function sharedFeedbackControlProblems(file: string, text: string): string[];
export function disabledTransitionOwnershipProblems(file: string, text: string): string[];
export function featureRotationOwnershipProblems(file: string, text: string): string[];
export function featureSmoothScrollOwnershipProblems(file: string, text: string): string[];
export function featureInteractionTransformOwnershipProblems(file: string, text: string): string[];
export function scanClient(root?: string): Promise<Record<string, ScannedStylesheet>>;
export function checkMotionOwnership(
  inventory: MotionInventory,
  enumerate?: (pattern: string, options: { cwd: string }) => AsyncIterable<string>,
): Promise<{ problems: string[]; approvedStylesheets: number; rawUtilityClasses: number }>;
