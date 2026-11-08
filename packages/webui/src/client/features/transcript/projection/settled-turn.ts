// Durable content must cover the observed ordered parts and asset identities.
// Completion of delivery alone is not evidence that persistence has caught up.
import { projectMessageParts } from "./message-parts.js";
import type { WebuiStreamMessage } from "../../turn/contracts/stream-state.js";
import type { WebuiClientMessage } from "../contracts/message-view.js";
import { toolCallStatus } from "./tool-projection.js";

function containsObservedValue(expected: unknown, actual: unknown): boolean {
  if (Object.is(expected, actual)) return true;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.every((item, index) => containsObservedValue(item, actual[index]));
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") return false;
    return Object.entries(expected).every(([key, value]) => value === undefined || containsObservedValue(value, (actual as Record<string, unknown>)[key]));
  }
  return false;
}

function containsObservedTool(expected: Record<string, unknown>, actual: Record<string, unknown>): boolean {
  const before = toolCallStatus(expected);
  const after = toolCallStatus(actual);
  const statusCovered = before === "unknown" || before === after ||
    (before === "pending" && after !== "unknown") ||
    (before === "running" && (after === "completed" || after === "error" || after === "cancelled"));
  return statusCovered && Object.entries(expected).every(([key, value]) =>
    key === "status" || key === "tool_call_status" || key === "toolCallStatus" || value === undefined || containsObservedValue(value, actual[key]),
  );
}
/** Compare actual ordered content and asset identities, allowing an appended durable tail. */
export function isWebuiObservedMessagePersisted(observed: WebuiStreamMessage, durable: WebuiClientMessage): boolean {
  if (observed.id !== durable.msgId) return false;
  const expected = projectMessageParts({
    msgId: observed.id, msgContent: observed.answer, thinkingContent: observed.thinking,
    toolCalls: observed.toolCalls, parts: observed.parts,
  });
  const actual = projectMessageParts(durable);
  let index = 0;
  return expected.every((part) => {
    for (; index < actual.length; index += 1) {
      const candidate = actual[index]!;
      if (part.type !== candidate.type) continue;
      const { id: _expectedId, ...want } = part;
      const { id: _actualId, ...have } = candidate;
      const matches = "content" in want && "content" in have
        ? typeof have.content === "string" && have.content.startsWith(want.content)
        : want.type === "tool_call" && have.type === "tool_call"
        ? containsObservedTool(want.toolCall, have.toolCall)
        : containsObservedValue(want, have);
      if (!matches) continue;
      index += 1;
      return true;
    }
    return false;
  });
}
