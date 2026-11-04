// What a turn showed while it was live, and whether the persisted page has
// caught up with it.
//
// A settled turn is rendered from the persisted page, and that page can arrive
// mid-write: the reply's text is stored first, the files it delivered are added
// afterwards. Checking that the message *exists* is therefore not enough — the
// reader watched those files appear, and a page that only has the text takes
// them away again. These two functions decide "caught up" by what the message
// projects to, which is the same projection the transcript draws.
import { projectMessageParts, type WebuiMessageForParts } from "./message-parts.js";

/** The part of a message a settle comparison cares about. */
export interface WebuiSettledTurnShape {
  readonly msgId: string;
  /** Characters of prose, after the renderer-only markup is lifted out. */
  readonly textLength: number;
  /** How many delivered files the message names, pictures and clips included. */
  readonly assets: number;
}

function shapeOf(message: WebuiMessageForParts): WebuiSettledTurnShape {
  const projected = projectMessageParts(message);
  let textLength = 0;
  let assets = 0;
  for (const part of projected) {
    if (part.type === "text") textLength += part.content.length;
    else if (part.type === "asset_list") assets += part.assets.length;
  }
  return { msgId: message.msgId, textLength, assets };
}

/** The shape of one message as the live view draws it. */
export function projectWebuiSettledTurnShape(message: WebuiMessageForParts): WebuiSettledTurnShape {
  return shapeOf(message);
}

/**
 * Whether every message the live turn showed is on the page, with at least as
 * much prose and as many delivered files as the reader already saw.
 *
 * Only "at least as much" is required: a later read may carry more, and a page
 * that carries less is the mid-write state that takes the files away.
 */
export function isWebuiSettledTurnCaughtUp(
  expected: readonly WebuiSettledTurnShape[],
  pageMessages: readonly WebuiMessageForParts[],
): boolean {
  if (expected.length === 0) return true;
  const byId = new Map(pageMessages.map((message) => [message.msgId, message]));
  return expected.every((want) => {
    const found = byId.get(want.msgId);
    if (!found) return false;
    const have = shapeOf(found);
    return have.textLength >= want.textLength && have.assets >= want.assets;
  });
}
