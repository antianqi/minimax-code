// The remote page uses the shared segmented-control track while retaining radio semantics
// for its two destinations. The shell owns the active tab and supplies its matching body;
// this page owns neither the remote-control nor IM-connect business state.
import { useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { WebuiSegmentedControl } from "../../../ui/segmented-control.js";

import {
  WEBUI_REMOTE_TABS,
  type WebuiRemoteTabValue,
} from "../contracts/remote-page.js";
import {
  webuiRemoteTabLabel,
  type WebuiRemoteOwner,
  type WebuiRemoteSnapshot,
} from "../application/remote-owner.js";
import { PanelFrame } from "../../../ui/content-page.js";

export interface RemotePageViewProps {
  readonly activeTab: WebuiRemoteTabValue;
  readonly onSelectTab: (value: WebuiRemoteTabValue) => void;
  /** The body of the tab that is showing. */
  readonly children: ReactNode;
}

/**
 * The pure render of the page.
 *
 * Separate from the wrapper so the markup is assertable with `renderToStaticMarkup` — this
 * package has no jsdom.
 */
export function RemotePageView({
  activeTab,
  onSelectTab,
  children,
}: RemotePageViewProps): ReactElement {
  return (
    <PanelFrame
      ariaLabel="远程"
      testId="remote-page"
      dataAttributes={{ "data-webui-component": "remote-page" }}
      className="min-w-0 flex-1"
      scroll={false}
      bodyClassName="min-h-0 flex-1"
      headerMotion="disclosure"
      headerClassName="flex h-[46px] min-w-0 shrink-0 items-center justify-between gap-3 py-2 pr-2 pl-2"
      header={
        <>
        <WebuiSegmentedControl
          mode="radio"
          variant="page-header"
          ariaLabel="远程"
          testId="remote-page-tabs"
          itemTestIdPrefix="remote-page-tab"
          className="scrollbar-hide min-w-0 max-w-full overflow-x-auto"
          options={WEBUI_REMOTE_TABS}
          value={activeTab}
          onChange={onSelectTab}
        />
        </>
      }
    >
      {children}
    </PanelFrame>
  );
}

export interface RemotePageProps {
  readonly owner: WebuiRemoteOwner;
  /** The body of the page, for the state the owner is in. */
  readonly render: (snapshot: WebuiRemoteSnapshot) => ReactNode;
}

/**
 * The page: the switcher, subscribed to its owner.
 *
 * The owner holds the two facts the page needs — which tab is showing, and
 * whether the SSH surface has taken the body. The two tab bodies keep their own
 * state; the switcher does not own them.
 */
export function RemotePage({ owner, render }: RemotePageProps): ReactElement {
  const snapshot = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getSnapshot,
  );
  return (
    <RemotePageView
      activeTab={snapshot.activeTab}
      onSelectTab={(value) => owner.selectTab(value)}
    >
      {render(snapshot)}
    </RemotePageView>
  );
}

export { webuiRemoteTabLabel };
