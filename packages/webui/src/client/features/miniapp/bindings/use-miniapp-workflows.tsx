// The Mini App business's binding: one provider, two hooks.
//
// The owner is built once by the composition root (`application/create-application.ts`)
// and provided here, so a surface submits commands and reads the snapshot rather
// than constructing a second owner. With no provider mounted — SSR, a unit test
// that mounts the view on its own — the hooks read the initial snapshot and the
// component renders "no Mini App capability", which is the same thing a host
// without the cell does.

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";

import {
  initialWebuiMiniAppWorkflowsState,
  type WebuiMiniAppWorkflows,
  type WebuiMiniAppWorkflowsState,
} from "../application/miniapp-workflows.js";

const WebuiMiniAppWorkflowsContext = createContext<WebuiMiniAppWorkflows | undefined>(undefined);

export function WebuiMiniAppWorkflowsProvider({
  workflows,
  children,
}: {
  readonly workflows: WebuiMiniAppWorkflows;
  readonly children: ReactNode;
}): JSX.Element {
  const { dom } = useWebuiBrowserCapabilities();
  useEffect(() => {
    const update = (): void => workflows.setSuspended(dom.isPageHidden());
    const refresh = (): void => {
      update();
      if (!dom.isPageHidden()) workflows.refreshInterested();
    };
    update();
    const release = dom.listenForVisibilityChange(refresh);
    window.addEventListener("focus", refresh);
    return () => {
      release();
      window.removeEventListener("focus", refresh);
    };
  }, [dom, workflows]);
  return (
    <WebuiMiniAppWorkflowsContext.Provider value={workflows}>
      {children}
    </WebuiMiniAppWorkflowsContext.Provider>
  );
}

export function useWebuiMiniAppListingInterest(kind: "launcher" | "catalogue", active = true): void {
  const workflows = useWebuiMiniAppWorkflows();
  useEffect(() => active ? workflows?.acquireListing(kind) : undefined, [active, kind, workflows]);
}

/** The owner, for a component that submits commands. */
export function useWebuiMiniAppWorkflows(): WebuiMiniAppWorkflows | undefined {
  return useContext(WebuiMiniAppWorkflowsContext);
}

const noopSubscribe = (): (() => void) => () => undefined;

function initialSnapshot(): WebuiMiniAppWorkflowsState {
  return initialWebuiMiniAppWorkflowsState;
}

/** The snapshot, for a component that renders it. */
export function useWebuiMiniAppWorkflowsState(): WebuiMiniAppWorkflowsState {
  const workflows = useContext(WebuiMiniAppWorkflowsContext);
  return useSyncExternalStore(
    workflows ? workflows.subscribe : noopSubscribe,
    workflows ? workflows.getSnapshot : initialSnapshot,
    workflows ? workflows.getSnapshot : initialSnapshot,
  );
}
