// Mini App capability port.
//
// The three operations the WebUI's Mini App business drives: the catalogue, the
// launch and the stop, plus the standalone presentation lease and the deep link
// that opens one. Split from the monolithic transport the way every other
// business's port is, and composed by `transport.ts`.
//
// Every method stays optional — `undefined` means "the operation is not wired",
// which is the state a host without the Mini App cell answers with. The business
// renders that as a report ("this host has no Mini App capability") rather than
// calling into an absent member.
//
// Two things are deliberately absent. The Mini App's own origin, its surface path
// and the launch credential never appear here: the server holds them and the
// client is handed the proxy's `viewUrl` (`shared/contracts/miniapp.ts`). And
// there is no "attach": returning to the inline presentation is closing the
// standalone tab, which releases the lease — the standalone page has no control
// that would need one (ADR 0020).

import type {
  WebuiMiniAppCatalogue,
  WebuiMiniAppPermissionList,
  WebuiMiniAppPresentationState,
  WebuiMiniAppPresentationIntent,
  WebuiMiniAppView,
} from "../../../../shared/contracts/miniapp.js";
import type {
  WebuiMiniAppAgentCallRequest,
  WebuiMiniAppAgentCallResponse,
  WebuiMiniAppAgentTurnFrame,
  WebuiMiniAppAgentObserveFrame,
  WebuiMiniAppAgentObserveRequest,
  WebuiMiniAppAgentTurnRequest,
} from "../../../../shared/contracts/miniapp-agent.js";
import type {
  WebuiMiniAppToolApprovalAnswer,
  WebuiMiniAppToolApprovalFrame,
  WebuiMiniAppToolResult,
} from "../../../../shared/contracts/miniapp-tools.js";

export interface MiniAppPort {
  /** Follow the host-owned agent presentation request and enact it in the shell. */
  readonly watchMiniAppPresenter?: (
    onFrame: (intent: WebuiMiniAppPresentationIntent) => void,
    onFailure?: (error: Error) => void,
  ) => () => void;
  /**
   * The installed Mini Apps, with the runtime state and the live presentation the
   * row renders.
   *
   * `detached` and `presentationRevision` are the service's record, which is why
   * this answers `WebuiMiniAppCatalogue` and not the runtime's own list: what a
   * row says about presentation is not something the runtime knows.
   */
  readonly listMiniApps?: () => Promise<WebuiMiniAppCatalogue>;
  /**
   * One package's declared Mini App permissions with the stored switches.
   *
   * Optional with the rest of the cell. The items come from the installed manifest,
   * so a package that dropped an item is simply no longer asked about it.
   */
  readonly listMiniAppPermissions?: (pluginId: string) => Promise<WebuiMiniAppPermissionList>;
  /**
   * Stores one switch; the answer is the list as it now stands.
   *
   * A refusal is the runtime's: an id the package does not declare is
   * `MINIAPP_PERMISSION_UNKNOWN`, reported rather than retried.
   */
  readonly setMiniAppPermission?: (request: {
    readonly pluginId: string;
    readonly permission: string;
    readonly enabled: boolean;
  }) => Promise<WebuiMiniAppPermissionList>;
  /**
   * Starts one Mini App and answers with the loopback URL the panel frames.
   *
   * A refusal is the runtime's: `OWNED_ELSEWHERE` names the client that holds the
   * app, `BUSY` carries the capacity refusal. The business reports the message
   * it was given rather than inventing one, because the runtime is the only
   * party that knows which of the two happened.
   */
  readonly openMiniApp?: (request: {
    readonly pluginId: string;
    /**
     * The origin-relative page inside the Mini App to open, when one was named.
     *
     * The Agent's `open` may name a path; the server resolves it against the
     * Mini App's own origin and answers with the URL to frame.
     */
    readonly path?: string;
  }) => Promise<WebuiMiniAppView>;
  /** Stops one Mini App. The server closes that plugin's proxy with it. */
  readonly stopMiniApp?: (request: {
    readonly pluginId: string;
  }) => Promise<{ readonly success: true }>;
  /**
   * Declares this document as the standalone presentation of one Mini App, and
   * holds the lease until the returned function is called.
   *
   * This is the whole of ADR 0020's lease from the client's side: the call opens a
   * connection the service holds the record against, the first frame says what the
   * lease is (its revision, and whether the deep link's session is still live),
   * and the release is that subscription ending — which is what closing the tab
   * does to it.
   */
  readonly watchMiniAppPresentation?: (
    request: { readonly pluginId: string; readonly sessionId?: string },
    onFrame: (state: WebuiMiniAppPresentationState) => void,
    /**
     * The lease could not be established — a refused session lookup, a missing
     * capability. Reported rather than folded into "no lease", because a stand-in
     * that cannot answer is not a closed tab.
     */
    onFailure?: (error: Error) => void,
  ) => () => void;
  /**
   * One followed turn: the page's `run` / `answer`.
   *
   * The body carries `observe`, because whether the page is listening decides
   * whether the runtime may wait on it for a permission or questionnaire answer —
   * and a stream existing is not the same fact. The detach ends this turn's socket
   * and nothing else.
   */
  readonly watchMiniAppAgentTurn?: (
    request: WebuiMiniAppAgentTurnRequest,
    onFrame: (frame: WebuiMiniAppAgentTurnFrame) => void,
    onFailure?: (error: Error) => void,
  ) => () => void;
  /**
   * Turns as they settle, every conversation or one.
   *
   * The detach is the cancel: a watch nobody is reading anymore is a watch nobody
   * wants, so closing the stream is what ends it in the runtime too.
   */
  readonly watchMiniAppAgentObservations?: (
    request: WebuiMiniAppAgentObserveRequest,
    onFrame: (frame: WebuiMiniAppAgentObserveFrame) => void,
    onFailure?: (error: Error) => void,
  ) => () => void;
  /**
   * One short Mini App agent call, its refusal included in the body.
   *
   * A refusal is a body rather than a thrown error because the page has to receive
   * its documented code; only a transport failure throws here.
   */
  readonly miniAppAgentCall?: (
    request: WebuiMiniAppAgentCallRequest,
  ) => Promise<WebuiMiniAppAgentCallResponse>;
  /**
   * One request from a framed page's tool channel.
   *
   * The page names a method and a tool; `pluginId` is this client's, taken from the view
   * that framed the document. The answer is already the page's shape (`ok` / `ok: false`
   * with the runtime's code), so nothing here interprets a refusal.
   */
  readonly miniAppToolCall?: (request: {
    readonly pluginId: string;
    readonly method: "list" | "request" | "call";
    readonly name?: string;
    readonly names?: readonly string[];
    readonly arguments?: unknown;
  }) => Promise<WebuiMiniAppToolResult>;
  /**
   * The tool prompts waiting for a person, pushed whenever the list changes.
   *
   * A stream: a prompt appears while a page's call is already waiting, so a client that
   * only read once would never see it. The first frame is the list as it stands.
   */
  readonly watchMiniAppToolApprovals?: (
    request: undefined,
    onFrame: (frame: WebuiMiniAppToolApprovalFrame) => void,
    onFailure?: (error: Error) => void,
  ) => () => void;
  /** One answer to one prompt. An id that is gone is the runtime's refusal. */
  readonly replyMiniAppToolApproval?: (
    input: WebuiMiniAppToolApprovalAnswer,
  ) => Promise<{ readonly success: true }>;
  /** The standalone page's URL, token included. Built by the wire, not the UI. */
  readonly miniappStandaloneUrl?: (request: {
    readonly pluginId: string;
    readonly sessionId?: string;
  }) => string;
}
