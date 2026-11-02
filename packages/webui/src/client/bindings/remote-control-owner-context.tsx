// The remote-control owner's binding.
//
// One owner, two homes: the 远程 page's 远程控制 tab and the connection settings' device
// list. A context keeps it one instance — a second owner over the same slice would be a
// second authority for the same link, and the two surfaces would then disagree about whether
// a phone is on the line.
import { createContext, useContext, type ReactNode } from "react";

import type { WebuiRemoteControlOwner } from "../features/remote-control/application/remote-control-owner.js";

const RemoteControlOwnerContext = createContext<WebuiRemoteControlOwner | null>(null);

export function WebuiRemoteControlOwnerProvider({
  owner,
  children,
}: {
  readonly owner: WebuiRemoteControlOwner;
  readonly children: ReactNode;
}) {
  return <RemoteControlOwnerContext.Provider value={owner}>{children}</RemoteControlOwnerContext.Provider>;
}

/**
 * The remote-control owner, or `null` where no host has been wired.
 *
 * `null` means "this surface has no phone link", not "no phone is linked" — the list says so
 * itself rather than rendering an empty device list.
 */
export function useWebuiRemoteControlOwner(): WebuiRemoteControlOwner | null {
  return useContext(RemoteControlOwnerContext);
}
