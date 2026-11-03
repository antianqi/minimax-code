// The Mini App picker the workspace panel's launcher opens.
//
// Same listing as the plugin catalogue's apps area — one owner, one read — so a
// row here and a row there cannot disagree about what is running. The picker's own
// job is small: show the rows with their state, start the one that was chosen, and
// name the running ones when the runtime refuses a fourth.
//
// It opens the view by asking its owner to start the Mini App and then telling the
// workspace which tab to open. That direction is ADR 0020's: the business issues
// the workspace panel's own command, it never reaches into the panel's state.

import { useEffect, useState, type ReactElement } from "react";
import { IconApps, IconX } from "@tabler/icons-react";

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
import { WebuiIconChevronRight, WebuiIconSites } from "../../../shell/icons.js";
import { FeedbackError, FeedbackLiveRegion } from "../../../ui/feedback.js";
import { WebuiButton } from "../../../ui/button.js";
import {
  PluginRow,
  PluginRowActions,
  PluginRowCopy,
  PluginRowIcon,
  PluginRowList,
} from "../../plugins/ui/PluginRow.public.js";

import { FeedbackEmpty } from "../../../ui/feedback.js";
import { WebuiDialog } from "../../../ui/dialog.js";
import { WebuiIconButton } from "../../../ui/button.js";
import { webuiMiniAppWindowName } from "../projection/miniapp-view.js";

/** Icon-card launcher opened from the primary navigation rail. */
export function MiniAppLauncher({ sessionId }: { readonly sessionId?: string }): ReactElement | null {
  const [open, setOpen] = useState(false);
  const workflows = useWebuiMiniAppWorkflows();
  const state = useWebuiMiniAppWorkflowsState();
  const { dom } = useWebuiBrowserCapabilities();
  const rows = state.listing.rows;

  useEffect(() => {
    if (!open) return;
    void workflows?.loadListing();
  }, [open, workflows]);

  return <>
    <WebuiButton
      variant="selectable-row"
      size="regular"
      className="webui-nav-item h-8 w-full pl-2 pr-2.5 text-sm font-normal"
      data-webui-nav-item="应用"
      data-webui-nav-active={open ? "true" : "false"}
      aria-current={open ? "page" : undefined}
      onClick={() => setOpen(true)}
    >
      <span className="flex flex-shrink-0 items-center justify-center"><IconApps /></span>
      <span className="min-w-0 flex-1 truncate whitespace-nowrap">应用</span>
    </WebuiButton>
    <WebuiDialog
      id="miniapp-launcher-dialog"
      open={open}
      title="应用"
      onClose={() => setOpen(false)}
      dismissOnEscape
      dismissOnBackdrop
      portalTarget={dom.portalTarget()}
      testId="miniapp-launcher"
      width="wide"
      bodyClassName="webui-miniapp-launcher-body"
    >
      {state.unavailable ? <FeedbackEmpty title={state.unavailable} /> : null}
      {!state.unavailable && state.listing.loading && rows.length === 0 ? <FeedbackLiveRegion>正在加载应用…</FeedbackLiveRegion> : null}
      {!state.unavailable && !state.listing.loading && rows.length === 0 ? <FeedbackEmpty title="暂无已安装的 Mini App" /> : null}
      <div className="webui-miniapp-launcher-grid">
        {rows.map((row) => {
          const running = row.enabled && row.status === "running";
          const launchable = row.enabled && !running && row.status !== "starting" && row.status !== "stopping" && Boolean(sessionId);
          const launch = () => {
            if (!sessionId || !launchable) return;
            const href = workflows?.standaloneUrl({ pluginId: row.pluginId, sessionId });
            if (href) window.open(href, webuiMiniAppWindowName(row.pluginId));
          };
          return <div
            className={`webui-miniapp-launcher-card${running ? " is-running" : ""}`}
            key={row.pluginId}
            data-testid={`miniapp-launcher-card-${row.pluginId}`}
            data-status={row.status}
            aria-disabled={!launchable && !running ? "true" : undefined}
          >
            {launchable ? <button className="webui-miniapp-launcher-open" type="button" onClick={launch} aria-label={`打开${row.name}`}>
              {row.iconUrl ? <img data-testid={`miniapp-launcher-icon-${row.pluginId}`} src={row.iconUrl} alt="" /> : <IconApps />}
              <span className="webui-miniapp-launcher-name">{row.name}</span>
              <span className="webui-miniapp-launcher-status">{row.statusLabel}</span>
            </button> : <div className="webui-miniapp-launcher-face" aria-label={`${row.name}，${row.statusLabel}`}>
              {row.iconUrl ? <img data-testid={`miniapp-launcher-icon-${row.pluginId}`} src={row.iconUrl} alt="" /> : <IconApps />}
              <span className="webui-miniapp-launcher-name">{row.name}</span>
            </div>}
            {!launchable ? <span className="webui-miniapp-launcher-status">{row.statusLabel}</span> : null}
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
    </WebuiDialog>
  </>;
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
      {capacityRefused ? (
        <FeedbackError message={webuiMiniAppCapacityText(rows)} className="webui-plugin-error" testId="miniapp-picker-capacity" />
      ) : null}
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
                  <FeedbackError
                    className="webui-plugin-error"
                    testId={`miniapp-picker-refusal-${row.pluginId}`}
                    message={webuiMiniAppRefusalText({
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
