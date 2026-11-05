// The host this page was reached at.
//
// The page's own address is the one fact a browser holds and the server does
// not: a service bound to a wildcard address cannot know which of the
// machine's addresses the person reached it on, and the reader's own
// loopback interface is not the server's.

export function pageHostname(): string {
  if (typeof window === "undefined") return "";
  return window.location?.hostname ?? "";
}
