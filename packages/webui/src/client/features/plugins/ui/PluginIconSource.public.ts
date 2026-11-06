/** Resolve plugin icon URLs against the asset route exposed by the WebUI host. */
export function webuiPluginIconSource(iconUrl: string | undefined): string | undefined {
  if (!iconUrl) return undefined;
  try {
    const url = new URL(iconUrl, window.location.origin);
    if (url.pathname !== "/mavis/api/file/preview") return iconUrl;
    const token = (window as Window & { __WEBUI_CONFIG__?: { token?: string } }).__WEBUI_CONFIG__?.token;
    // An empty token is valid in full-access and development modes.
    if (typeof token !== "string") return undefined;
    const iconPath = url.searchParams.get("path");
    if (!iconPath) return undefined;
    const separator = Math.max(iconPath.lastIndexOf("/"), iconPath.lastIndexOf("\\"));
    const filename = iconPath.slice(separator + 1);
    if (separator < 0 || !filename) return undefined;
    const directory = separator === 0
      ? iconPath.slice(0, 1)
      : separator === 2 && iconPath[1] === ":"
        ? iconPath.slice(0, separator + 1)
        : iconPath.slice(0, separator);
    const icon = new URL("/workspace-file", window.location.origin);
    if (token) icon.searchParams.set("token", token);
    icon.searchParams.set("dir", directory);
    icon.searchParams.set("path", filename);
    return `${icon.pathname}${icon.search}`;
  } catch {
    return undefined;
  }
}
