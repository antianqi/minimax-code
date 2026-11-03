// The apps area combines the installed plugin catalogue with Mini App runtime
// state. Plugin metadata owns identity and icon projection; Mini App workflows
// own lifecycle state and actions, the same runtime rows the launcher reads.

import { useEffect, useState, type ReactElement } from "react";
import {
  IconDots,
  IconExternalLink,
  IconPlayerPlay,
  IconPlayerStop,
  IconShieldLock,
  IconTrash,
} from "@tabler/icons-react";

import { useWebuiBrowserCapabilities } from "../../../bindings/browser-capabilities.js";
import {
  useWebuiMiniAppWorkflows,
  useWebuiMiniAppWorkflowsState,
} from "../bindings/use-miniapp-workflows.js";
import {
  webuiMiniAppFailureCodeText,
  webuiMiniAppRefusalText,
  webuiMiniAppWindowName,
  type WebuiMiniAppRow,
} from "../projection/miniapp-view.js";
import { readWebuiPluginRow } from "../../plugins/contracts/plugin-rows.js";
import { FeedbackBusy, FeedbackError } from "../../../ui/feedback.js";
import { WebuiButton, WebuiIconButton } from "../../../ui/button.js";
import { WebuiDropdown } from "../../../ui/Dropdown.js";
import { WebuiMenuItem } from "../../../ui/menu-item.js";
import { ToggleSwitch } from "../../../ui/ToggleSwitch.js";
import {
  PluginRow,
  PluginRowActions,
  PluginRowCopy,
  PluginRowIcon,
  PluginRowList,
} from "../../plugins/ui/PluginRow.public.js";
import { WebuiSkeletonProjection } from "../../../ui/page.js";

import { FeedbackEmpty } from "../../../ui/feedback.js";
export interface MiniAppInstalledPluginRow {
  readonly source: Record<string, unknown>;
  readonly name: string;
  readonly description: string;
  readonly iconUrl: string;
  readonly enabled: boolean;
}

export interface MiniAppAppsListProps {
  /** Installed plugin rows carrying the marketplace's category and icon metadata. */
  readonly installedPlugins?: readonly MiniAppInstalledPluginRow[];
  /** The catalogue query, also applied to runtime-only local Mini Apps. */
  readonly query?: string;
  /** The session the standalone Mini App page should present. */
  readonly selectedSessionId?: string;
}

