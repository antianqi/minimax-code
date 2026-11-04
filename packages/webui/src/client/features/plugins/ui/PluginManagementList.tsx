import { useState, type ReactElement, type ReactNode } from "react";
import { IconDots, IconEdit, IconFileCode, IconServer, IconTrash } from "@tabler/icons-react";
import type { WebuiPluginIntent } from "../contracts/plugin-actions.js";
import { readWebuiPluginRow as read } from "../contracts/plugin-rows.js";
import type { WebuiPluginCatalogueRow } from "../projection/catalogue-view.js";
import { ToggleSwitch } from "../../../ui/ToggleSwitch.js";
import { FeedbackEmpty, FeedbackSkeleton } from "../../../ui/feedback.js";
import { WebuiButton, WebuiIconButton } from "../../../ui/button.js";
import { WebuiDropdown } from "../../../ui/Dropdown.js";
import { WebuiMenuItem } from "../../../ui/menu-item.js";
import { WebuiSkeletonProjection } from "../../../ui/page.js";
import {
  PluginRow,
  PluginRowActions,
  PluginRowCopy,
  PluginRowIcon,
  PluginRowList,
} from "../../plugins/ui/PluginRow.public.js";
import { webuiPluginIconSource } from "./PluginIconSource.public.js";

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
  readonly onMutate: (intent: WebuiPluginIntent) => void | Promise<unknown>;
  readonly onConfirmMutation: (
    label: string,
    intent: WebuiPluginIntent,
  ) => void | Promise<unknown>;
  readonly onPrepareMcp: (row: WebuiPluginCatalogueRow["source"]) => void | Promise<unknown>;
}): ReactElement {
  const [openMenuKey, setOpenMenuKey] = useState<string>();
  const renderActionsMenu = (key: string, name: string, children: ReactNode): ReactElement => (
    <WebuiDropdown
      managed
      managedLayerId={`plugin-management-row-actions-${key}`}
      open={openMenuKey === key}
      onOpen={() => setOpenMenuKey(key)}
      onClose={() => setOpenMenuKey(undefined)}
      role="menu"
      ariaLabel={`${name}的更多操作`}
      align="end"
      collision="flip"
      wrapperClassName="webui-plugin-row-actions-menu-anchor"
      className="webui-plugin-row-actions-menu"
      trigger={(triggerProps) => {
        const { ref, ...rest } = triggerProps;
        return (
          <WebuiIconButton
            label={`${name}的更多操作`}
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
      {children}
    </WebuiDropdown>
  );
  return loading ? (
    <FeedbackSkeleton
      rows={12}
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
          const iconSource = webuiPluginIconSource(row.iconUrl);
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
          const menuKey = `${area}-${name}`;
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
                ) : iconSource ? (
                  <>
                    <img
                      src={iconSource}
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
                ) : area === "mcp" ? (
                  <IconServer aria-hidden="true" size={22} stroke={1.5} />
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
              ) : null}
              <PluginRowActions>
                <ToggleSwitch
                  checked={isOn}
                  label={`启用 ${name}`}
                  onChange={() =>
                    onMutate(
                      area === "mcp"
                        ? { kind: "setMcpServerEnabled", name, enabled: !isOn }
                        : area === "plugins"
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
                {renderActionsMenu(menuKey, name, area === "mcp" ? (
                  <>
                    <WebuiMenuItem
                      icon={<IconEdit size={18} stroke={1.7} />}
                      onClick={() => {
                        setOpenMenuKey(undefined);
                        void onPrepareMcp(item);
                      }}
                    >
                      编辑
                    </WebuiMenuItem>
                    <WebuiMenuItem
                      danger
                      icon={<IconTrash size={18} stroke={1.7} />}
                      onClick={() => {
                        setOpenMenuKey(undefined);
                        void onConfirmMutation("删除 MCP server", {
                          kind: "deleteMcpServer",
                          name,
                        });
                      }}
                    >
                      删除
                    </WebuiMenuItem>
                  </>
                ) : area === "plugins" ? (
                  <WebuiMenuItem
                    danger
                    icon={<IconTrash size={18} stroke={1.7} />}
                    onClick={() => {
                      setOpenMenuKey(undefined);
                      void onConfirmMutation("卸载插件", {
                        kind: "uninstallPlugin",
                        pluginName: name,
                        ...(row.pluginSource === undefined
                          ? {}
                          : { source: row.pluginSource }),
                      });
                    }}
                  >
                    卸载
                  </WebuiMenuItem>
                ) : (
                  <WebuiMenuItem
                    danger
                    icon={<IconTrash size={18} stroke={1.7} />}
                    onClick={() => {
                      setOpenMenuKey(undefined);
                      void onConfirmMutation("删除技能", {
                        kind: "deleteSkill",
                        skillName: name,
                        ...(row.locationUri
                          ? { locationUri: row.locationUri }
                          : {}),
                      });
                    }}
                  >
                    删除
                  </WebuiMenuItem>
                ))}
              </PluginRowActions>
            </PluginRow>
          );
        })}
      </PluginRowList>
    </WebuiSkeletonProjection>
  );
}
