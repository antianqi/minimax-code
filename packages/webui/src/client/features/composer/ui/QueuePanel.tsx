import type { ReactElement } from "react";

import type { WebuiQueueItem } from "../../../../shared/contracts/queue.js";
import { FeedbackLiveRegion } from "../../../ui/feedback.js";
import { WebuiIconButton } from "../../../ui/button.js";
import { WebuiStack } from "../../../ui/layout-primitives.js";
import { WebuiIconContextTrash, WebuiIconQueuedMessages, WebuiIconSend } from "../../../shell/icons.js";

/**
 * The messages waiting behind a running turn, and whether the queue is held.
 *
 * This was inline in `SessionComposer` and had no test at all, which is how
 * "Waiting messages" and "Remove" ended up inside an otherwise Chinese
 * composer: the list lived in component state, and the webui suite runs in
 * `environment: "node"` with no jsdom, so `renderToStaticMarkup` never runs
 * the effect that fills that state. Pulling the markup out makes it a pure
 * function of its props, which is the only way it can be checked here.
 *
 * The wording matters more than it looks. This panel appears exactly when the
 * user has sent something the runtime is not working on yet, and it is the
 * only place that says so. A heading that reads "Waiting messages" in an
 * otherwise Chinese composer is not a typo, it is the one surface the user
 * looks at to answer "did my message go anywhere?".
 */
export function WebuiQueuePanel({
  items,
  paused,
  onRemove,
  onSendNow,
}: {
  readonly items: readonly WebuiQueueItem[];
  readonly paused?: boolean;
  readonly onRemove?: (item: WebuiQueueItem) => void;
  readonly onSendNow?: (item: WebuiQueueItem) => void;
}): ReactElement | null {
  // Paused with nothing queued still gets the notice: the user hit stop and
  // the answer they need is that the rest is held, not gone. With no items and
  // no pause there is nothing to say, and an empty box would claim a queue
  // exists.
  if (items.length === 0 && !paused) return null;
  return (
    <WebuiStack as="section" gap="small" className="w-full" data-webui-queue-paused={paused ? "true" : undefined}>
      {paused ? (
        <FeedbackLiveRegion className="text-text_default_secondary text-size_12">
          队列已暂停
        </FeedbackLiveRegion>
      ) : null}
      {items.length > 0 ? (
        <WebuiStack
          as="ul"
          gap="none"
          className="webui-queue-list w-full"
          role="list"
          aria-label={`排队消息（${items.length}）`}
          data-webui-queue="true"
          data-webui-queue-count={items.length}
        >
          {items.map((item) => (
            <li key={item.itemId} data-webui-queue-item={item.itemId} className="webui-goal-banner webui-queue-item">
              <div className="webui-goal-banner-row">
                <div className="webui-goal-banner-leading">
                  <span className="webui-goal-banner-icon" aria-hidden="true"><WebuiIconQueuedMessages /></span>
                  <FeedbackLiveRegion className="webui-goal-status">
                    {paused
                      ? "已暂停"
                      : item.status === "queued"
                        ? "排队中"
                        : item.status === "running"
                          ? "进行中"
                          : "已完成"}
                  </FeedbackLiveRegion>
                </div>
                <div className="webui-goal-banner-content-row">
                  <div className="webui-goal-banner-objective-group">
                    <span className="webui-goal-objective" title={item.content || item.itemId}>
                      {item.content || item.itemId}
                    </span>
                  </div>
                </div>
                <div className="webui-goal-banner-actions-slot webui-queue-actions">
                  {/* These actions use the goal banner's compact icon controls. */}
                  {item.status === "queued" && onSendNow ? (
                    <WebuiIconButton
                      tone="bare"
                      className="webui-goal-action"
                      label="立即发送"
                      title="立即发送"
                      data-webui-send-queue-item={item.itemId}
                      onClick={() => onSendNow(item)}
                    >
                      <WebuiIconSend />
                    </WebuiIconButton>
                  ) : null}
                  {item.status === "queued" && onRemove ? (
                    <WebuiIconButton
                      tone="bare"
                      className="webui-goal-action"
                      label="移除排队消息"
                      title="移除"
                      data-webui-remove-queue-item={item.itemId}
                      onClick={() => onRemove(item)}
                    >
                      <WebuiIconContextTrash />
                    </WebuiIconButton>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </WebuiStack>
      ) : null}
    </WebuiStack>
  );
}
