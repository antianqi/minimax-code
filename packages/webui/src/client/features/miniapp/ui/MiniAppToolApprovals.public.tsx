// The questions a Mini App's page is waiting on.
//
// A page's `ask` is not something the page can answer: the rules said a person has to
// decide, so the question is rendered here, in the view that framed it, and the page
// keeps waiting until one of the three answers reaches the runtime. Three properties:
//
//   * **One question at a time.** A prompt is a call that is already blocked; showing a
//     stack of them would ask a person to hold several decisions at once, and the rest
//     are reported by count rather than by widening the panel.
//   * **The tool name and its arguments preview are the whole question.** The runtime
//     bounded the preview before it got here; this does not fetch anything else.
//   * **Every answer is one of three.** "Always allow" is the only one that outlives the
//     call, and the copy says so — a person choosing it is writing a rule, not answering
//     once.

import type { ReactElement } from "react";

import { WebuiButton } from "../../../ui/button.js";
import type { WebuiMiniAppToolApprovalPrompt } from "../../../../shared/contracts/miniapp-tools.js";

export interface MiniAppToolApprovalsProps {
  readonly prompts: readonly WebuiMiniAppToolApprovalPrompt[];
  readonly onAnswer: (answer: {
    readonly requestId: string;
    readonly decision: "allow" | "deny" | "allowAlways";
  }) => void;
  /** True while an answer is in flight: the controls are the command's state. */
  readonly busy?: boolean;
}

/** What one prompt asks, in one line: the tool, and what it was called with. */
function questionOf(prompt: WebuiMiniAppToolApprovalPrompt): string {
  const [first] = prompt.tools;
  if (!first) return prompt.mode === "request" ? "允许这个应用使用工具？" : "允许这次工具调用？";
  return prompt.mode === "request"
    ? `允许这个应用使用 ${first.name}？`
    : `允许调用 ${first.name}？`;
}

export function MiniAppToolApprovals({
  prompts,
  onAnswer,
  busy = false,
}: MiniAppToolApprovalsProps): ReactElement | null {
  const [prompt] = prompts;
  if (!prompt) return null;
  const tool = prompt.tools[0];
  const remaining = prompts.length - 1;

  return (
    <div
      className="webui-miniapp-approvals"
      data-testid="miniapp-tool-approval"
      data-mode={prompt.mode}
    >
      <p className="webui-miniapp-approvals-question">{questionOf(prompt)}</p>
      {tool?.argumentsPreview ? (
        <pre className="webui-miniapp-approvals-arguments" data-testid="miniapp-tool-approval-arguments">
          {tool.argumentsPreview}
        </pre>
      ) : null}
      {remaining > 0 ? (
        <p className="webui-miniapp-approvals-more">还有 {remaining} 个请求在等待</p>
      ) : null}
      <div className="webui-miniapp-approvals-actions">
        <WebuiButton
          size="compact"
          variant="secondary"
          loading={busy}
          onClick={() => onAnswer({ requestId: prompt.requestId, decision: "deny" })}
          data-testid="miniapp-tool-approval-deny"
        >
          拒绝
        </WebuiButton>
        <WebuiButton
          size="compact"
          variant="secondary"
          loading={busy}
          onClick={() => onAnswer({ requestId: prompt.requestId, decision: "allow" })}
          data-testid="miniapp-tool-approval-allow"
        >
          允许一次
        </WebuiButton>
        <WebuiButton
          size="compact"
          variant="primary"
          loading={busy}
          onClick={() => onAnswer({ requestId: prompt.requestId, decision: "allowAlways" })}
          data-testid="miniapp-tool-approval-always"
          title="写入全局允许规则，之后的调用不再询问"
        >
          始终允许
        </WebuiButton>
      </div>
    </div>
  );
}
