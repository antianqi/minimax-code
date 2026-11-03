// The account page's icons.
//
// The account page is drawn with five glyphs — share, info, refresh, download
// and close. Their path data is the icon set's own rather than an
// approximation, because the account page is meant to look like the product's
// own account page.

import { IconDownload, IconInfoCircle, IconRefresh, IconShare3 } from "@tabler/icons-react";
import type { ReactElement } from "react";

/** The account page's "share" action. */
export function AccountUsageShareIcon({
  size = 20,
}: {
  readonly size?: number;
}): ReactElement {
  return <IconShare3 aria-hidden="true" size={size} stroke={1.4} />;
}

/** The info hint next to the usage numbers. */
export function AccountUsageInfoIcon({
  size = 16,
}: {
  readonly size?: number;
}): ReactElement {
  return <IconInfoCircle aria-hidden="true" size={size} stroke={1.3} />;
}

/** The account page's "retry" action. */
export function AccountUsageRefreshIcon({
  size = 20,
}: {
  readonly size?: number;
}): ReactElement {
  return <IconRefresh aria-hidden="true" size={size} stroke={1.3} />;
}

/** The share image's "save" action. */
export function AccountUsageDownloadIcon({
  size = 20,
}: {
  readonly size?: number;
}): ReactElement {
  return <IconDownload aria-hidden="true" size={size} stroke={1.3} />;
}
