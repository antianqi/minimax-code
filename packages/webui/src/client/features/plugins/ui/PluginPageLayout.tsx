import type { ReactElement, ReactNode } from "react";
import { IconSearch } from "@tabler/icons-react";
import { WebuiSearchField } from "../../../ui/field.js";

export interface PluginPageLayoutProps {
  readonly categories?: ReactNode;
  readonly searchLabel?: string;
  readonly query?: string;
  readonly onQueryChange?: (query: string) => void;
  readonly children: ReactNode;
}

/** Shared fixed category and search controls beside a scrollable content frame. */
export function PluginPageLayout({
  categories,
  searchLabel,
  query = "",
  onQueryChange,
  children,
}: PluginPageLayoutProps): ReactElement {
  return (
    <div className={`webui-plugin-page-layout${categories ? " has-categories" : ""}`}>
      {categories ? <aside className="webui-plugin-page-categories">{categories}</aside> : null}
      <div className="webui-plugin-page-main">
        <div className="webui-plugin-page-controls">
          {searchLabel && onQueryChange ? (
            <div className="webui-plugin-page-search">
              <WebuiSearchField
                icon={<IconSearch size={18} stroke={1.5} />}
                label={searchLabel}
                placeholder={`${searchLabel}...`}
                value={query}
                onChange={(event) => onQueryChange(event.currentTarget.value)}
              />
            </div>
          ) : null}
        </div>
        <main className="webui-plugin-page-scroll">
          <div className="webui-plugin-page-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
