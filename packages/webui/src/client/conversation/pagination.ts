export interface WebuiCursorPage<T> {
  readonly items: readonly T[];
  readonly hasMore?: boolean;
  readonly nextCursor?: unknown;
  readonly cursorResetRequired?: boolean;
}

/** Acquire a complete snapshot, refusing a continuation that cannot make progress. */
export async function collectWebuiPages<T>(
  read: (cursor: string | undefined) => Promise<WebuiCursorPage<T>>,
  options: { readonly label: string; readonly isCurrent?: () => boolean },
): Promise<readonly T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    if (options.isCurrent?.() === false) throw new Error(`${options.label} read superseded`);
    const page = await read(cursor);
    if (options.isCurrent?.() === false) throw new Error(`${options.label} read superseded`);
    if (page.cursorResetRequired === true) throw new Error(`${options.label} cursor expired; refresh the catalogue`);
    items.push(...page.items);
    if (page.hasMore !== true) return items;
    const next = page.nextCursor;
    if (typeof next !== "string" || !next || seen.has(next)) {
      throw new Error(`${options.label} returned an invalid cursor`);
    }
    seen.add(next);
    cursor = next;
  }
}
