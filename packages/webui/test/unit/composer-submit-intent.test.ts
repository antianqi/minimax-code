// The composer's outbound turn request, as data.
//
// The rules pinned here are the ones that used to be spread across two closures
// in the component: which fields travel at all, which travel only when the
// reader asked for them, and what a model picked on home does to the session a
// submission creates. The controller's behaviour is not re-implemented — this
// asserts the intent the composer hands it.

import { describe, expect, it } from "vitest";

import { buildWebuiComposerSubmitIntent } from "../../src/client/features/composer/projection/submit-intent.js";
import type { WebuiModelSelectionRequest } from "../../src/client/features/models/contracts/model-view.js";

const ATTACHMENTS = [
  {
    meta: { attachmentType: "image" as const, fileName: "shot.png", mimeType: "image/png", sizeBytes: 3 },
    local: { dataUrl: "data:image/png;base64,AAAA" },
  },
];

/** The fields every submission carries, so each test states only its own. */
const BASE = {
  draft: "把这两张图对比一下",
  attachments: ATTACHMENTS,
  sending: false,
  planMode: false,
  goalEnabled: true,
  agentName: "main",
  teamModeOff: false,
} as const;

const HOME_SELECTION: WebuiModelSelectionRequest = {
  sessionId: undefined,
  modelId: "m1",
  provider: "p",
} as unknown as WebuiModelSelectionRequest;

describe("buildWebuiComposerSubmitIntent", () => {
  it("keeps an absent optional field absent rather than undefined on the wire", () => {
    const intent = buildWebuiComposerSubmitIntent(BASE);
    expect(Object.keys(intent).sort()).toEqual([
      "agentName",
      "attachments",
      "draft",
      "goalEnabled",
      "planMode",
      "sending",
    ]);
    // The draft is what the reader typed plus the references, and it is the
    // only text field: a submission with no command still sends the text.
    expect(intent.draft).toBe(BASE.draft);
    expect(intent.attachments).toBe(ATTACHMENTS);
    expect(intent.teamModeOff).toBeUndefined();
    expect(intent.createSessionWorkspaceDir).toBeUndefined();
    expect(intent.prepareCreatedSession).toBeUndefined();
    expect(intent.onSessionCreated).toBeUndefined();
  });

  it("carries the workspace and the team choice only when they are asked for", () => {
    const intent = buildWebuiComposerSubmitIntent({
      ...BASE,
      createSessionWorkspaceDir: "/work/project",
      teamModeOff: true,
    });
    expect(intent.createSessionWorkspaceDir).toBe("/work/project");
    expect(intent.teamModeOff).toBe(true);
  });

  it("carries a command and its body, including an empty body", () => {
    const withBody = buildWebuiComposerSubmitIntent({
      ...BASE,
      commandMatch: { name: "review", paletteSection: "builtin" } as never,
      commandInvocationInput: "diff only",
    });
    expect(withBody.commandMatch).toEqual({ name: "review", paletteSection: "builtin" });
    expect(withBody.commandInvocationInput).toBe("diff only");
    // `/review` typed with nothing after it sends an empty body, not an absent
    // one: the runtime distinguishes "the command ran" from "the command ran
    // with an argument".
    const emptyBody = buildWebuiComposerSubmitIntent({
      ...BASE,
      commandMatch: { name: "review", paletteSection: "builtin" } as never,
      commandInvocationInput: "",
    });
    expect(emptyBody.commandInvocationInput).toBe("");
    // A plain message names no command at all.
    const plain = buildWebuiComposerSubmitIntent({ ...BASE, commandInvocationInput: undefined });
    expect("commandMatch" in plain).toBe(false);
    expect("commandInvocationInput" in plain).toBe(false);
  });

  it("applies a model picked on home to the session the submission creates", async () => {
    const applied: Array<{ request: WebuiModelSelectionRequest; createdSessionId: string }> = [];
    const intent = buildWebuiComposerSubmitIntent({
      ...BASE,
      pendingHomeModelSelection: HOME_SELECTION,
      prepareModelSelection: async (request, createdSessionId) => {
        applied.push({ request, createdSessionId });
      },
    });
    expect(intent.prepareCreatedSession).toBeTypeOf("function");
    await intent.prepareCreatedSession!("session-created");
    expect(applied).toEqual([{ request: HOME_SELECTION, createdSessionId: "session-created" }]);
    // What this pins: the builder hands the captured request through unchanged
    // and passes the created session's id beside it. The surface is what merges
    // the id into the request (`{ ...request, sessionId: createdSessionId }`)
    // before calling the models owner — that merge is not exercised here. Its
    // evidence is the submission path itself, not this test.
    expect(applied[0]!.request).toBe(HOME_SELECTION);
  });

  it("stops the submission when the model cannot be applied, and says why", async () => {
    const errors: string[] = [];
    const intent = buildWebuiComposerSubmitIntent({
      ...BASE,
      pendingHomeModelSelection: HOME_SELECTION,
      prepareModelSelection: async () => {
        throw new Error("模型不可用");
      },
      reportError: (message) => errors.push(message),
    });
    // Re-thrown on purpose: a submission that swallowed this would send the
    // turn under whatever model the created session happened to have.
    await expect(intent.prepareCreatedSession!("session-created")).rejects.toThrow("模型不可用");
    expect(errors).toEqual(["模型不可用"]);
  });

  it("prepares nothing when no model was picked on home", () => {
    const intent = buildWebuiComposerSubmitIntent({
      ...BASE,
      prepareModelSelection: async () => undefined,
    });
    expect("prepareCreatedSession" in intent).toBe(false);
  });
});
