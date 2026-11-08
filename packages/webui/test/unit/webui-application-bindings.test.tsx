// Smoke tests for the React bindings.
//
// The bindings are the only place the application layer is allowed to touch
// React. These cases prove two properties from the component side: a component
// reads the application snapshot through the hook
// (it holds no store writer and no map of its own), and rendering components
// never opens another process-event channel — the coordinator remains the
// channel's sole consumer.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { createWebuiApplication } from "../../src/client/application/create-application.js";
import { createWebuiSessionStore } from "../../src/client/application/session-store.js";
import { createWebuiStoreSelection, selectWebuiSessionStream } from "../../src/client/application/selectors.js";
import { reduceWebuiStreamFrame } from "../../src/client/features/turn/projection/stream-state.js";
import type { WebuiProcessEventChannel } from "../../src/client/features/turn/application/event-channel.js";
import type { WebuiRuntimeEvent } from "../../src/shared/contracts/stream.js";
import type {WebuiClientSessionResumer} from "../../src/client/features/turn/contracts/execution-port.js";
import {
  WebuiApplicationProvider,
  useWebuiSessionStoreSnapshot,
} from "../../src/client/bindings/application-context.js";
import {
  useWebuiSessionState,
  useWebuiSessionStream,
} from "../../src/client/bindings/use-session-state.js";

function makeChannel() {
  const listeners = new Set<(event: WebuiRuntimeEvent) => void>();
  const channel: WebuiProcessEventChannel = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { channel, listenerCount: () => listeners.size };
}

function makeApplication() {
  const fake = makeChannel();
  const application = createWebuiApplication({
    openEventChannel: () => fake.channel,
    turns: {
      resumeSession: (async () => {}) as unknown as WebuiClientSessionResumer,
    },
  });
  application.start();
  return { application, channel: fake };
}

function Consumer({ sessionId }: { readonly sessionId: string }) {
  const snapshot = useWebuiSessionStoreSnapshot();
  const sending = useWebuiSessionState(sessionId).sending;
  const stream = useWebuiSessionStream(sessionId);
  return (
    <span>
      {`sessions:${snapshot.sessions.size} sending:${String(sending)} messages:${stream.messages.length}`}
    </span>
  );
}

describe("the React bindings", () => {
  it("delivers text chunks to the transcript without notifying progress or composer context readers", () => {
    const store = createWebuiSessionStore();
    let textUpdates = 0;
    let progressUpdates = 0;
    let contextUpdates = 0;
    const text = createWebuiStoreSelection(store, (snapshot) => selectWebuiSessionStream(snapshot, "S"));
    const progress = createWebuiStoreSelection(store, (snapshot) => selectWebuiSessionStream(snapshot, "S").workspaceProgress);
    const context = createWebuiStoreSelection(store, (snapshot) => selectWebuiSessionStream(snapshot, "S").contextUsage);
    const off = [text.subscribe(() => { textUpdates += 1; }), progress.subscribe(() => { progressUpdates += 1; }), context.subscribe(() => { contextUpdates += 1; })];
    const writer = store.createSessionWriter({ kind: "session", sessionId: "S" });
    for (let index = 0; index < 50; index += 1) writer.setStream((stream) => reduceWebuiStreamFrame(stream, {
      dataJson: JSON.stringify({ type: "agent_message_chunk", agent_message_chunk: { msg_id: "reply", msg_content: "a" } }),
    }));
    expect(textUpdates).toBe(50);
    expect(text.getSnapshot().messages[0]?.answer).toBe("a".repeat(50));
    expect(progressUpdates).toBe(0);
    expect(contextUpdates).toBe(0);
    for (const unsubscribe of off) unsubscribe();
    store.dispose();
  });
  it("notifies a stream reader only when its own session stream changes", () => {
    const store = createWebuiSessionStore();
    const selection = createWebuiStoreSelection(store, (snapshot) => selectWebuiSessionStream(snapshot, "A"));
    let notifications = 0;
    const unsubscribe = selection.subscribe(() => { notifications += 1; });
    const initial = selection.getSnapshot();
    store.updateSession("B", (current) => ({ ...current, sending: true }));
    store.updateSession("A", (current) => ({ ...current, sending: true }));
    store.select("B");
    expect(selection.getSnapshot()).toBe(initial);
    expect(notifications).toBe(0);
    store.updateSession("A", (current) => ({ ...current, stream: { ...current.stream, phase: "waiting" } }));
    expect(notifications).toBe(1);
    expect(selection.getSnapshot().phase).toBe("waiting");
    unsubscribe();
    store.updateSession("A", (current) => ({ ...current, stream: { ...current.stream, phase: "done" } }));
    expect(notifications).toBe(1);
    store.dispose();
  });
  it("reads the application snapshot through the hook", () => {
    const { application } = makeApplication();
    application.store.updateSession("s1", (current) => ({
      ...current,
      sending: true,
      stream: {
        ...current.stream,
        messages: [{ id: "m1", answer: "hi", thinking: "" }],
      },
    }));

    const html = renderToStaticMarkup(
      <WebuiApplicationProvider application={application}>
        <Consumer sessionId="s1" />
      </WebuiApplicationProvider>,
    );

    expect(html).toContain("sessions:1");
    expect(html).toContain("sending:true");
    expect(html).toContain("messages:1");
  });

  it("renders components without opening another channel", () => {
    const { application, channel } = makeApplication();
    expect(channel.listenerCount()).toBe(1);
    for (let i = 0; i < 3; i += 1) {
      renderToStaticMarkup(
        <WebuiApplicationProvider application={application}>
          <Consumer sessionId="s1" />
        </WebuiApplicationProvider>,
      );
    }
    // Still exactly one: components subscribe to the application snapshot, not
    // to the raw process-event channel.
    expect(channel.listenerCount()).toBe(1);
  });
});
