import { useId, type ReactElement } from "react";
import { IconFileCode } from "@tabler/icons-react";
import type { WebuiPluginCatalogueRow } from "../projection/catalogue-view.js";
import type { WebuiPluginIntent } from "../contracts/plugin-actions.js";
import { readWebuiPluginRow as read } from "../contracts/plugin-rows.js";
import { FeedbackEmpty } from "../../../ui/feedback.js";
import { WebuiButton } from "../../../ui/button.js";
import { WebuiDisclosure, WebuiMotion, WebuiSkeleton, WebuiSkeletonProjection } from "../../../ui/page.js";
import {
  PluginRow,
  PluginRowActions,
  PluginRowCopy,
  PluginRowIcon,
  PluginRowList,
} from "../../plugins/ui/PluginRow.public.js";

const MARKET_PREVIEW_COUNT = 8;
const MINIAPP_CATEGORY = { id: "tag:miniapp", label: "Mini App" } as const;
const categories: readonly { id: string; label: string }[] = [
  { id: "", label: "全部" },
  { id: "office", label: "办公" },
  { id: "studio", label: "创作" },
  { id: "design_and_sites", label: "设计与网站" },
  { id: "code", label: "代码" },
  { id: "business", label: "商业" },
  { id: "sales", label: "销售" },
  { id: "productivity", label: "效率" },
  { id: "tools", label: "工具" },
  { id: "science_and_healthcare", label: "科学与医疗" },
  { id: "education", label: "教育" },
  { id: "other", label: "其他" },
];

export function marketplaceCategoryLabel(category: string): string | undefined {
  return categories.find((item) => item.id === category)?.label;
}

function PluginMarketCard({
  area,
  row,
  index,
  onIntent,
}: {
  readonly area: "plugins" | "skills";
  readonly row: WebuiPluginCatalogueRow;
  readonly index: number;
  readonly onIntent: (intent: WebuiPluginIntent) => void;
}): ReactElement {
  const item = row.source;
  const name = row.name || `item-${index}`;
  const pluginIntent = (
    kind: "installPlugin" | "enablePlugin" | "disablePlugin",
  ): WebuiPluginIntent => ({
    kind,
    pluginName: name,
    ...(row.pluginSource === undefined ? {} : { source: row.pluginSource }),
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
                event.currentTarget.nextElementSibling?.removeAttribute("hidden");
              }}
            />
            <span hidden>▦</span>
          </>
        ) : (
          "▦"
        )}
      </PluginRowIcon>
      <PluginRowCopy>
        <h2>{read(item, "displayName", "display_name") || name}</h2>
        <p>{row.description || read(item, "transport")}</p>
      </PluginRowCopy>
      {area === "plugins" ? (
        <WebuiButton
          variant="secondary"
          size="compact"
          disabled={item.installed === true}
          onClick={() => onIntent(pluginIntent("installPlugin"))}
        >
          {item.installed === true ? "已安装" : "安装"}
        </WebuiButton>
      ) : (
        <WebuiButton
          variant="secondary"
          size="compact"
          disabled={
            item.added === true ||
            !read(item, "url", "sourceUrl", "source_url", "gitUrl", "git_url")
          }
          onClick={() =>
            onIntent({
              kind: "installSkill",
              url: read(item, "url", "sourceUrl", "source_url") || read(item, "gitUrl", "git_url"),
              displayName: read(item, "displayName", "display_name") || undefined,
              publisherSourceType:
                typeof item.publisherSourceType === "number"
                  ? item.publisherSourceType
                  : typeof item.source_type === "number"
                    ? item.source_type
                    : undefined,
              isFromGit: item.isFromGit === true || item.is_from_git === true,
              ...(row.creatorInfo ? { creatorInfo: row.creatorInfo } : {}),
            })
          }
        >
          {item.added === true ? "已添加" : "添加"}
        </WebuiButton>
      )}
    </PluginRow>
  );
}

export function PluginMarketplaceFilters({
  category,
  onCategoryChange,
}: {
  readonly category: string;
  readonly onCategoryChange: (category: string) => void;
}): ReactElement {
  return (
    <nav className="webui-plugin-category-filter" aria-label="市场分类">
      {[
        categories[0],
        MINIAPP_CATEGORY,
        ...categories.slice(1),
      ].map((item) => (
        <WebuiButton
          variant="segmented"
          size="inline-dense"
          type="button"
          key={item.id}
          aria-pressed={category === item.id}
          onClick={() => onCategoryChange(item.id)}
        >
          {item.label}
        </WebuiButton>
      ))}
    </nav>
  );
}
export function PluginMarketplace({
  area,
  rows,
  marketTotal,
  visibleMarketTotal,
  showAll,
  onToggleAll,
  onIntent,
  hideToggle = false,
  loading = false,
}: {
  readonly area: "plugins" | "skills";
  readonly rows: readonly WebuiPluginCatalogueRow[];
  readonly marketTotal: number | null;
  readonly visibleMarketTotal: number;
  readonly showAll: boolean;
  readonly onToggleAll: () => void;
  readonly onIntent: (intent: WebuiPluginIntent) => void;
  readonly hideToggle?: boolean;
  readonly loading?: boolean;
}): ReactElement {
  const noun = area === "skills" ? "技能" : "插件";
  const expandedListId = useId();
  return (
    <WebuiSkeletonProjection loading={false}>
      <>
        {loading ? (
          <PluginMarketSkeleton />
        ) : rows.length === 0 ? (
          <FeedbackEmpty title="暂无内容" />
        ) : (
          <PluginRowList className="webui-plugin-grid">
            {rows.slice(0, MARKET_PREVIEW_COUNT).map((row, index) => (
              <PluginMarketCard area={area} row={row} index={index} onIntent={onIntent} key={`${area}-preview-${row.name || index}`} />
            ))}
            {rows.length > MARKET_PREVIEW_COUNT ? (
              <WebuiDisclosure
                id={expandedListId}
                open={showAll}
                mountOnOpen
                className="webui-plugin-grid webui-plugin-expanded-list"
                data-testid="webui-plugin-expanded-list"
              >
                {rows.slice(MARKET_PREVIEW_COUNT).map((row, index) => (
                  <PluginMarketCard area={area} row={row} index={index + MARKET_PREVIEW_COUNT} onIntent={onIntent} key={`${area}-expanded-${row.name || index}`} />
                ))}
              </WebuiDisclosure>
            ) : null}
          </PluginRowList>
        )}
        {!hideToggle && visibleMarketTotal > MARKET_PREVIEW_COUNT ? (
          <WebuiButton
            variant="quiet-secondary"
            size="content"
            className="webui-plugin-show-all"
            aria-expanded={showAll}
            aria-controls={expandedListId}
            onClick={onToggleAll}
          >
            {showAll
              ? `收起${noun}`
              : marketTotal === null
                ? `查看全部${noun}`
                : `查看全部 ${marketTotal} 个`}
          </WebuiButton>
        ) : null}
      </>
    </WebuiSkeletonProjection>
  );
}

function PluginMarketSkeleton(): ReactElement {
  return (
    <div className="webui-plugin-grid" aria-hidden="true" data-testid="plugin-market-skeleton">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="webui-plugin-market-skeleton-row" key={index}>
          <WebuiSkeleton variant="shape" width={40} height={40} />
          <span className="webui-plugin-market-skeleton-copy">
            <WebuiSkeleton variant="text" width="72%" height={12} />
            <WebuiSkeleton variant="text" width="88%" height={12} />
          </span>
          <WebuiSkeleton variant="control" width={56} height={36} />
        </div>
      ))}
    </div>
  );
}
