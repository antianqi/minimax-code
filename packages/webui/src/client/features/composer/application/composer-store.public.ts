// The composer's published input commands.
//
// Archiving or deleting a session clears that session's composer draft, so the
// sessions workflow calls the purge command through the composer store's owner.
// Retained input returns through its atomic merge command. Sessions reads these
// capabilities as types, not as the whole
// store interface — other store methods are private composer state — so
// the published shape contains only the commands needed by sessions.
//
// The `.public` suffix is a publication marker.

import type { WebuiComposerAttachment, WebuiComposerUrlReference } from "../contracts/composer-interactions.js";

/** The composer's purge command: drop one slot's draft and history. */
export type WebuiComposerPurgeSlot = (key: string) => void;

export interface WebuiComposerUnsentInput {
  readonly draft: string;
  readonly attachments: readonly WebuiComposerAttachment[];
  readonly urlReferences: readonly WebuiComposerUrlReference[];
}

/** Validate and merge all input in one publication, preserving destination input. */
export type WebuiComposerMergeInput = (key: string, input: WebuiComposerUnsentInput) => void;
