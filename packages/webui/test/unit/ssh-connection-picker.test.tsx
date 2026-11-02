/**
 * The add dialog's picker.
 *
 * The claims are about what the picker says:
 *
 *   * a read that is still running says so, and does not claim there is no host;
 *   * a config file with no host is a different answer from a read that failed;
 *   * every host is named with the address it lives at.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SshConnectionPicker } from "../../src/client/features/ssh/ui/ssh-connection-picker.js";
import {
  WEBUI_SSH_DISCOVERING,
  WEBUI_SSH_NO_CANDIDATES,
} from "../../src/client/features/ssh/projection/ssh-panel.js";

const view = (props: Parameters<typeof SshConnectionPicker>[0]): string =>
  renderToStaticMarkup(SshConnectionPicker(props));

describe("the SSH connection picker", () => {
  it("says that it is still reading the configuration", () => {
    const markup = view({ loading: true, onSelect: () => undefined });
    expect(markup).toContain(WEBUI_SSH_DISCOVERING);
    expect(markup).not.toContain(WEBUI_SSH_NO_CANDIDATES);
  });

  it("says that no host was found", () => {
    const markup = view({
      loading: false,
      discovery: { configFound: true, hosts: [] },
      onSelect: () => undefined,
    });
    expect(markup).toContain(WEBUI_SSH_NO_CANDIDATES);
    expect(markup).toContain("data-webui-ssh-no-candidates");
  });

  it("lists every host with the address it lives at", () => {
    const markup = view({
      loading: false,
      discovery: {
        configFound: true,
        hosts: [{ alias: "build", hostname: "build.example.com", user: "builder", port: 2222 }],
      },
      onSelect: () => undefined,
    });
    expect(markup).toContain("build");
    expect(markup).toContain("builder@build.example.com:2222");
    expect(markup).toContain("data-webui-ssh-candidate=\"build\"");
  });

  it("marks the picked host", () => {
    const markup = view({
      loading: false,
      selected: "build",
      discovery: {
        configFound: true,
        hosts: [{ alias: "build", hostname: "build.example.com" }],
      },
      onSelect: () => undefined,
    });
    expect(markup).toContain("checked");
  });
});
