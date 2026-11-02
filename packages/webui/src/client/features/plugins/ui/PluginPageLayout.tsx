import type { ReactElement, ReactNode } from "react";
import { IconSearch } from "@tabler/icons-react";
import { WebuiSearchBox } from "../../../ui/field.js";

export interface PluginPageLayoutProps {
  readonly categories?: ReactNode;
  readonly searchLabel?: string;
  readonly query?: string;
  readonly onQueryChange?: (query: string) => void;
  readonly children: ReactNode;
}

/** Shared top search, horizontal category navigation and centered plugin content frame. */
export function PluginPageLayout({
  categories,
  searchLabel,
  query = "",
  onQueryChange,
  children,
}: PluginPageLayoutProps): ReactElement {
  return (
    <div className="webui-plugin-page-layout">
      <div className="webui-plugin-page-controls">
        {searchLabel && onQueryChange ? (
          <div className="webui-plugin-page-search">
            <WebuiSearchBox
              icon={<IconSearch size={18} stroke={1.5} />}
              label={searchLabel}
              placeholder={`${searchLabel}...`}
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
            />
          </div>
        ) : null}
        {categories ? <div className="webui-plugin-page-categories">{categories}</div> : null}
      </div>
      <main className="webui-plugin-page-main">
        <div className="webui-plugin-page-content">{children}</div>
      </main>
    </div>
  );
}
