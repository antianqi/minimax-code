// The shared client id helper.
//
// `crypto.randomUUID` only exists in a secure context, so a page served over
// plain HTTP on a LAN address — the shape ADR 0031 makes possible — has to get
// its request ids from somewhere else. These cases pin that fallback: without
// it the client throws "crypto.randomUUID is not a function" before it can
// render anything.

import { afterEach, describe, expect, it, vi } from "vitest";

import { randomId } from "../../src/shared/random-id.js";

describe("the shared client id", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses crypto.randomUUID where the context has one", () => {
    const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555");
    vi.stubGlobal("crypto", {
      randomUUID,
      getRandomValues: () => {
        throw new Error("randomUUID is available; getRandomValues must not be used");
      },
    });
    expect(randomId()).toBe("11111111-2222-4333-8444-555555555555");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("builds a version 4 id from getRandomValues where randomUUID is absent", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (array: Uint8Array) => {
        array.fill(7);
        return array;
      },
    });
    expect(randomId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("keeps two ids apart", () => {
    const ids = new Set(Array.from({ length: 50 }, () => randomId()));
    expect(ids.size).toBe(50);
  });
});
