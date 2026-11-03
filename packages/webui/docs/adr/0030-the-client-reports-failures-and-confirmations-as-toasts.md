# The client reports failures and confirmations as toasts

**Status:** Accepted.
**Date:** 2026-11-03.

ADR 0028 established one shared presentation layer, and its feedback family
(`client/ui/feedback.tsx`) owns the states a surface can be in: empty, error,
skeleton, progress, busy, announcement. That family draws a state *in place*,
because a state is a fact about the surface it belongs to. This decision adds the
other kind of message: one that has already happened, is said once, and is gone
again — a failure of an action, a confirmation that a write landed, a read that
did not come back. Those are events, not states, and the client was drawing them
as states.

## What changed

Before this decision the client wrote those events into the page. A failed save
put a red paragraph under the form and left it there until the next attempt. A
successful save put a green paragraph under the field and left it there until the
user edited the field again. A failed read replaced the panel's content with a red
paragraph. Every one of them spent layout on a moment that was already over: the
page grew, the content below the notice moved, and the notice outlived the thing
it was about.

The shared toast (`client/ui/toast.tsx`) is now the one way the client says
something that has already happened. The notice is drawn against the viewport,
over the page, and takes no room from it.

## What a toast is

A toast is a card with a tone, a message, an optional description, an optional
action, and a lifetime. It arrives, it is read, and it leaves. The client says
through it:

- an action that failed — "保存失败", "复制失败";
- a write that landed — "已保存", "已复制", "远程连接已保存";
- a read that did not come back — "读取定时任务失败。".

`client/ui/toast-store.ts` owns the decisions and is free of React: the
vocabulary of a notice, the lifetime each tone is worth, the rule that says which
two notices are the same notice, the cap on a visible stack, and the queue's
transitions. `client/ui/toast.tsx` owns the card, the timers, the announcement
and the host.

## What a toast is not

Two kinds of error stay where they are, and this decision does not move them.

**A field's own error.** A validation message belongs to the control it
describes: `WebuiField` connects the message to the control with `aria-describedby`
and marks the control `aria-invalid`. A toast is not addressable by a control and
disappears on its own, so a field error moved into one would be lost to the user
who is still typing in the field it is about.

**A state that stays.** A quota banner, a goal banner, the notice about a
session deleted on another device, a warning inside a message body: these state a
fact that is true until the fact changes. They are states, they belong to the
surface that owns them, and they are drawn in place.

**A read that failed** is different from both, and this decision moves it. When
the content a surface was going to show could not be read, the surface says so
through a toast and then shows what it can — usually its content path with
nothing in it, which is the same thing the user sees before the read began. The
notice is transient because the condition is: a read that fails once and succeeds
on the next attempt has no business owning a permanent block of layout. The
surface's own empty state, where it has one, still describes what is absent.

## The queue's rules

- **Tone.** `info`, `success`, `warning`, `error`. The tone decides the colour,
  the glyph and how loudly the notice is announced. An error interrupts; the
  others wait their turn.
- **Lifetime.** A confirmation is read at a glance and goes quickly; a failure
  carries a sentence the user may read twice and stays longer. A notice that
  offers an action waits for the answer — it does not time out — because a retry
  the user has not reached yet must not disappear.
- **Repetition.** A notice that is said twice is said once: the second saying
  refreshes the first in place and restarts its countdown. Two notices are the
  same notice when their tone and their words are the same.
- **The stack.** A handful of toasts are on screen at once, and the oldest leaves
  when the stack grows past that. A toast that stacks without a bound is a second
  page of content, and the user ends up reading the oldest message while the
  newest one is the only one that matters.

## Announcement

The card that carries a notice announces it: an error is an `alert`, the rest
are a `status`. There is one announcer per notice, and the migration removed the
inline announcer that used to sit next to it — a notice said twice is a notice
heard twice.

## The queue and the surfaces that raise notices

The client mounts one queue per document, at the composition root, and the host
that draws it is a sibling of the application. A surface rendered on its own —
a server render, an isolated preview — has no queue to raise a notice into.
That is a wiring mistake, and it is reported: the notice is raised into a
remembered record and the client is told once that there was nowhere to draw
it. It is not the reason a surface fails to render.

## Overlay status

A toast is not a managed overlay. It is not dismissed by Escape, it never takes
focus on its own, and it does not register with the overlay coordinator. A layer that
answered a dismissal would be a layer the user had to dismiss, and a toast the
user has to dismiss is a dialog.

## The notice crosses a modal

A modal makes the page behind it inert, so that a keyboard reader and a screen
reader stay inside it. The notice channel is not that page: it is where the
failure a modal reports is said. Left inside the modal's exclusive zone, the
notice would be silenced exactly when it mattered — an inert subtree is also
gone from the accessibility tree, so the `alert` would never be heard — and
the action it carries would be unreachable.

The client's answer is a marker: `data-webui-live-surface`. A surface that
carries it stays live across a modal. The platform layer keeps such a surface
out of the modal's exclusive zone: it is not made inert, focus may rest on it,
and it joins the modal's tab ring. The overlay listener treats a press on it as
a press on the notice rather than a press on the page behind, so answering a
notice's retry does not close the dialog that reported the failure.

The toast host carries the marker. It is the only surface that does today; the
marker is a contract rather than a toast feature, so the next surface that has
to cross a modal can carry it too.

## Adoption

The contract is adopted by rendering it: `useWebuiToastError` and
`useWebuiToastSuccess` say a message once, when it appears, and leave the layout
alone. A caller keeps the state it holds — the state is what a retry and a
re-render need — and stops drawing it.

Completion is not proved by a gate. The presentation inventory records that the
contract exists and that the surfaces using it were reviewed; the coverage of
the migration is a source review, and the appearance is a browser check.