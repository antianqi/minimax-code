// The composer's goal and plan input modes, through the controls a reader uses.
//
// These transitions are what the composer's goal-mode binding took over from the
// component: entering a mode from the draft, the two modes excluding each other,
// the banner's edit affordance (objective into the draft, caret at its end), and
// the cancel rule — leaving goal mode clears the draft only when it came from
// that edit affordance or when the session holds no goal.
//
// Every step types into, or clicks, the real control: the textarea the composer
// renders, the mode pills in its toolbar, and the banner's edit button. The
// assertions are about the composer's own state afterward (pill present, draft
// contents, placeholder, focus and caret), not about test ids existing.

import { expect } from "@playwright/test";
import { configureFixture, openApp, test } from "./harness.mjs";

/** Answer `isGoalEnabled` with `true` and `getGoal` from the seeded record.
 *
 *  The fixture answers `isGoalEnabled` with `false`, which keeps goal mode
 *  switched off everywhere; without this the pill can never activate and the
 *  flow under test would be unreachable.
 *
 *  The seed is written as a literal: `configureFixture` serialises this
 *  function's source into the page, so it may only name browser globals. */
function controlGoalCapability() {
  window.__testGoals = {
    A: {
      sessionId: "A",
      goalId: "g-A",
      objective: "A 的目标",
      status: "active",
      tokensUsed: 10,
      turnsUsed: 2,
      timeUsedSeconds: 30,
      updatedAt: 1_700_000_100_000,
    },
  };
  const Base = window.WebSocket;
  window.WebSocket = class extends Base {
    send(serialized) {
      let frame;
      try { frame = JSON.parse(serialized); } catch { return super.send(serialized); }
      if (frame?.operation === "isGoalEnabled") {
        this.emit("message", { data: JSON.stringify({ protocolVersion: 1, kind: "response", requestId: frame.requestId, body: { enabled: true } }) });
        return undefined;
      }
      if (frame?.operation === "getGoal") {
        this.emit("message", { data: JSON.stringify({ protocolVersion: 1, kind: "response", requestId: frame.requestId, body: window.__testGoals[frame.body?.sessionId] }) });
        return undefined;
      }
      return super.send(serialized);
    }
  };
}

/** The same capability with no goal in the session: enabled, but nothing kept. */
function controlGoalCapabilityWithoutGoal() {
  window.__testGoals = {};
  const Base = window.WebSocket;
  window.WebSocket = class extends Base {
    send(serialized) {
      let frame;
      try { frame = JSON.parse(serialized); } catch { return super.send(serialized); }
      if (frame?.operation === "isGoalEnabled") {
        this.emit("message", { data: JSON.stringify({ protocolVersion: 1, kind: "response", requestId: frame.requestId, body: { enabled: true } }) });
        return undefined;
      }
      if (frame?.operation === "getGoal") {
        this.emit("message", { data: JSON.stringify({ protocolVersion: 1, kind: "response", requestId: frame.requestId }) });
        return undefined;
      }
      return super.send(serialized);
    }
  };
}

const input = (page) => page.locator("[data-webui-composer-input]");

/** Type a draft the way a reader does: one keystroke at a time.
 *
 *  The composer reads its own draft-change rule per edit, so a single
 *  programmatic `fill` is not equivalent to typing — the mode transitions below
 *  are keyed on the value the last keystroke leaves behind. */
async function typeDraft(page, text) {
  await input(page).click();
  await input(page).pressSequentially(text, { delay: 25 });
}
const goalPill = (page) => page.getByTestId("composer-goal-mode");
const planPill = (page) => page.getByTestId("composer-plan-mode");

const composerState = (page) =>
  page.evaluate(() => {
    const textarea = document.querySelector("[data-webui-composer-input]");
    return {
      value: textarea ? textarea.value : null,
      placeholder: textarea ? textarea.placeholder : null,
      focused: document.activeElement === textarea,
      caret: textarea ? textarea.selectionStart : null,
    };
  });

