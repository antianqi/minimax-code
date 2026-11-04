// The Mini App launcher and picker opened from the primary navigation rail.
//
// Same listing as the plugin catalogue's apps area — one owner, one read — so a
// row here and a row there cannot disagree about what is running. The picker's own
// job is small: show the rows with their state, start the one that was chosen, and
// name the running ones when the runtime refuses a fourth.
//
// It opens the view by asking its owner to start the Mini App and then telling the
// workspace which tab to open. That direction is ADR 0020's: the business issues
// the workspace panel's own command, it never reaches into the panel's state.

import { createPortal } from "react-dom";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { IconX } from "@tabler/icons-react";

import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import {
  useWebuiMiniAppWorkflows,
  useWebuiMiniAppWorkflowsState,
} from "../bindings/use-miniapp-workflows.js";
import {
  webuiMiniAppCapacityText,
  webuiMiniAppFailureCodeText,
  webuiMiniAppRefusalText,
  webuiMiniAppRunningRows,
} from "../projection/miniapp-view.js";
import { WebuiIconApps, WebuiIconChevronRight, WebuiIconSites } from "../../../shell/icons.js";
import { FeedbackLiveRegion } from "../../../ui/feedback.js";
import { useWebuiToastError } from "../../../ui/toast.js";
import { WebuiMotion, WebuiPage, WebuiSkeleton } from "../../../ui/page.js";
import { WebuiButton } from "../../../ui/button.js";
import {
  PluginRow,
  PluginRowActions,
  PluginRowCopy,
  PluginRowIcon,
  PluginRowList,
} from "../../plugins/ui/PluginRow.public.js";

import { FeedbackEmpty } from "../../../ui/feedback.js";
import { WebuiIconButton } from "../../../ui/button.js";
import { webuiMiniAppWindowName } from "../projection/miniapp-view.js";

