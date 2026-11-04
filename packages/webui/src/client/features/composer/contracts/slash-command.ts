// The list itself is a wire vocabulary, so it lives in `shared` where the
// server's validator and the runtime's descriptors can reach it too. It is
// imported for this file's own use and re-exported so the client's existing
// import path keeps working.
import {
  WEBUI_RUN_COMMAND_NAMES,
  type WebuiRunCommandName,
} from "../../../../shared/contracts/commands.js";

export { WEBUI_RUN_COMMAND_NAMES, type WebuiRunCommandName };
export type WebuiCommandClassification =
  | "runnable"
  | "inert-wired"
  | "inert-unsupported";

export type SlashComposerMode = "goal" | "plan" | "review";
export type SlashSendIntent = "cloud-handoff" | "review";
export type SlashDirectAction = "memory" | "fork";
export type SlashPaletteSection = "special" | "skills";

export interface WebuiSlashPaletteFields extends WebuiSlashCommandFields {
  readonly displayName: string;
  readonly label: string;
  readonly description: string;
  readonly source_type: -1 | 0 | 1;
  readonly composerMode?: SlashComposerMode;
  readonly paletteSection?: SlashPaletteSection;
  readonly searchTerms?: readonly string[];
  readonly display_name?: string;
  readonly display_description?: string;
}

export function sectionWebuiSlashPalette<T extends WebuiSlashPaletteFields>(
  builtins: readonly T[],
  skills: readonly T[],
): T[] {
  const isInDefault = (entry: T): boolean =>
    entry.source_type === -1 || entry.paletteSection === "special";
  const inDefault: T[] = [];
  const inSkills: T[] = [];
  for (const skill of skills) (isInDefault(skill) ? inDefault : inSkills).push(skill);
  const taggedSkills: T[] = inSkills.map((entry) => ({
    ...entry,
    paletteSection: entry.paletteSection ?? "skills",
  }));
  return [...builtins, ...inDefault, ...taggedSkills];
}

export function applyWebuiSlashLiteMode<T extends WebuiSlashPaletteFields>(
  palette: readonly T[],
  lite: boolean,
): T[] {
  if (!lite) return [...palette];
  return palette.filter((entry) =>
    entry.source_type !== -1 || entry.composerMode === "goal" || entry.composerMode === "plan",
  );
}

export function rankWebuiSlashPalette<T extends WebuiSlashPaletteFields>(
  palette: readonly T[],
  query: string,
): T[] {
  const trimmed = query.trim();
  if (!trimmed) return [...palette];
  const needle = trimmed.toLowerCase();
  const scored: { cmd: T; rank: number; span: number; idx: number }[] = [];
  palette.forEach((entry, idx) => {
    const name = entry.name.toLowerCase();
    const display = entry.displayName.toLowerCase();
    if (name === needle || display === needle) {
      scored.push({ cmd: entry, rank: 0, span: 0, idx });
      return;
    }
    if (name.startsWith(needle) || display.startsWith(needle)) {
      scored.push({ cmd: entry, rank: 1, span: 0, idx });
      return;
    }
    if (name.includes(needle) || display.includes(needle)) {
      scored.push({ cmd: entry, rank: 2, span: 0, idx });
      return;
    }
    const haystack = [entry.name, entry.displayName, entry.label, entry.description,
      entry.display_name, entry.display_description, ...(entry.searchTerms ?? [])]
      .filter((value): value is string => Boolean(value)).join(" ").toLowerCase();
    if (haystack.includes(needle)) {
      scored.push({ cmd: entry, rank: 3, span: 0, idx });
      return;
    }
    // Fuzzy: the typed characters appear in order with gaps allowed, so a
    // shortened query ("mdl" for /model) still finds the row. Only the names a
    // row answers to are searched this way — a description is prose, and a
    // scattered hit inside one is noise rather than a match the user meant.
    // A tighter span wins, which is what keeps "/model" ahead of a row whose
    // name merely happens to contain the same letters far apart.
    const span = tightestSubsequenceSpan(
      [entry.name, entry.displayName, entry.label, entry.display_name]
        .filter((value): value is string => Boolean(value))
        .map((value) => value.toLowerCase()),
      needle,
    );
    if (span === undefined) return;
    scored.push({ cmd: entry, rank: 4, span, idx });
  });
  scored.sort(
    (left, right) =>
      left.rank - right.rank || left.span - right.span || left.idx - right.idx,
  );
  return scored.map((entry) => entry.cmd);
}

/**
 * How tightly `needle` sits inside `field` as a subsequence — the number of
 * characters skipped by the greedy walk — or `undefined` when a character is
 * missing altogether.
 */
function subsequenceSpan(field: string, needle: string): number | undefined {
  let cursor = 0;
  let first = -1;
  for (const character of needle) {
    const found = field.indexOf(character, cursor);
    if (found === -1) return undefined;
    if (first === -1) first = found;
    cursor = found + 1;
  }
  return cursor - first - 1;
}

/** The tightest span across a row's names; `undefined` when none contains it. */
function tightestSubsequenceSpan(
  fields: readonly string[],
  needle: string,
): number | undefined {
  let best: number | undefined;
  for (const field of fields) {
    const span = subsequenceSpan(field, needle);
    if (span === undefined) continue;
    if (best === undefined || span < best) best = span;
  }
  return best;
}

export interface WebuiSlashCommandFields {
  readonly name: string;
  readonly supported: boolean;
}

export function isWebuiRunnableCommand(
  entry: WebuiSlashCommandFields,
): entry is WebuiSlashCommandFields & {
  readonly name: WebuiRunCommandName;
  readonly supported: true;
} {
  return (
    entry.supported &&
    (WEBUI_RUN_COMMAND_NAMES as readonly string[]).includes(entry.name)
  );
}

export function classifyWebuiSlashCommand(
  entry: WebuiSlashCommandFields,
): WebuiCommandClassification {
  if (!entry.supported) return "inert-unsupported";
  if ((WEBUI_RUN_COMMAND_NAMES as readonly string[]).includes(entry.name))
    return "runnable";
  return "inert-wired";
}
