import type { ReactElement } from "react";
import { IconFileCode, IconTrash } from "@tabler/icons-react";
import type { WebuiPluginIntent } from "../contracts/plugin-actions.js";
import { readWebuiPluginRow as read } from "../contracts/plugin-rows.js";
import type { WebuiPluginCatalogueRow } from "../projection/catalogue-view.js";
import { ToggleSwitch } from "../../../ui/ToggleSwitch.js";
import { FeedbackEmpty, FeedbackSkeleton } from "../../../ui/feedback.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiMotion, WebuiSkeletonProjection } from "../../../ui/page.js";
import {
  PluginRow,
  PluginRowActions,
  PluginRowCopy,
  PluginRowIcon,
  PluginRowList,
} from "../../plugins/ui/PluginRow.public.js";

export type PluginManagementArea =
  "plugins" | "skills" | "apps" | "mcp" | "agents";
type Area = Exclude<PluginManagementArea, "agents">;
const categories: readonly { id: PluginManagementArea; label: string }[] = [
  { id: "plugins", label: "插件" },
  { id: "skills", label: "技能" },
  { id: "apps", label: "应用" },
  { id: "mcp", label: "MCP" },
  { id: "agents", label: "Agents" },
];
const MANAGEMENT_SKELETON_WIDTHS = [100, 70, 82, 46, 70, 46] as const;

export function PluginManagementFilters({
  area,
  rowCount,
  onAreaChange,
}: {
  readonly area: PluginManagementArea;
  readonly rowCount: number;
  readonly onAreaChange: (area: PluginManagementArea) => void;
}): ReactElement {
  return (
    <nav className="webui-plugin-category-filter" aria-label="插件管理分类">
      {categories.map((item) => (
        <WebuiButton
          variant="segmented"
          size="compact"
          key={item.id}
          aria-pressed={area === item.id}
          onClick={() => onAreaChange(item.id)}
        >
          <span>{item.label}</span>
          {area === item.id ? (
            <span className="webui-plugin-count">{rowCount}</span>
          ) : null}
        </WebuiButton>
      ))}
    </nav>
  );
}

export function PluginManagementList({
  area,
  rows,
  loading = false,
  onMutate,
  onConfirmMutation,
  onPrepareMcp,
}: {
  readonly area: Area;
  readonly rows: readonly WebuiPluginCatalogueRow[];
  readonly loading?: boolean;
  readonly onMutate: (intent: WebuiPluginIntent) => void;
  readonly onConfirmMutation: (
    label: string,
    intent: WebuiPluginIntent,
  ) => void;
  readonly onPrepareMcp: (row: WebuiPluginCatalogueRow["source"]) => void;
}): ReactElement {
  return loading ? (
    <FeedbackSkeleton
      rows={12}
      widths={MANAGEMENT_SKELETON_WIDTHS}
      maxWidth={334}
      rowHeight={35}
      rowRadius={18}
      testId="plugin-management-skeleton"
    />
  ) : rows.length === 0 ? (
    <FeedbackEmpty title="暂无内容" />
  ) : (
    <WebuiSkeletonProjection>
      <PluginRowList>
        {rows.map((row, index) => {
          const item = row.source;
          const name = row.name || `item-${index}`;
          const isOn = row.enabled;
          const pluginIntent = (
            kind: "installPlugin" | "enablePlugin" | "disablePlugin",
          ): WebuiPluginIntent => ({
            kind,
            pluginName: name,
            ...(row.pluginSource === undefined
              ? {}
              : { source: row.pluginSource }),
          });
          return (
            <PluginRow
              hoverable
              key={`${area}-${name}`}
            >
            <PluginRowIcon
              className={area === "skills" ? "webui-plugin-icon--skill" : undefined}
            >
                {area === "skills" ? (
                  <span className="webui-plugin-skill-icon-tile">
                    <IconFileCode aria-hidden="true" size={22} stroke={1.5} />
                  </span>
                ) : row.iconUrl ? (
                  <>
                    <img
                      src={row.iconUrl}
                      alt=""
                      loading="lazy"
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                        event.currentTarget.nextElementSibling?.removeAttribute(
                          "hidden",
                        );
                      }}
                    />
                    <span hidden>▦</span>
                  </>
                ) : area === "plugins" ? (
                  "▦"
                ) : (
                  "◇"
                )}
              </PluginRowIcon>
              <PluginRowCopy>
                <h2>{read(item, "displayName", "display_name") || name}</h2>
                <p>{row.description || read(item, "transport")}</p>
              </PluginRowCopy>
              {area === "apps" ? (
                <span className="text-text_default_tertiary">
                  {row.appStatus}
                </span>
              ) : area === "mcp" ? (
                <>
                  <div className="webui-plugin-mcp-status">
                    <span
                      className={`text-size_12 ${row.mcpStatus.tone}`}
                      data-webui-mcp-status={row.mcpStatus.key}
                    >
                      {row.mcpStatus.label}
                    </span>
                    {row.mcpStatus.reason ? (
                      <small
                        className="text-size_12 text-text_default_secondary"
                        data-webui-mcp-status-reason={row.mcpStatus.key}
                        title={row.mcpStatus.reason}
                      >
                        {row.mcpStatus.reason}
                      </small>
                    ) : null}
                  </div>
                  <PluginRowActions>
                    <WebuiButton
                      variant="secondary"
                      size="compact"
                      onClick={() => onPrepareMcp(item)}
                    >
                      编辑
                    </WebuiButton>
                    <WebuiButton
                      variant="danger"
                      size="compact"
                      onClick={() =>
                        onConfirmMutation("删除 MCP server", {
                          kind: "deleteMcpServer",
                          name,
                        })
                      }
                    >
                      删除
                    </WebuiButton>
                    <ToggleSwitch
                      checked={isOn}
                      label={`启用 ${name}`}
                      onChange={() =>
                        onMutate({
                          kind: "setMcpServerEnabled",
                          name,
                          enabled: !isOn,
                        })
                      }
                    />
                  </PluginRowActions>
                </>
              ) : (
                <PluginRowActions>
                  <ToggleSwitch
                    checked={isOn}
                    label={`启用 ${name}`}
                    onChange={() =>
                      onMutate(
                        area === "plugins"
                          ? isOn
                            ? pluginIntent("disablePlugin")
                            : pluginIntent("enablePlugin")
                          : {
                              kind: "setSkillEnabled",
                              skillName: name,
                              enabled: !isOn,
                              ...(row.locationUri
                                ? { locationUri: row.locationUri }
                                : {}),
                            },
                      )
                    }
                  />
                  {area === "plugins" ? (
                    <WebuiButton
                      variant="danger-soft"
                      size="action"
                      onClick={() =>
                        onConfirmMutation("卸载插件", {
                          kind: "uninstallPlugin",
                          pluginName: name,
                          ...(row.pluginSource === undefined
                            ? {}
                            : { source: row.pluginSource }),
                        })
                      }
                    >
                      <IconTrash aria-hidden="true" size={18} stroke={1.7} />
                      卸载
                    </WebuiButton>
                  ) : area === "skills" ? (
                    <WebuiButton
                      variant="danger"
                      size="compact"
                      onClick={() =>
                        onConfirmMutation("删除技能", {
                          kind: "deleteSkill",
                          skillName: name,
                          ...(row.locationUri
                            ? { locationUri: row.locationUri }
                            : {}),
                        })
                      }
                    >
                      删除
                    </WebuiButton>
                  ) : null}
                </PluginRowActions>
              )}
            </PluginRow>
          );
        })}
      </PluginRowList>
    </WebuiSkeletonProjection>
  );
}
