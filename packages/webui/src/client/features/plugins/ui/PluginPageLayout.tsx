import type { ReactElement, ReactNode } from "react";
import { IconSearch } from "@tabler/icons-react";
import { WebuiSearchField } from "../../../ui/field.js";

export interface PluginPageLayoutProps {
  readonly sidebar?: ReactNode;
  readonly searchLabel?: string;
  readonly query?: string;
  readonly onQueryChange?: (query: string) => void;
  readonly children: ReactNode;
}

/** Shared category rail, top search and centered content frame for plugin pages. */
export function PluginPageLayout({
  sidebar,
  searchLabel,
  query = "",
  onQueryChange,
  children,
}: PluginPageLayoutProps): ReactElement {
  return (
    <div className={`webui-plugin-page-layout${sidebar ? " has-sidebar" : ""}`}>
      {sidebar ? <aside className="webui-plugin-page-sidebar">{sidebar}</aside> : null}
      <main className="webui-plugin-page-main">
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
        <div className="webui-plugin-page-content">{children}</div>
      </main>
    </div>
  );
}
