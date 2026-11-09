// transcript-scroll — 会话转录视口的滚动策略。
//
// 视口 `[data-webui-session-scroll="true"]` 承载整条消息流：live 回合期间由自动跟随
// 维持贴底，进入一个非 live 会话时同样要落在最后一条消息上。这里的函数只做纯计算，
// 把"何时跳"和"跳多远"从组件里拆出来，状态迁移可以直接单测。
//
// 策略只有两条规则，都以读者为准：
//   1. 读者用手势把视口从最新内容上带走，就立刻交还控制权（手势判定见下）。
//   2. 读者自己走回末尾，才重新跟随；流式内容不会替他把手势抢回去。

export interface WebuiScrollMetrics {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** 贴底所需的 scrollTop；内容不足一屏时为 0。 */
export function webuiScrollBottomTop(metrics: WebuiScrollMetrics): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}

/** 视口距顶/距底小于该距离即视为到顶/到底（px）。 */
export const WEBUI_SCROLL_EDGE_THRESHOLD_PX = 20;

/**
 * 释放之后，读者回到末尾附近才重新跟随（px）。
 *
 * 跟手势释放用的是不同的判定：手势只需要证明读者「把视口从末尾带走」，
 * 而重新跟随需要证明读者「自己走回了末尾」。两者的带宽不同，是因为
 * 手势释放的那一次滚动本身是向上的——它不可能同时是往末尾走。
 */
export const WEBUI_SCROLL_END_THRESHOLD_PX = 4;

/** 视口是否已经回到末尾（离末尾不超过上面那条带宽）。 */
export function webuiScrollAtEnd(metrics: WebuiScrollMetrics): boolean {
  return webuiScrollBottomTop(metrics) - metrics.scrollTop <= WEBUI_SCROLL_END_THRESHOLD_PX;
}

/** 这次滚动是否把视口往末尾的方向带了（scrollTop 变大）。 */
export function webuiScrollMovedTowardEnd(
  previousScrollTop: number,
  currentScrollTop: number,
): boolean {
  return currentScrollTop > previousScrollTop;
}

/**
 * 释放之后，读者是否重新跟随。
 *
 * 两个条件缺一不可：滚动要真的是往末尾走的，而且视口要真的到了末尾附近。
 * 手势之后浏览器派发的那个 scroll 事件是向上的（读者刚把视口带走），
 * 所以它不能算「往回走」；「离末尾只差一点」也不算「已经回到末尾」——
 * 读者自己回到末尾，才算把跟随权要回来。
 */
export function webuiScrollFollowsAgain(params: {
  readonly metrics: WebuiScrollMetrics;
  readonly movedTowardEnd: boolean;
}): boolean {
  return params.movedTowardEnd && webuiScrollAtEnd(params.metrics);
}

/** 触摸手势必须超过该位移才算用户滚动手势（px）。 */
export const WEBUI_SCROLL_TOUCH_INTENT_PX = 8;

export type WebuiScrollIntent = "release" | "ignore";

/**
 * 一个滚动手势是否算「用户把视口从最新内容上拿走」。
 *
 * 手势只有在**真能移动视口**时才算数。
 * 已经贴底还继续往下推、或已经在顶部还继续往上推，视口无处可去，
 * 这种滚轮不释放跟随——
 * 它不是用户要脱离跟随，只是滚到了尽头。触摸更宽松：位移不足 8px 的手势
 * 是手指落下的抖动，同样不算意图。
 */
export function webuiScrollIntent(params: {
  readonly event: "wheel" | "touchmove";
  readonly deltaY: number;
  readonly metrics: WebuiScrollMetrics;
}): WebuiScrollIntent {
  if (params.event === "touchmove" && Math.abs(params.deltaY) < WEBUI_SCROLL_TOUCH_INTENT_PX) {
    return "ignore";
  }
  const bottomTop = webuiScrollBottomTop(params.metrics);
  const atBottom = bottomTop - params.metrics.scrollTop <= WEBUI_SCROLL_EDGE_THRESHOLD_PX;
  const atTop = params.metrics.scrollTop <= WEBUI_SCROLL_EDGE_THRESHOLD_PX;
  if (atBottom && params.deltaY >= 0) return "ignore";
  if (atTop && params.deltaY <= 0) return "ignore";
  return "release";
}
