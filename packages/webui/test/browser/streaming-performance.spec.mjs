// Streaming-reply responsiveness in the built client.
//
// An agent reply arrives as a sequence of wire frames. Each frame is its own
// browser task, so the client gets one render opportunity per frame — and a
// turn that delivers a few hundred frames gives a few hundred renders. This
// spec measures what that costs the reader.
//
// The metric that matters is the FRAME GAP: how long the main thread stays
// busy between two animation frames. A gap is what the reader sees — a gap of
// 50 ms is one dropped frame at 60 Hz, a gap of 100 ms is a visible stutter.
// So this measures the gap distribution during a streamed reply and asserts
// that the page never drops a frame and never runs a long task.
//
// Two scenarios, because they fail differently:
//   - a short reply in a short conversation (the everyday case);
//   - a long reply in a long conversation (the case where the per-frame work
//     scales with the conversation, and where the reader notices).
//
// The scenario size can be overridden so a sweep can find the breaking point
// without editing the spec: WEBUI_PERF_HISTORY_TURNS and WEBUI_PERF_CHUNKS.

import { expect } from "@playwright/test";

import { openApp, startTurn, test } from "./harness.mjs";

// Keep trace snapshots and screenshot capture outside the measured interval;
// a failure screenshot is taken only after the performance assertions.
test.use({ trace: "off", screenshot: "only-on-failure" });

/** A reply body that exercises the markdown path: prose, a list and a fence. */
function replyChunk(index) {
  return [
    `Paragraph ${index} of the streamed answer, with prose that the markdown lexer has to walk.`,
    "- first list item",
    "- second list item",
    "```ts",
    `export const value${index} = ${index};`,
    "```",
  ].join("\n\n");
}

/** A conversation that already has some history behind the live turn. */
function historyMessages(turns) {
  const messages = [];
  for (let index = 0; index < turns; index += 1) {
    messages.push({
      msgId: `hist-user-${index}`,
      role: "user",
      msgContent: `历史提问 ${index}`,
      timestamp: 1_700_000_000_000 + index * 2_000,
    });
    messages.push({
      msgId: `hist-assistant-${index}`,
      role: "assistant",
      msgContent: `历史回答 ${index}\n\n- 项目一\n- 项目二`,
      thinkingContent: `历史思考 ${index}`,
      timestamp: 1_700_000_000_500 + index * 2_000,
    });
  }
  return messages;
}

/** A frame longer than this is a dropped frame at 60 Hz. */
const JANK_FRAME_MS = 50;
/** A frame longer than this is more than one dropped frame. */
const DROPPED_FRAME_MS = 100;

/**
 * The streaming measurement, run inside the page.
 *
 * Returns the frame-gap distribution the reader sees, plus the main thread's
 * own account of how long it was blocked. The rAF loop and the zero-delay
 * timer both run while the frames are delivered, so they observe exactly the
 * window the reader is watching.
 */
