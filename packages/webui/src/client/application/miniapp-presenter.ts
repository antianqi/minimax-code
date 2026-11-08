import type { WebuiMiniAppPresentationIntent } from "../../shared/contracts/miniapp.js";

/** Sequences host intents; browser navigation and workspace presentation stay bound by the shell. */
export function createWebuiMiniAppPresenterCoordinator(deps: {
  readonly watch: (listener: (intent: WebuiMiniAppPresentationIntent) => void) => () => void;
  readonly awaitSelection: (sessionId: string) => Promise<boolean>;
  readonly selected: () => string | undefined;
  readonly open: (pluginId: string, path?: string) => Promise<boolean>;
}): {
  readonly bind: (binding: {
    readonly select: (sessionId: string) => void;
    readonly isOpen: (sessionId: string, pluginId: string) => boolean;
    readonly show: (sessionId: string, pluginId: string) => void;
    readonly close: (sessionId: string, pluginId: string) => void;
    readonly onFailure?: (error: unknown) => void;
  }) => () => void;
  readonly dispose: () => void;
} {
  let epoch: string | undefined;
  let revision = 0;
  let task = 0;
  let bindingRevision = 0;
  let disposed = false;
  let release: (() => void) | undefined;
  const stop = (): void => {
    bindingRevision += 1;
    task += 1;
    const previous = release;
    release = undefined;
    previous?.();
  };
  return {
    bind: (binding) => {
      if (disposed) return () => undefined;
      stop();
      const bindingToken = bindingRevision;
      release = deps.watch((intent) => {
        if (disposed || bindingToken !== bindingRevision) return;
        if (epoch !== intent.epoch) {
          epoch = intent.epoch;
          revision = 0;
        }
        if (intent.revision <= revision) return;
        revision = intent.revision;
        const token = ++task;
        const isCurrent = (): boolean => !disposed && token === task && deps.selected() === intent.sessionId;
        if (intent.action === "close") {
          binding.close(intent.sessionId, intent.pluginId);
          return;
        }
        binding.select(intent.sessionId);
        void (async () => {
          if (!(await deps.awaitSelection(intent.sessionId)) || !isCurrent()) return;
          const opened = binding.isOpen(intent.sessionId, intent.pluginId) ||
            await deps.open(intent.pluginId, intent.path);
          if (opened && isCurrent()) binding.show(intent.sessionId, intent.pluginId);
        })().catch((error: unknown) => {
          if (isCurrent()) binding.onFailure?.(error);
        });
      });
      const ownRelease = release;
      return () => { if (release === ownRelease && bindingToken === bindingRevision) stop(); };
    },
    dispose: () => {
      disposed = true;
      stop();
    },
  };
}
