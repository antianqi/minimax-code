/**
 * The host form.
 *
 * The claims are about what the form lets the person do:
 *
 *   * **A saved host's alias is fixed.** The editor shows it as text; a changed alias would
 *     save a second host and leave the first
 *     one behind.
 *   * **A host that is added by hand names itself.** The alias field is the one the person
 *     types, so it stays editable there.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SshHostForm } from "../../src/client/features/ssh/ui/ssh-host-form.js";

// The form keeps state, so it is rendered as an element: calling the component function on its
// own would run its hooks outside a render.
const view = (props: Parameters<typeof SshHostForm>[0]): string =>
  renderToStaticMarkup(createElement(SshHostForm, props));

/** The markup of the alias field, which is the one that carries the read-only state. */
function aliasField(markup: string): string {
  const start = markup.indexOf('data-webui-ssh-field="alias"');
  return start < 0 ? "" : markup.slice(start - 400, start + 400);
}

describe("the SSH host form", () => {
  it("fixes the alias of a host being edited", () => {
    const markup = view({
      onSubmit: () => undefined,
      onCancel: () => undefined,
      initial: { alias: "textvision.top", hostname: "textvision.top", port: 54751 },
    });
    expect(aliasField(markup)).toContain('value="textvision.top"');
    expect(aliasField(markup)).toContain("readonly");
  });

  it("lets the person name a host they are adding", () => {
    const markup = view({ onSubmit: () => undefined, onCancel: () => undefined });
    expect(aliasField(markup)).not.toContain("readonly");
  });
});
