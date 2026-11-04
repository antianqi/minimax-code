// Reading a plugin-management row.
//
// The rows this area renders come from the harness as untyped objects, so both the catalogue and the
// dialogs it hosts read them by key with a fallback — one implementation, not one per file, since a
// shared invariant gets a single implementation.

/** A plugin-management row as the runtime sends it: an object with no declared shape. */
export type WebuiPluginRow = Record<string, unknown>;

/**
 * One agent, in the shape a field that names one needs it.
 *
 * `name` is the identity the runtime addresses (it is what a scheduled task
 * stores and what `getAgent` takes); `displayName` is what a reader sees.
 */
export interface WebuiAgentOption {
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
}

/** The first of `keys` whose value is a string, else `""`. */
export function readWebuiPluginRow(row: WebuiPluginRow, ...keys: readonly string[]): string {
  for (const key of keys) if (typeof row[key] === "string") return row[key] as string;
  return "";
}

/** Agent models may be projected directly or remain inside their definition. */
export function readWebuiAgentModel(row: WebuiPluginRow): string {
  const direct = readWebuiPluginRow(row, "model");
  if (direct) return direct;
  for (const key of ["initialDefinition", "definition", "config"] as const) {
    const nested = row[key];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const model = readWebuiPluginRow(nested as WebuiPluginRow, "model");
      if (model) return model;
    }
  }
  return "";
}
