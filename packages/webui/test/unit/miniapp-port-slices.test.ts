// The Mini App business's port slice, at the one seam a page channel can vanish through.
//
// `WebuiMiniAppPortSlice` is a `Pick`, so the type says every member exists. The runtime
// builds the slice by copying a key list, so a member named in the type and missing from
// the list is `undefined` at runtime — and the failure surfaces far away, as a page call
// that answers `capability_unavailable` while the page's own capability list says the
// channel is there. That is exactly the shape a shipped Mini App reported: its task list
// could not read anything although the channel advertised itself.
//
// One assertion per channel is enough: the point is that the list and the type agree, not
// that any particular channel does something.

import { describe, expect, it } from "vitest";

import { createWebuiPortSlices } from "../../src/client/application/port-slices.js";

/** Every key answers a function, which is all a slice cut needs from its source. */
function source(): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get: () => () => undefined,
      has: () => true,
    },
  );
}

const PAGE_CHANNELS = [
  "watchMiniAppAgentTurn",
  "watchMiniAppAgentObservations",
  "miniAppAgentCall",
  "watchMiniAppToolApprovals",
  "replyMiniAppToolApproval",
  "miniAppToolCall",
] as const;

describe("the Mini App port slice", () => {
  it("carries every page channel its type promises", () => {
    const slices = createWebuiPortSlices(source() as never);
    const miniapp = slices.miniapp as unknown as Record<string, unknown>;

    for (const name of PAGE_CHANNELS) {
      expect(typeof miniapp[name], `${name} is missing from MINIAPP_KEYS`).toBe("function");
    }
  });

  it("still carries the capabilities the business started with", () => {
    const slices = createWebuiPortSlices(source() as never);
    const miniapp = slices.miniapp as unknown as Record<string, unknown>;

    for (const name of ["listMiniApps", "openMiniApp", "stopMiniApp", "watchMiniAppPresentation"]) {
      expect(typeof miniapp[name]).toBe("function");
    }
  });
});