async function measureStreamedReply(page, options) {
  const { historyTurns, chunks } = options;
  // The history has to exist before the transcript asks for its first page,
  // so it is staged through the fixture's boot-time setup hook.
  await page.addInitScript((messages) => {
    window.__WEBUI_FIXTURE_SETUP__ ??= [];
    window.__WEBUI_FIXTURE_SETUP__.push(() =>
      window.__fixture.setPage("A", { messages, hasMore: false }),
    );
  }, historyMessages(historyTurns));
  await openApp(page);
  await startTurn(page, "A", "Stream a long answer");

  // The runtime replays the user's own message on the stream before the
  // assistant answers, exactly as the server does. Without it the live answer
  // has no user turn to sit under.
  await page.evaluate(() => {
    window.__fixture.emitStream("A", {
      dataJson: JSON.stringify({
        type: "agent_message",
        agent_message: { msg_id: "msg-user-1", msg_content: "Stream a long answer" },
      }),
    });
  });

  const chunkTexts = Array.from({ length: chunks }, (_value, index) => replyChunk(index));

  // Optional CPU profile of the streaming window, so the cost of one frame can
  // be attributed to functions instead of guessed at.
  const cdp = process.env.WEBUI_PERF_PROFILE ? await page.context().newCDPSession(page) : undefined;
  if (cdp) {
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");
  }

  const metrics = await page.evaluate(async (chunkTextsIn) => {
    const count = chunkTextsIn.length;
    const longTasks = [];
    const observer = new PerformanceObserver((entries) => {
      for (const entry of entries.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ type: "longtask" });

    // A rAF loop records the frame pacing the reader actually sees.
    const frameGaps = [];
    let previousFrame = performance.now();
    let running = true;
    const sample = () => {
      if (!running) return;
      const now = performance.now();
      frameGaps.push(now - previousFrame);
      previousFrame = now;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);

    // A zero-delay timer is the cheapest honest probe of "can the main thread
    // still answer me": a busy renderer pushes it late.
    const timerDelays = [];
    let timerRunning = true;
    const probe = () => {
      if (!timerRunning) return;
      const requested = performance.now();
      setTimeout(() => {
        timerDelays.push(performance.now() - requested);
        probe();
      }, 0);
    };
    probe();

    const started = performance.now();
    for (let index = 0; index < count; index += 1) {
      window.__fixture.emitStream("A", {
        cursor: `cursor-${index}`,
        dataJson: JSON.stringify({
          type: "agent_message_chunk",
          agent_message_chunk: {
            msg_id: "a-turn-1",
            msg_content: `${chunkTextsIn[index]}\n\n`,
          },
        }),
      });
      // Each frame is its own browser task in production, so the render
      // opportunity is per frame. A macrotask boundary reproduces that.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const emitted = performance.now();

    await new Promise((resolve) => {
      const deadline = performance.now() + 20_000;
      const check = () => {
        const text = document.querySelector('[data-webui-assistant-body="a-turn-1"]')?.textContent ?? "";
        if (text.includes(`Paragraph ${count - 1} of the streamed answer`)) return resolve();
        if (performance.now() > deadline) return resolve();
        requestAnimationFrame(check);
      };
      check();
    });
    const settled = performance.now();
    running = false;
    timerRunning = false;
    observer.disconnect();
    const records = observer.takeRecords().map((entry) => entry.duration);
    return {
      emitted: emitted - started,
      settled: settled - started,
      longTasks: [...longTasks, ...records],
      frameGaps: frameGaps.slice(1),
      timerDelays,
      liveBodyFound: Boolean(document.querySelector('[data-webui-assistant-body="a-turn-1"]')),
    };
  }, chunkTexts);

  if (cdp) {
    const { profile } = await cdp.send("Profiler.stop");
    const byId = new Map(profile.nodes.map((node) => [node.id, node]));
    const self = new Map();
    const samples = profile.samples ?? [];
    const deltas = profile.timeDeltas ?? [];
    for (let index = 0; index < samples.length; index += 1) {
      const node = byId.get(samples[index]);
      if (!node) continue;
      const frame = node.callFrame;
      const key = `${frame.functionName || "(anonymous)"} @ ${frame.url.split("/").pop() ?? ""}:${frame.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (deltas[index] ?? 0));
    }
    const ranked = [...self.entries()].sort((left, right) => right[1] - left[1]).slice(0, 25);
    console.info("=== CPU profile (top self time, ms) ===");
    for (const [key, micros] of ranked) console.info(`${(micros / 1000).toFixed(1).padStart(8)} ms  ${key}`);
  }

  const gaps = [...metrics.frameGaps].sort((left, right) => left - right);
  const percentile = (fraction) =>
    gaps.length === 0 ? 0 : (gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * fraction))] ?? 0);
  const summary = {
    ...metrics,
    worstFrameGap: gaps.at(-1) ?? 0,
    p95FrameGap: percentile(0.95),
    medianFrameGap: percentile(0.5),
    jankFrames: gaps.filter((gap) => gap >= JANK_FRAME_MS).length,
    droppedFrames: gaps.filter((gap) => gap >= DROPPED_FRAME_MS).length,
    worstTimerDelay: Math.max(0, ...metrics.timerDelays),
    longTaskCount: metrics.longTasks.filter((duration) => duration >= 50).length,
  };
  console.info(
    [
      `streamed reply: ${chunks} frames over ${summary.emitted.toFixed(0)} ms`,
      `settled after ${summary.settled.toFixed(0)} ms`,
      `frame gap: median ${summary.medianFrameGap.toFixed(1)} ms`,
      `p95 ${summary.p95FrameGap.toFixed(1)} ms`,
      `worst ${summary.worstFrameGap.toFixed(1)} ms`,
      `jank frames(>=${JANK_FRAME_MS}ms): ${summary.jankFrames}`,
      `dropped frames(>=${DROPPED_FRAME_MS}ms): ${summary.droppedFrames}`,
      `worst timer delay: ${summary.worstTimerDelay.toFixed(1)} ms`,
      `long tasks: ${summary.longTaskCount}`,
    ].join(" | "),
  );
  return summary;
}

/**
 * The answer must be RENDERED, not merely present: the block reuse means the
 * first block of the answer is rendered from the cache on every later frame,
 * so it is the one a broken reuse would corrupt.
 */
async function expectRenderedAnswer(page, chunks) {
  const body = page.locator('[data-webui-assistant-body="a-turn-1"]');
  // The markdown itself: the body also carries the diff card, whose own file
  // list would otherwise be counted as answer content.
  const answer = body.locator(".webui-markdown");
  await expect(answer).toHaveCount(1);
  // The oldest block, the one every later frame reused.
  await expect(answer.locator("p").first()).toContainText(
    "Paragraph 0 of the streamed answer",
  );
  // Every block that arrived: one list of two items and one fenced code block
  // per chunk, all of them rendered.
  await expect(answer.locator(".webui-code-block")).toHaveCount(chunks);
  await expect(answer.locator("ul li")).toHaveCount(chunks * 2);
  // The reused block kept its content and its highlighting rather than
  // losing either.
  const firstFence = answer.locator(".webui-code-block").first();
  await expect(firstFence.locator("code.hljs")).toContainText("export const value0 = 0;");
}

test("a streamed reply keeps the page responsive", async ({ page }) => {
  const summary = await measureStreamedReply(page, {
    historyTurns: Number(process.env.WEBUI_PERF_HISTORY_TURNS ?? 12),
    chunks: Number(process.env.WEBUI_PERF_CHUNKS ?? 120),
  });

  // The reply must reach the screen, in its own turn block.
  expect(summary.liveBodyFound, "the live reply did not render its own assistant body").toBe(true);
  await expectRenderedAnswer(page, Number(process.env.WEBUI_PERF_CHUNKS ?? 120));
  // The reader must never lose a frame to the reply.
  expect(
    summary.jankFrames,
    `the streamed reply dropped ${summary.jankFrames} frames (worst gap ${summary.worstFrameGap.toFixed(1)} ms)`,
  ).toBe(0);
  // No single frame may block the main thread long enough to be a stutter.
  expect(
    summary.longTaskCount,
    `the streamed reply produced ${summary.longTaskCount} long tasks`,
  ).toBe(0);
});

test("a long reply in a long conversation does not drop frames", async ({ page }) => {
  // The heavy case: the per-frame work scales with the conversation, so this
  // is where a per-frame regression shows up as dropped frames rather than as
  // a slower reply.
  const summary = await measureStreamedReply(page, {
    historyTurns: Number(process.env.WEBUI_PERF_HEAVY_HISTORY_TURNS ?? 40),
    chunks: Number(process.env.WEBUI_PERF_HEAVY_CHUNKS ?? 400),
  });

  expect(summary.liveBodyFound, "the live reply did not render its own assistant body").toBe(true);
  await expectRenderedAnswer(page, Number(process.env.WEBUI_PERF_HEAVY_CHUNKS ?? 400));
  expect(
    summary.droppedFrames,
    `the streamed reply dropped ${summary.droppedFrames} frames (worst gap ${summary.worstFrameGap.toFixed(1)} ms)`,
  ).toBe(0);
  expect(
    summary.jankFrames,
    `the streamed reply dropped ${summary.jankFrames} frames (worst gap ${summary.worstFrameGap.toFixed(1)} ms)`,
  ).toBe(0);
  expect(
    summary.longTaskCount,
    `the streamed reply produced ${summary.longTaskCount} long tasks`,
  ).toBe(0);
});