/** Icon-card launcher opened from the primary navigation rail. */
export function MiniAppLauncher({ sessionId }: { readonly sessionId?: string }): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ left: 16, top: 16 });
  const triggerRef = useRef<HTMLSpanElement>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const workflows = useWebuiMiniAppWorkflows();
  const state = useWebuiMiniAppWorkflowsState();
  const { dom } = useWebuiBrowserCapabilities();
  const rows = state.listing.rows;
  const portalTarget = dom.portalTarget();

  const placeSurface = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    const surface = surfaceRef.current;
    if (!trigger || !surface) return;
    const width = surface.offsetWidth;
    const height = surface.offsetHeight;
    const gap = 14;
    const margin = 16;
    const rightSide = trigger.right + gap;
    const left = rightSide + width <= window.innerWidth - margin
      ? rightSide
      : Math.max(margin, trigger.left - gap - width);
    const top = Math.max(margin, Math.min(trigger.top, window.innerHeight - height - margin));
    setPosition({ left, top });
  }, []);

  const setSurfaceRef = useCallback((surface: HTMLElement | null) => {
    surfaceRef.current = surface;
    if (surface) window.requestAnimationFrame(placeSurface);
  }, [placeSurface]);

  useEffect(() => {
    if (!open) return;
    void workflows?.loadListing();
  }, [open, workflows]);

  useLayoutEffect(() => {
    if (!open) return;
    placeSurface();
    window.addEventListener("resize", placeSurface);
    window.addEventListener("scroll", placeSurface, true);
    return () => {
      window.removeEventListener("resize", placeSurface);
      window.removeEventListener("scroll", placeSurface, true);
    };
  }, [open, placeSurface, rows.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || surfaceRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.querySelector("button")?.focus();
    };
    // The listeners come from the injected platform, so a host without an
    // ambient `document` still dismisses the picker.
    const stopPointer = dom.listenForPointerDown(onPointerDown);
    const stopKey = dom.listenForKeyDown(onKeyDown);
    return () => {
      stopPointer();
      stopKey();
    };
  }, [open, dom]);

  const iconSource = (iconUrl: string | undefined): string | undefined => {
    if (!iconUrl) return undefined;
    try {
      const url = new URL(iconUrl, window.location.origin);
      if (url.pathname !== "/mavis/api/file/preview") return iconUrl;
      const token = (window as Window & { __WEBUI_CONFIG__?: { token?: string } }).__WEBUI_CONFIG__?.token;
      if (!token) return undefined;
      const iconPath = url.searchParams.get("path");
      if (!iconPath) return undefined;
      const separator = Math.max(iconPath.lastIndexOf("/"), iconPath.lastIndexOf("\\"));
      const filename = iconPath.slice(separator + 1);
      if (separator < 0 || !filename) return undefined;
      const directory = separator === 0
        ? iconPath.slice(0, 1)
        : separator === 2 && iconPath[1] === ":"
          ? iconPath.slice(0, separator + 1)
          : iconPath.slice(0, separator);
      const icon = new URL("/workspace-file", window.location.origin);
      icon.searchParams.set("token", token);
      icon.searchParams.set("dir", directory);
      icon.searchParams.set("path", filename);
      return `${icon.pathname}${icon.search}`;
    } catch {
      return undefined;
    }
  };

  const launcher = portalTarget ? createPortal(
    <WebuiPage
      as="section"
      kind="panel"
      present={open}
      motion={{ kind: "surface", state: "enter", direction: "none" }}
      ref={setSurfaceRef}
      className="webui-miniapp-launcher-popover"
      id="miniapp-launcher-popover"
      aria-label="应用"
      data-testid="miniapp-launcher"
      style={position}
    >
      <header className="webui-miniapp-launcher-heading">
        <div>
          <h2>应用</h2>
          <span>全部应用</span>
        </div>
        <WebuiIconButton
          tone="bare"
          size="compact"
          label="关闭应用面板"
          title="关闭"
          onClick={() => setOpen(false)}
        ><IconX /></WebuiIconButton>
      </header>
      {state.unavailable ? <FeedbackEmpty title={state.unavailable} /> : null}
      {!state.unavailable && state.listing.loading && rows.length === 0 ? <FeedbackLiveRegion screenReaderOnly testId="miniapp-launcher-loading-status">正在加载应用…</FeedbackLiveRegion> : null}
      {!state.unavailable && !state.listing.loading && rows.length === 0 ? <FeedbackEmpty title="暂无已安装的 Mini App" /> : null}
      <div className="webui-miniapp-launcher-grid">
        {state.listing.loading && rows.length === 0 ? Array.from({ length: 6 }, (_, index) => <div className="webui-miniapp-launcher-loading-card" key={`loading-${index}`} aria-hidden="true">
          <WebuiSkeleton variant="text" width="56%" />
          <WebuiSkeleton variant="shape" className="webui-miniapp-launcher-loading-icon" testId="miniapp-launcher-loading-skeleton" />
          <WebuiSkeleton variant="text" width="82%" />
          <WebuiSkeleton variant="text" width="44%" />
        </div>) : null}
        {rows.map((row) => {
          const running = row.enabled && row.status === "running";
          const launchable = row.enabled && !running && row.status !== "starting" && row.status !== "stopping" && Boolean(sessionId);
          const launch = () => {
            if (!sessionId || !launchable) return;
            const href = workflows?.standaloneUrl({ pluginId: row.pluginId, sessionId });
            if (href) window.open(href, webuiMiniAppWindowName(row.pluginId));
          };
          const src = iconSource(row.iconUrl);
          const content = <>
            <span className="webui-miniapp-launcher-card-heading">
              <span className="webui-miniapp-launcher-name">{row.name}</span>
            </span>
            <span className="webui-miniapp-launcher-preview" data-testid={`miniapp-launcher-preview-${row.pluginId}`} aria-label={`${row.name}图标`}>
              {src ? <WebuiMotion as="div" kind="card" hoverable motionRole="icon" className="webui-miniapp-launcher-preview-motion">
                <img className="webui-miniapp-launcher-preview-mark" data-testid={`miniapp-launcher-icon-${row.pluginId}`} src={src} alt="" aria-hidden="true" onError={(event) => { event.currentTarget.hidden = true; }} />
              </WebuiMotion> : <WebuiIconApps />}
            </span>
            <span className="webui-miniapp-launcher-preview-copy">{row.description || row.pluginId}</span>
            <span className="webui-miniapp-launcher-status" data-status={row.status}>
              <span className="webui-miniapp-launcher-status-dot" aria-hidden="true" />{row.statusLabel}
            </span>
          </>;
          return <div
            className={`webui-miniapp-launcher-card${running ? " is-running" : ""}`}
            key={row.pluginId}
            data-testid={`miniapp-launcher-card-${row.pluginId}`}
            data-status={row.status}
            aria-disabled={!launchable && !running ? "true" : undefined}
          >
            {launchable ? <button className="webui-miniapp-launcher-open" type="button" onClick={launch} aria-label={`打开${row.name}`}>
              {content}
            </button> : <div className="webui-miniapp-launcher-face" aria-label={`${row.name}，${row.statusLabel}`}>
              {content}
            </div>}
            {running ? <WebuiIconButton
              className="webui-miniapp-launcher-stop"
              tone="bare"
              size="compact"
              label={`关闭${row.name}`}
              title={`关闭${row.name}`}
              data-testid={`miniapp-launcher-stop-${row.pluginId}`}
              onClick={() => void workflows?.stop(row.pluginId)}
            ><IconX /></WebuiIconButton> : null}
          </div>;
        })}
      </div>
      {!sessionId && rows.length > 0 ? <p className="webui-miniapp-launcher-hint">选择一个任务后即可打开应用</p> : null}
    </WebuiPage>,
    portalTarget,
  ) : null;

  return <>
    <span className="webui-miniapp-launcher-trigger" ref={triggerRef}>
    <WebuiButton
      variant="selectable-row"
      size="regular"
      className="webui-nav-item h-8 w-full pl-2 pr-2.5 text-sm font-normal"
      data-webui-nav-item="应用"
      data-webui-nav-active={open ? "true" : "false"}
      aria-current={open ? "page" : undefined}
      aria-expanded={open}
      aria-controls="miniapp-launcher-popover"
      onClick={() => setOpen((value) => !value)}
    >
      <span className="flex flex-shrink-0 items-center justify-center"><WebuiIconApps /></span>
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">应用</span>
    </WebuiButton>
    </span>
    {launcher}
  </>;
}

