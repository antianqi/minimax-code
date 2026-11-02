# Page surfaces share layout, skeleton and motion contracts

**Status:** Accepted.
**Date:** 2026-11-01.

ADR 0028 establishes one shared presentation layer and package-wide motion foundations. This decision makes their page and motion contracts explicit: `WebuiPage` represents page-level presentation properties and may be composed by route pages, dialogs, drawers and other page-like business surfaces; it does not impose one body layout on them.

## Page surfaces and loading

`WebuiPage` is a page-level presentation boundary, not a replacement for a page's business component or layout. A route page, dialog, drawer or panel may use it when that surface has page properties such as loading status, skeleton projection and page-level motion. The caller keeps its DOM structure, content, geometry, business state and lifetime; adopting `WebuiPage` does not require moving that structure into a new shared component.

When loading, the skeleton is projected from the already-defined page layout rather than described in a second, page-specific skeleton tree. Shared structural components project the skeleton for the structures they own, so a composed page can reuse those projections. This adoption is incremental: a page should not duplicate its layout just to render a loading state.

## Shared motion

Repeated semantic elements use shared components or motion families for the common visual implementation and policy of their applicable transitions. This includes cards, panels, buttons and other repeated interaction or disclosure elements. Each family defines consistent motion for that element type and state, so every card, panel or button does not define its own copy of the same animation. Business code retains responsibility for meaning and timing: it chooses whether and when a state changes, while the shared component owns how that state is animated. Static instances do not animate merely because of their element type.

`WebuiDisclosure` owns the shared expand/collapse layout, clipping and hidden-state behavior for repeated disclosures. Page-like surfaces that animate out use `WebuiPage` presence so the shared exit motion can finish before the surface unmounts. Callers continue to own the target geometry and the state that requests an open or close.

`WebuiMotionSlot` applies feedback, progress and disclosure-transform families to an existing semantic element without adding a DOM wrapper. Callers provide the family and, for a disclosure indicator, its rotation value; shared code maps these values to the motion implementation. Business components do not name shared motion classes directly. The motion gate enforces this boundary. `WebuiButton`, `WebuiDisclosure` and `WebuiPage` continue to own their respective button, region and page-surface motion contracts. Tooltips use the shared tooltip motion's opacity, visibility and offset states. Range thumbs opt into the common hover/active response through a motion role.

Programmatic smooth scrolling also follows one shared reduced-motion policy in `bindings/browser-effects.ts`. A feature chooses the target and alignment; it does not choose whether scrolling animates.

`WebuiLottie` owns Lottie playback lifecycle and reduced-motion policy. A feature may supply a genuinely feature-specific animation asset, but it must not import or drive the animation engine itself. The Transcript thinking indicator keeps its rose-loader asset and phrase behavior; playback remains in the shared feedback component.

All loading skeletons use the shared solid-color pulse treatment and reduced-motion policy. The account usage skeleton is an example of this shared treatment, not a feature-specific exception. Other approved exceptions are the sign-in success effect and Transcript-specific message entrance, turn-jump highlight and rose-loader art. The shared motion gate permits only those named feature-owned effects; repeated disclosure, button, card, panel, progress and loading motion belongs to shared contracts.

## Adoption

Adopt these contracts as page-like surfaces and repeated motion patterns are migrated. Inventory and source checks can track declared motion and known surfaces, but completion requires a separate source coverage review and rendered UI verification; a passing inventory alone does not prove every page or state has adopted the shared contracts.