export function MiniAppAppsList({
  installedPlugins = [],
  query = "",
  selectedSessionId,
}: MiniAppAppsListProps): ReactElement {
  const workflows = useWebuiMiniAppWorkflows();
  const state = useWebuiMiniAppWorkflowsState();
  const [openMenuKey, setOpenMenuKey] = useState<string>();
  /** The row whose permissions are open; one at a time, and loaded on open. */
  const [permissionsPluginId, setPermissionsPluginId] = useState<string>();
  const { rows, loading, error } = state.listing;
  const permissionSlice =
    permissionsPluginId === undefined ? undefined : state.permissions[permissionsPluginId];
  // The page's visibility is the platform's fact, not this component's: the
  // dependency rules keep `document` out of the bindings, and the browser port
  // already answers both questions this surface asks of it.
  const { dom } = useWebuiBrowserCapabilities();

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

  if (loading && rows.length === 0 && installedPlugins.length === 0) {
    return <FeedbackBusy label="加载中…" />;
  }

  const items = new Map<
    string,
    {
      readonly pluginId: string;
      readonly name: string;
      readonly description: string;
      readonly iconUrl?: string;
      readonly enabled: boolean;
      readonly runtime?: WebuiMiniAppRow;
    }
  >();
  for (const plugin of installedPlugins) {
    const item = plugin.source;
    const pluginId = readWebuiPluginRow(
      item,
      "name",
      "pluginName",
      "plugin_name",
      "pluginId",
    );
    if (!pluginId) continue;
    const key = pluginId.toLocaleLowerCase();
    const runtime = rows.find(
      (row) => row.pluginId.toLocaleLowerCase() === key,
    );
    items.set(key, {
      pluginId,
      name:
        readWebuiPluginRow(item, "displayName", "display_name") ||
        plugin.name ||
        pluginId,
      description: plugin.description,
      enabled: plugin.enabled,
      ...(plugin.iconUrl || runtime?.iconUrl
        ? { iconUrl: plugin.iconUrl || runtime?.iconUrl }
        : {}),
      ...(runtime ? { runtime } : {}),
    });
  }
  for (const runtime of rows) {
    const key = runtime.pluginId.toLocaleLowerCase();
    if (
      !items.has(key) &&
      (!query ||
        `${runtime.name} ${runtime.description} ${runtime.pluginId}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()))
    ) {
      items.set(key, {
        pluginId: runtime.pluginId,
        name: runtime.name,
        description: runtime.description,
        enabled: runtime.enabled,
        ...(runtime.iconUrl ? { iconUrl: runtime.iconUrl } : {}),
        runtime,
      });
    }
  }
  const listingRows = [...items.values()];

  return (
    <WebuiSkeletonProjection>
      <div className="webui-miniapp-apps" data-testid="miniapp-apps">
        {error ? (
          <FeedbackError message={error} className="webui-plugin-error" />
        ) : null}
        {state.unavailable ? (
          <FeedbackError
            message={state.unavailable}
            className="webui-plugin-error"
          />
        ) : null}
        {listingRows.length === 0 ? (
          <FeedbackEmpty
            className="webui-plugin-empty"
            title={"暂无已安装的 Mini App"}
          />
        ) : null}
        <PluginRowList>
          {listingRows.map((item) => {
            const row = item.runtime;
            const refusal = row ? state.refusals[row.pluginId] : undefined;
            const opened = row ? state.presentations[row.pluginId] : undefined;
            const standaloneHref =
              row && opened?.kind === "open" && selectedSessionId
                ? workflows?.standaloneUrl({
                    pluginId: row.pluginId,
                    sessionId: selectedSessionId,
                  })
                : undefined;
            return (
              <PluginRow
                key={`apps-${item.pluginId}`}
                testId={`miniapp-app-${item.pluginId}`}
              >
                <PluginRowIcon>
                  {item.iconUrl ? (
                    <>
                      <img
                        src={item.iconUrl}
                        alt=""
                        loading="lazy"
                        onError={(event) => {
                          event.currentTarget.hidden = true;
                          event.currentTarget.nextElementSibling?.removeAttribute(
                            "hidden",
                          );
                        }}
                      />
                      <span hidden>◇</span>
                    </>
                  ) : (
                    "◇"
                  )}
                </PluginRowIcon>
                <PluginRowCopy>
                  <h2>{item.name}</h2>
                  <p>{item.description || item.pluginId}</p>
                  {refusal ? (
                    <FeedbackError
                      className="webui-plugin-error"
                      testId={`miniapp-app-refusal-${item.pluginId}`}
                      message={webuiMiniAppRefusalText({
                        code: refusal.code,
                        message: refusal.message,
                        rows,
                      })}
                    />
                  ) : null}
                </PluginRowCopy>
                <span
                  className="text-text_default_tertiary"
                  data-testid={`miniapp-app-status-${item.pluginId}`}
                  data-status={
                    row?.status ?? (item.enabled ? "unavailable" : "disabled")
                  }
                >
                  {row?.statusLabel ??
                    (!item.enabled
                      ? "已停用"
                      : loading
                        ? "加载中…"
                        : "运行时不可用")}
                  {row?.errorCode
                    ? `（${webuiMiniAppFailureCodeText(row.errorCode)}）`
                    : ""}
                </span>
                <PluginRowActions>
                  <ToggleSwitch
                    checked={row?.enabled ?? item.enabled}
                    label={`启用 ${item.name}`}
                    onChange={(enabled) =>
                      void workflows?.setPluginEnabled(item.pluginId, enabled)
                    }
                  />
                  <WebuiDropdown
                    managed
                    managedLayerId={`miniapp-row-actions-${item.pluginId}`}
                    open={openMenuKey === item.pluginId}
                    onOpen={() => setOpenMenuKey(item.pluginId)}
                    onClose={() => setOpenMenuKey(undefined)}
                    role="menu"
                    ariaLabel={`${item.name}的更多操作`}
                    align="end"
                    collision="flip"
                    wrapperClassName="webui-plugin-row-actions-menu-anchor"
                    className="webui-plugin-row-actions-menu"
                    trigger={(triggerProps) => {
                      const { ref, ...rest } = triggerProps;
                      return (
                        <WebuiIconButton
                          label={`${item.name}的更多操作`}
                          tone="bare"
                          size="compact"
                          {...rest}
                          ref={ref}
                        >
                          <IconDots aria-hidden="true" size={18} stroke={1.7} />
                        </WebuiIconButton>
                      );
                    }}
                  >
                    {row?.enabled ? (
                      <>
                        <WebuiMenuItem
                          icon={<IconPlayerPlay size={18} stroke={1.7} />}
                          data-testid={`miniapp-app-open-${row.pluginId}`}
                          disabled={
                            state.opening === row.pluginId || row.ownedElsewhere
                          }
                          title={
                            row.ownedElsewhere
                              ? `另一个客户端${row.ownerClient ? `（${row.ownerClient}）` : ""}正在运行此 Mini App`
                              : undefined
                          }
                          onClick={() => {
                            setOpenMenuKey(undefined);
                            void workflows?.open(row.pluginId);
                          }}
                        >
                          {row.ownedElsewhere
                            ? `其他客户端运行中${row.ownerClient ? `（${row.ownerClient}）` : ""}`
                            : "打开"}
                        </WebuiMenuItem>
                        {opened?.kind === "open" && standaloneHref !== undefined ? (
                          <WebuiMenuItem
                            icon={<IconExternalLink size={18} stroke={1.7} />}
                            title="在独立标签页中查看 Mini App"
                            onClick={() => {
                              setOpenMenuKey(undefined);
                              window.open(
                                standaloneHref,
                                webuiMiniAppWindowName(row.pluginId),
                              );
                            }}
                          >
                            查看
                          </WebuiMenuItem>
                        ) : null}
                        <WebuiMenuItem
                          icon={<IconPlayerStop size={18} stroke={1.7} />}
                          data-testid={`miniapp-app-stop-${row.pluginId}`}
                          disabled={!row.canStop}
                          onClick={() => {
                            setOpenMenuKey(undefined);
                            void workflows?.stop(row.pluginId);
                          }}
                        >
                          停止
                        </WebuiMenuItem>
                        <WebuiMenuItem
                          icon={<IconShieldLock size={18} stroke={1.7} />}
                          data-testid={`miniapp-app-permissions-${row.pluginId}`}
                          onClick={() => {
                            setOpenMenuKey(undefined);
                            setPermissionsPluginId(row.pluginId);
                            void workflows?.loadPermissions(row.pluginId);
                          }}
                        >
                          权限
                        </WebuiMenuItem>
                        <WebuiMenuItem
                          danger
                          icon={<IconTrash size={18} stroke={1.7} />}
                          onClick={() => {
                            setOpenMenuKey(undefined);
                            if (window.confirm(`确定卸载 ${item.name}？`))
                              void workflows?.uninstall(row.pluginId);
                          }}
                        >
                          卸载
                        </WebuiMenuItem>
                      </>
                    ) : (
                      <WebuiMenuItem disabled icon={<IconPlayerPlay size={18} stroke={1.7} />}>
                        当前没有可用操作
                      </WebuiMenuItem>
                    )}
                  </WebuiDropdown>
                </PluginRowActions>
              </PluginRow>
            );
          })}
        </PluginRowList>
        {permissionsPluginId !== undefined && permissionSlice !== undefined ? (
          <div className="webui-miniapp-permissions" data-testid="miniapp-permissions">
            <h3 className="webui-miniapp-permissions-title">
              {items.get(permissionsPluginId.toLocaleLowerCase())?.name ??
                permissionsPluginId}
              的权限
            </h3>
            {permissionSlice.error ? (
              <FeedbackError message={permissionSlice.error} />
            ) : null}
            {permissionSlice.items.length > 0 ? (
              permissionSlice.items.map((permission) => (
                <ToggleSwitch
                  key={permission.id}
                  checked={permission.enabled}
                  label={permission.id}
                  testId={`miniapp-permission-${permission.id}`}
                  loading={permissionSlice.saving === permission.id}
                  onChange={(next) => {
                    void workflows?.setPermission(permissionsPluginId, permission.id, next);
                  }}
                />
              ))
            ) : permissionSlice.loading ? (
              <FeedbackBusy label="加载中…" />
            ) : (
              <p className="webui-miniapp-permissions-empty">
                这个 Mini App 没有声明可切换的权限。
              </p>
            )}
            <WebuiButton
              variant="secondary"
              size="compact"
              onClick={() => setPermissionsPluginId(undefined)}
            >
              关闭
            </WebuiButton>
          </div>
        ) : null}
      </div>
    </WebuiSkeletonProjection>
  );
}