test("typing /goal enters goal mode and clears the draft it was entered from", async ({ page }) => {
  await configureFixture(page, controlGoalCapability);
  await openApp(page, "#session=A");
  // The session's goal read has landed: nothing else is about to re-render the
  // composer out from under the draft typed below.
  await expect(page.getByTestId("thread-goal-banner-objective")).toHaveText("A 的目标");

  await typeDraft(page, "/goal");
  await expect(goalPill(page)).toBeVisible();
  // The mode owns the draft: the token that entered it is not a message.
  await expect.poll(() => composerState(page)).toMatchObject({ value: "", placeholder: "描述你想完成的目标" });
  await expect(planPill(page)).toHaveCount(0);
});

test("goal and plan modes exclude each other whichever is entered last", async ({ page }) => {
  // A session that holds no goal: a session WITH an active goal starts its
  // composer in goal mode (the goal re-read sets the mode), which would hide
  // the transition this test is about.
  await configureFixture(page, controlGoalCapabilityWithoutGoal);
  await openApp(page, "#session=A");
  await expect(goalPill(page)).toHaveCount(0);

  // Plan mode is entered by running the command, so the palette is closed with a
  // trailing space and Enter submits it — the same door the toolbar's own plan
  // row uses.
  await input(page).click();
  await input(page).fill("/plan ");
  await input(page).press("Enter");
  await expect(planPill(page)).toBeVisible();
  await expect(goalPill(page)).toHaveCount(0);
  await expect.poll(() => composerState(page)).toMatchObject({ placeholder: "描述需要规划的任务..." });

  await typeDraft(page, "/goal");
  await expect(goalPill(page)).toBeVisible();
  await expect(planPill(page)).toHaveCount(0);
  await expect.poll(() => composerState(page)).toMatchObject({ value: "", placeholder: "描述你想完成的目标" });
});

test("leaving goal mode keeps a draft typed by hand while the session holds a goal", async ({ page }) => {
  await configureFixture(page, controlGoalCapability);
  await openApp(page, "#session=A");
  await expect(page.getByTestId("thread-goal-banner-objective")).toHaveText("A 的目标");

  await typeDraft(page, "/goal");
  await expect(goalPill(page)).toBeVisible();
  await input(page).fill("保留这段草稿");

  await goalPill(page).click();
  await expect(goalPill(page)).toHaveCount(0);
  // No edit took place, and the session has a goal to keep, so the words the
  // reader typed stay in the box.
  await expect.poll(() => composerState(page)).toMatchObject({ value: "保留这段草稿" });
});

test("leaving goal mode clears the draft when the session holds no goal", async ({ page }) => {
  await configureFixture(page, controlGoalCapabilityWithoutGoal);
  await openApp(page, "#session=A");
  await expect(page.getByTestId("thread-goal-banner")).toHaveCount(0);

  await typeDraft(page, "/goal");
  await expect(goalPill(page)).toBeVisible();
  await input(page).fill("临时草稿");

  await goalPill(page).click();
  await expect(goalPill(page)).toHaveCount(0);
  // Nothing was being edited and there is no goal to fall back to, so the draft
  // belongs to the abandoned mode.
  await expect.poll(() => composerState(page)).toMatchObject({ value: "" });
});

test("the banner's edit affordance loads the objective into the composer and cancel drops it", async ({ page }) => {
  await configureFixture(page, controlGoalCapability);
  await openApp(page, "#session=A");

  await page.getByTestId("thread-goal-banner-edit-button").click();
  await expect(goalPill(page)).toBeVisible();
  await expect(planPill(page)).toHaveCount(0);
  // The objective is the draft, the caret is at its end, and the textarea has
  // the focus: the reader continues writing where the objective stopped.
  await expect.poll(() => composerState(page)).toMatchObject({
    value: "A 的目标",
    caret: "A 的目标".length,
    focused: true,
  });

  await goalPill(page).click();
  await expect(goalPill(page)).toHaveCount(0);
  // This draft came from the edit affordance, so leaving the mode drops it —
  // even though the session does hold a goal.
  await expect.poll(() => composerState(page)).toMatchObject({ value: "" });
});
