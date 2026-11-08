// The field contract (ADR 0028 § Shared contracts, #288).
//
// What a field promises is a wiring claim, and wiring is exactly what a rendered
// string can show: the label points at the control, the description and the error
// are reachable from it, and the error says so with `aria-invalid`. The browser
// check next door covers what a string cannot — that the focus ring is visible
// and the error is announced when it appears.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  clampWebuiSelectIndex,
  reduceWebuiSelectKeyboard,
  WebuiField,
  WebuiFormActions,
  WebuiFormLayout,
  WebuiSearchField,
  WebuiSelectMenu,
  type FieldControlProps,
} from "../../src/client/ui/field.js";

const input = (props: FieldControlProps) => createElement("input", { ...props });

function render(field: Parameters<typeof WebuiField>[0]): string {
  return renderToStaticMarkup(createElement(WebuiField, field));
}

describe("the field contract", () => {
  it("associates the label with the control", () => {
    const html = render({ label: "API Key", control: input });
    const controlId = /<input[^>]*\bid="([^"]+)"/u.exec(html)?.[1];
    expect(controlId).toBeTruthy();
    expect(html).toContain(`<label class="webui-field-label" id="`);
    expect(html).toMatch(new RegExp(`for="${controlId}"`, "u"));
  });

  it("makes a description reachable from the control", () => {
    const html = render({ label: "上下文窗口", description: "留空按供应商默认值处理", control: input });
    const describedBy = /aria-describedby="([^"]+)"/u.exec(html)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`id="${describedBy}"`);
    expect(html).toContain("留空按供应商默认值处理");
    // No error, so the control is not marked invalid.
    expect(html).not.toContain("aria-invalid");
  });

  it("marks the control invalid and describes it with the error", () => {
    const html = render({ label: "API Key", description: "必填", error: "请输入 API Key", control: input });
    expect(html).toContain('aria-invalid="true"');
    const describedBy = /aria-describedby="([^"]+)"/u.exec(html)?.[1] ?? "";
    const ids = describedBy.split(" ");
    expect(ids).toHaveLength(2);
    // The description comes first: what the field is for, then what is wrong.
    expect(html).toContain(`id="${ids[0]}"`);
    expect(html).toContain(`id="${ids[1]}"`);
    expect(html).toContain('role="alert"');
    expect(html).toContain("请输入 API Key");
  });

  it("expresses the same field as a row and as a stack", () => {
    const stacked = render({ label: "API Key", control: input });
    const row = render({ label: "API Key", arrangement: "row", control: input });
    expect(stacked).toContain('class="webui-field webui-field--gap-compact"');
    expect(row).toContain("webui-field webui-field--gap-compact webui-field--row");
    // Both carry the same wiring: the arrangement is where the four sit, not
    // what they are.
    for (const html of [stacked, row]) expect(html).toContain("webui-field-label");
  });

  it("leaves the control to the caller", () => {
    // The contract supplies ids and ARIA and nothing else: no value, no handler,
    // no validation.
    const html = render({ label: "API Key", control: input });
    expect(html).not.toContain("readonly");
    expect(html).toContain("<input");
  });
});

describe("the shared search field", () => {
  it("renders one labelled searchbox with the shared field class", () => {
    const html = renderToStaticMarkup(createElement(WebuiSearchField, {
      label: "搜索变更",
      placeholder: "搜索变更",
      value: "src/client",
      onChange: () => undefined,
      testId: "review-search-input",
    }));

    expect(html).toContain('class="webui-search-field"');
    expect(html).toContain('role="searchbox"');
    expect(html).toContain('aria-label="搜索变更"');
    expect(html).toContain('data-testid="review-search-input"');
    expect(html).toContain('placeholder="搜索变更"');
    expect(html).toContain('value="src/client"');
  });
});

describe("the shared select", () => {
  const options = [
    { value: "stdio", label: "stdio" },
    { value: "http", label: "http" },
    { value: "sse", label: "sse" },
  ];
  const renderSelect = (overrides: Record<string, unknown> = {}): string =>
    renderToStaticMarkup(
      createElement(WebuiSelectMenu, {
        id: "transport",
        labelId: "transport-label",
        options,
        value: "stdio",
        onChange: () => undefined,
        ...overrides,
      }),
    );

  it("is a combobox that owns the focus, and names no option while it is closed", () => {
    const markup = renderSelect();
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-haspopup="listbox"');
    expect(markup).toContain('aria-expanded="false"');
    // The active descendant names an option that exists. While the list is
    // closed there is none, so the attribute is absent rather than dangling.
    expect(markup).not.toContain("aria-activedescendant");
  });

  it("is disabled when the caller disables it", () => {
    expect(renderSelect({ disabled: true })).toContain("disabled");
  });
});