/**
 * A start this row's Mini App refused.
 *
 * The refusal is a fact about the row; the client says it once instead of
 * drawing it in the row, so each refused row needs its own notice.
 */
function MiniAppPickerRefusal({
  pluginId,
  text,
}: {
  readonly pluginId: string;
  readonly text: string;
}): null {
  useWebuiToastError(text, { testId: `miniapp-picker-refusal-${pluginId}` });
  return null;
}

export interface MiniAppPickerProps {
  /** The session the chosen Mini App's view belongs to. */
  readonly sessionId?: string;
  /** Called once a Mini App is started, with the plugin the tab is for. */
  readonly onOpened: (pluginId: string) => void;
  readonly onClose?: () => void;
  readonly onManage?: () => void;
}

export function MiniAppPicker({ sessionId, onOpened, onClose, onManage }: MiniAppPickerProps): ReactElement {
  const workflows = useWebuiMiniAppWorkflows();
  const state = useWebuiMiniAppWorkflowsState();
  const { loading } = state.listing;
  // The page's visibility is the platform's fact, not this component's: the
  // dependency rules keep `document` out of the bindings, and the browser port
  // already answers both questions this surface asks of it.
  const { dom } = useWebuiBrowserCapabilities();
  // Only a startable package belongs here: the picker exists to open one, and a
  // disabled Mini App cannot be opened — the catalogue's apps area is where it is
  // enabled, and this surface would otherwise offer an action that always fails.
  const rows = state.listing.rows.filter((row) => row.enabled);
  const running = webuiMiniAppRunningRows(rows);
  const refused = Object.values(state.refusals);
  const capacityRefused = refused.some((refusal) => refusal.code === "BUSY");
  /* The capacity that was reached is an event, not a state: it is said once,
   * and the picker keeps the rows it has. */
  useWebuiToastError(capacityRefused ? webuiMiniAppCapacityText(rows) : undefined, {
    testId: "miniapp-picker-capacity",
  });

  useEffect(() => {
    void workflows?.loadListing();
    const refresh = () => {
      if (!dom.isPageHidden()) void workflows?.loadListing();
    };
    window.addEventListener("focus", refresh);
    const stopVisibility = dom.listenForVisibilityChange(refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      stopVisibility();
    };
  }, [workflows, dom]);

  return (
    <div className="webui-miniapp-picker" data-testid="miniapp-picker">
      <div className="webui-miniapp-picker-heading">
        <h1>我的 Mini App</h1>
        <WebuiButton variant="quiet-highlight" size="inline" type="button" onClick={onManage} disabled={!onManage}>
          管理 <WebuiIconChevronRight />
        </WebuiButton>
        {onClose ? (
          <WebuiButton variant="secondary" size="compact" type="button" onClick={onClose}>
            取消
          </WebuiButton>
        ) : null}
      </div>
      {state.unavailable ? <FeedbackEmpty className="webui-plugin-empty" title={state.unavailable} /> : null}
      {loading && rows.length === 0 ? (
        // 加载中是一个要被听到的状态，播报通道交给共享契约。
        <FeedbackLiveRegion className="webui-plugin-empty">加载中…</FeedbackLiveRegion>
      ) : null}
      {!state.unavailable && !loading && rows.length === 0 ? (
        <FeedbackEmpty className="webui-plugin-empty" title={"暂无已安装的 Mini App"} />
      ) : null}
      {/* A refused fourth start says which applications are using the capacity,
          and each of them carries the stop button that frees one. */}
      <PluginRowList>
        {rows.map((row) => {
          const refusal = state.refusals[row.pluginId];
          return (
            <PluginRow className="webui-miniapp-picker-row" key={`picker-${row.pluginId}`} testId={`miniapp-picker-row-${row.pluginId}`}>
              <PluginRowIcon className="webui-miniapp-picker-icon">
                {row.iconUrl ? (
                  <>
                    <img
                      src={row.iconUrl}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                        event.currentTarget.nextElementSibling?.removeAttribute("hidden");
                      }}
                    />
                    <span hidden>
                      <WebuiIconSites />
                    </span>
                  </>
                ) : (
                  <WebuiIconSites />
                )}
              </PluginRowIcon>
              <PluginRowCopy>
                <h2>{row.name}</h2>
                <p>{row.description || row.pluginId}</p>
                <span className="webui-miniapp-picker-status" data-status={row.status}>
                  {row.statusLabel}{row.errorCode ? `（${webuiMiniAppFailureCodeText(row.errorCode)}）` : ""}
                </span>
                {refusal ? (
                  <MiniAppPickerRefusal
                    pluginId={row.pluginId}
                    text={webuiMiniAppRefusalText({
                      code: refusal.code,
                      message: refusal.message,
                      rows,
                    })}
                  />
                ) : null}
              </PluginRowCopy>
              <PluginRowActions>
                <WebuiButton
                  variant="secondary"
                  size="compact"
                  type="button"
                  data-testid={`miniapp-picker-open-${row.pluginId}`}
                  aria-label="打开"
                  disabled={state.opening === row.pluginId || row.ownedElsewhere}
                  title={row.ownedElsewhere ? `另一个客户端${row.ownerClient ? `（${row.ownerClient}）` : ""}正在运行此 Mini App` : undefined}
                  onClick={() => {
                    void workflows?.open(row.pluginId).then((opened) => {
                      if (opened) onOpened(row.pluginId);
                    });
                  }}
                >
                  {row.ownedElsewhere ? `其他客户端运行中${row.ownerClient ? `（${row.ownerClient}）` : ""}` : "使用"}
                </WebuiButton>
                {row.canStop ? (
                  <WebuiButton
                    variant="quiet-subtle"
                    size="compact"
                    type="button"
                    data-testid={`miniapp-picker-stop-${row.pluginId}`}
                    onClick={() => void workflows?.stop(row.pluginId)}
                  >
                    停止
                  </WebuiButton>
                ) : null}
              </PluginRowActions>
            </PluginRow>
          );
        })}
      </PluginRowList>
      <WebuiButton variant="primary" size="panel" className="webui-miniapp-picker-create" type="button" onClick={onManage} disabled={!onManage}>
        创建 Mini App
      </WebuiButton>
      {sessionId ? null : (
        <FeedbackEmpty className="webui-plugin-empty" title={"当前没有会话，Mini App 会打开在第一个标签页里。"} />
      )}
      {running.length > 0 ? (
        <p className="text-size_12 text-text_default_secondary" data-testid="miniapp-picker-running">
          正在运行：{running.map((row) => row.name).join("、")}
        </p>
      ) : null}
    </div>
  );
}
