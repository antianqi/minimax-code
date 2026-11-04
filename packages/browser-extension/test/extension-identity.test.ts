// What this extension is, and what a host has to be told about it.
//
// The extension knows its own id and the host does not, and the host is the
// party that decides whether an extension may connect. So the id has to
// travel, and the two builds travel differently: a published build's id is
// fixed by the store's key and the released host already knows it, while a
// local build's id depends on the folder it was loaded from and has to be
// told to a development host.

import { describe, expect, it } from "vitest";

import {
  webuiBrowserBridgeBrowserName,
  webuiBrowserBridgeBuildKind,
  webuiBrowserBridgeDevelopmentAllowlistLine,
  webuiBrowserBridgeDevelopmentAllowlistVariable,
} from "../src/extension-identity.js";

describe("the extension's own identity", () => {
  it("calls a build carrying the store's public key published and one without local", () => {
    expect(webuiBrowserBridgeBuildKind({ key: "MIIBIjANBgkq" })).toBe("published");
    expect(webuiBrowserBridgeBuildKind({})).toBe("local");
    expect(webuiBrowserBridgeBuildKind({ key: "" })).toBe("local");
    expect(webuiBrowserBridgeBuildKind({ key: 42 })).toBe("local");
  });

  it("names the variable a development host reads for each browser", () => {
    expect(webuiBrowserBridgeDevelopmentAllowlistVariable("edge")).toBe(
      "MAVIS_BROWSER_EDGE_EXTENSION_IDS",
    );
    expect(webuiBrowserBridgeDevelopmentAllowlistVariable("chrome")).toBe(
      "MAVIS_BROWSER_CHROME_EXTENSION_IDS",
    );
  });

  it("gives the whole setting rather than the id on its own", () => {
    // A host reads a list of ids from a named variable, so a person who
    // copies the id alone still has to know which variable it belongs in
    // and which browser it belongs to.
    expect(
      webuiBrowserBridgeDevelopmentAllowlistLine(
        "edge",
        "mdbfmgllfnkmfambfjjnfchmhkphiggk",
      ),
    ).toBe(
      "MAVIS_BROWSER_EDGE_EXTENSION_IDS=mdbfmgllfnkmfambfjjnfchmhkphiggk",
    );
    expect(webuiBrowserBridgeDevelopmentAllowlistLine("chrome", "abc")).toBe(
      "MAVIS_BROWSER_CHROME_EXTENSION_IDS=abc",
    );
  });

  it("tells Edge from Chrome by the user agent", () => {
    expect(
      webuiBrowserBridgeBrowserName(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Edg/120.0.0.0",
      ),
    ).toBe("edge");
    expect(
      webuiBrowserBridgeBrowserName(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0",
      ),
    ).toBe("chrome");
  });
});