describe("the select's keyboard", () => {
  const closed = { activeIndex: 0, open: false };
  const open = { activeIndex: 0, open: true };

  it("moves the active option with Arrow, Home and End, and opens the list", () => {
    expect(reduceWebuiSelectKeyboard(closed, "ArrowDown", 3, 0)).toEqual({
      activeIndex: 1,
      open: true,
      chosenIndex: undefined,
      handled: true,
    });
    expect(reduceWebuiSelectKeyboard(open, "ArrowDown", 3, 0).activeIndex).toBe(1);
    // The list wraps, so the key after the last option is the first one.
    expect(reduceWebuiSelectKeyboard({ activeIndex: 2, open: true }, "ArrowDown", 3, 0).activeIndex).toBe(0);
    expect(reduceWebuiSelectKeyboard(open, "ArrowUp", 3, 0).activeIndex).toBe(2);
    expect(reduceWebuiSelectKeyboard(open, "Home", 3, 0).activeIndex).toBe(0);
    expect(reduceWebuiSelectKeyboard(open, "End", 3, 0).activeIndex).toBe(2);
  });

  it("opens on Enter and Space, and takes the active option when the list is open", () => {
    const opened = reduceWebuiSelectKeyboard(closed, "Enter", 3, 1);
    expect(opened).toEqual({ activeIndex: 1, open: true, chosenIndex: undefined, handled: true });
    expect(reduceWebuiSelectKeyboard(closed, " ", 3, 1).open).toBe(true);
    const chosen = reduceWebuiSelectKeyboard({ activeIndex: 2, open: true }, "Enter", 3, 1);
    expect(chosen.chosenIndex).toBe(2);
    expect(chosen.open).toBe(false);
    expect(reduceWebuiSelectKeyboard({ activeIndex: 2, open: true }, " ", 3, 1).chosenIndex).toBe(2);
  });

  it("closes on Escape and on Tab, and leaves the focus to the page", () => {
    expect(reduceWebuiSelectKeyboard(open, "Escape", 3, 0).open).toBe(false);
    // Tab leaves the control, and the list closes behind it: nothing in it
    // holds a focus of its own, so an open list would be a floating thing with
    // nothing in it.
    expect(reduceWebuiSelectKeyboard(open, "Tab", 3, 0).open).toBe(false);
  });

  it("answers a key that is none of its business with nothing", () => {
    expect(reduceWebuiSelectKeyboard(closed, "a", 3, 0).handled).toBe(false);
    expect(reduceWebuiSelectKeyboard(closed, "a", 3, 0).activeIndex).toBe(0);
  });

  it("answers an empty list with nothing at all", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "]) {
      const outcome = reduceWebuiSelectKeyboard(closed, key, 0, 0);
      expect(outcome.handled, key).toBe(false);
      expect(outcome.chosenIndex, key).toBeUndefined();
      expect(outcome.open, key).toBe(false);
    }
  });

  it("keeps the active option inside a list that changed under it", () => {
    // The list shrank while it was open: the active option has to come back
    // into it, or the trigger would name an option that is not in the
    // document.
    expect(clampWebuiSelectIndex(5, 3)).toBe(2);
    expect(clampWebuiSelectIndex(5, 0)).toBe(0);
    const outcome = reduceWebuiSelectKeyboard({ activeIndex: 5, open: true }, "ArrowDown", 3, 0);
    expect(outcome.activeIndex).toBe(0);
    expect(outcome.open).toBe(true);
  });
});

describe("the form arrangements", () => {
  it("lays several fields out and keeps the actions separate", () => {
    const layout = renderToStaticMarkup(
      createElement(WebuiFormLayout, null, createElement("span", null, "field")),
    );
    const actions = renderToStaticMarkup(
      createElement(WebuiFormActions, null, createElement("button", { type: "button" }, "保存")),
    );
    expect(layout).toContain('class="webui-form"');
    expect(actions).toContain('class="webui-form-actions"');
  });
});
