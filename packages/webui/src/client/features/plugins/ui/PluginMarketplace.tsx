import { useId, type ReactElement } from "react";
import { IconFileCode } from "@tabler/icons-react";
import { MarketplaceCategory } from "@mavis/protocol/local";
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
const categoryDefinitions: readonly { value: number; label: string }[] = [
  { value: MarketplaceCategory.OFFICE, label: "办公" },
  { value: MarketplaceCategory.STUDIO, label: "创作" },
  { value: MarketplaceCategory.DESIGN_AND_SITES, label: "设计与网站" },
  { value: MarketplaceCategory.CODE, label: "代码" },
  { value: MarketplaceCategory.BUSINESS, label: "商业" },
  { value: MarketplaceCategory.SALES, label: "销售" },
  { value: MarketplaceCategory.PRODUCTIVITY, label: "效率" },
  { value: MarketplaceCategory.SCIENCE_AND_HEALTHCARE, label: "科学与医疗" },
  { value: MarketplaceCategory.EDUCATION, label: "教育" },
  { value: MarketplaceCategory.OTHER, label: "其他" },
];

export interface PluginMarketplaceSection {
  readonly value: string;
  readonly label: string;
  readonly rows: readonly WebuiPluginCatalogueRow[];
}

export function buildPluginMarketplaceSections(
  rows: readonly WebuiPluginCatalogueRow[],
  tags: readonly { readonly key: string; readonly displayName: string }[],
  query: string,
): PluginMarketplaceSection[] {
  const sections: PluginMarketplaceSection[] = [];
  if (!query) sections.push({ value: "featured", label: "精选", rows: rows.slice(0, 40) });
  for (const tag of tags) {
    const tagged = rows.filter((row) => Array.isArray(row.source.tags) && row.source.tags.some(
      (entry: unknown) => !!entry && typeof entry === "object" && (entry as { key?: unknown }).key === tag.key,
    ));
    if (tagged.length) sections.push({ value: `tag:${tag.key}`, label: tag.displayName, rows: tagged });
  }
  for (const definition of categoryDefinitions) {
    const matching = rows.filter((row) => {
      const category = row.source.category;
      if (definition.value === MarketplaceCategory.OTHER) {
        return typeof category !== "number" || !categoryDefinitions.some((item) => item.value === category)
          ? true
          : category === definition.value;
      }
      return category === definition.value;
    });
    if (matching.length) sections.push({ value: `category:${definition.value}`, label: definition.label, rows: matching });
  }
  return sections;
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
  sections,
  category,
  onCategorySelect,
}: {
  readonly sections: readonly PluginMarketplaceSection[];
  readonly category: string;
  readonly onCategorySelect: (category: string) => void;
}): ReactElement {
  return (
    <nav className="webui-plugin-category-filter" aria-label="市场分类">
      {sections.map((item) => (
        <WebuiButton
          variant="segmented"
          size="inline-dense"
          type="button"
          key={item.value}
          aria-pressed={category === item.value}
          onClick={() => onCategorySelect(item.value)}
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
  sections,
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
  readonly sections?: readonly PluginMarketplaceSection[];
}): ReactElement {
  const noun = area === "skills" ? "技能" : "插件";
  const expandedListId = useId();
  if (sections) {
    return loading ? <PluginMarketSkeleton /> : sections.length === 0 ? <FeedbackEmpty title="暂无内容" /> : (
      <>
        {sections.map((section) => (
          <section
            key={section.value}
            aria-label={section.label}
            data-plugin-category-section={section.value}
            className="webui-plugin-market-section"
          >
            <h2 className="webui-plugin-market-heading">{section.label}</h2>
            <PluginRowList className="webui-plugin-grid">
              {section.rows.slice(0, section.value === "featured" ? MARKET_PREVIEW_COUNT : undefined).map((row, index) => (
                <PluginMarketCard area={area} row={row} index={index} onIntent={onIntent} key={`${area}-${section.value}-${row.name || index}`} />
              ))}
              {section.value === "featured" && section.rows.length > MARKET_PREVIEW_COUNT ? (
                <WebuiDisclosure
                  id={expandedListId}
                  open={showAll}
                  mountOnOpen
                  className="webui-plugin-grid webui-plugin-expanded-list"
                  data-testid="webui-plugin-expanded-list"
                >
                  {section.rows.slice(MARKET_PREVIEW_COUNT).map((row, index) => (
                    <PluginMarketCard area={area} row={row} index={index + MARKET_PREVIEW_COUNT} onIntent={onIntent} key={`${area}-featured-expanded-${row.name || index}`} />
                  ))}
                </WebuiDisclosure>
              ) : null}
            </PluginRowList>
            {section.value === "featured" && !hideToggle && section.rows.length > MARKET_PREVIEW_COUNT ? (
              <WebuiButton
                variant="quiet-secondary"
                size="content"
                className="webui-plugin-show-all"
                aria-expanded={showAll}
                aria-controls={expandedListId}
                onClick={onToggleAll}
              >
                {showAll ? `收起${noun}` : marketTotal === null ? `查看全部${noun}` : `查看全部 ${marketTotal} 个`}
              </WebuiButton>
            ) : null}
          </section>
        ))}
      </>
    );
  }
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
