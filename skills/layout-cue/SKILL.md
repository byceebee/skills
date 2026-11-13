---
name: layout-cue
description: Build and refine web layouts with persistent browser guides, from the page shell to individual controls. Use when implementing or reviewing alignment, spacing, typography, icons, or responsive layout on a running page.
license: MIT
---

# Layout Cue

Make the page easier to scan and use. Give related elements a clear grouping, keep repeated components consistent, and preserve those relationships as content and viewport size change. Use the guides to decide what to fix while you edit.

Use this skill with its bundled Chrome extension. When the user specifies their active Chrome, pair and capture the target tab in that session. The extension renders the page grid and the ruler for the selected element. The local agent controls the tab and returns its measurements as JSON.

## Connect to the existing tab

Load the complete `layout-cue` skill directory as an unpacked extension from `chrome://extensions`. Use Chrome 116 or later.

1. Set `WITNESS_DIR` to the installed skill directory. Run `(cd "$WITNESS_DIR" && npm ci --omit=dev)` once.
2. For Google Chrome on macOS or Linux, copy the Layout Cue extension ID from `chrome://extensions` and register the local audit host once with `node "$WITNESS_DIR/scripts/install-native.mjs" <extension-id>`.
3. Open Layout Cue from the toolbar on the development tab. Choose **Agent access → Connect audit tab**. The CLI discovers the connection locally. The host starts with the connection. The popup authorizes the one tab.

For manual pairing, run `node "$WITNESS_DIR/scripts/agent.mjs" serve` in a persistent terminal and use **Pairing URL (manual connection)** and **Connect agent** in the popup.

```sh
node "$WITNESS_DIR/scripts/agent.mjs" navigate /dashboard
# Once the route is ready, open the audit state using a unique visible control.
node "$WITNESS_DIR/scripts/agent.mjs" click '[aria-label="Open details"]'
node "$WITNESS_DIR/scripts/agent.mjs" start 'header [aria-label="Search"]'
node "$WITNESS_DIR/scripts/agent.mjs" select 'main form button[type="submit"]'
node "$WITNESS_DIR/scripts/agent.mjs" measure
node "$WITNESS_DIR/scripts/agent.mjs" capture ./submit-ruler.jpg
# Edit the project's CSS and wait for the dev server to apply it.
node "$WITNESS_DIR/scripts/agent.mjs" measure
```

`measure` prints page regions, check results and the currently selected element when available. That element can include its rendered box, margin, border, padding, grid and gap values, typography (including viewport baseline Y when measurable), and SVG geometry. Use a selector that matches one visible element. Keep the selection while editing and read its JSON again after the browser applies the change.

Use `navigate` for routes and URLs on the connected origin. It returns when navigation starts. Wait for the intended page or state to render and for its opening animation to finish before selecting and capturing. Use `click` to activate an unambiguous, visible control such as a dialog or drawer trigger. Confirm the intended state before taking evidence.

Use `status` to check the connection, `clear` to remove only the element guide, `pick` for manual click selection, `import <rules.json>` to load [project rules](references/rules.md), and `defaults` to restore default rules. Use `stop` to remove both guides and clear the selection for clean review. Use `start` and `select` to resume. Use `disconnect` when done if the tab should stop accepting commands. Same-origin reloads can restore guides and a selection on the same route. A different origin or tab closure ends the pairing.

Starting with no selector turns on both overlays and chooses an initial visible element. A selector supplied to `start` or `select` must match exactly one visible element. For manual review, **Start guides** turns on both overlays. Use **Inspect element** to move the ruler to the component you are checking, and **Stop guides** for the clean render. **Download report** saves the current measurements.

## Audit evidence

For each page or interaction state in scope, bring the relevant UI into view and select the element you are judging. Use a separate selection when the question moves from the shell or group to an individual control, label, icon, or hit target. Run `capture <output.jpg>` while the paired tab is active. It saves the native screenshot and a measurement JSON with the same stem. It refuses capture when the ruler is missing, the element is offscreen, or the paired tab is in the background. Verify the intended selector in the JSON and the grid, ruler and relevant labels in the image. Replace the initial automatic selection with the actual element for each atomic finding.

Run `stop` and then `capture-clean <output.jpg>` for the matching clean screenshot on the same tab and viewport. Link the ruler screenshot, clean screenshot, and measurement for each checked state in the coverage matrix. Replace captures that lack the intended native ruler. If a state cannot be reached, mark it pending and record why. Use unattended page-grid captures for discovery.

## Review how elements work together

Start from the page's main task. Identify which elements belong together, which edges they share, what should be read first, and which controls must remain reachable. Use the project's tokens and established components to set expectations for each relationship.

| Relationship | What to check |
| --- | --- |
| Grouping and spacing | Compare the rendered gap inside a group with the gap to its neighbor. A field's label, input, and helper text should read as one group. Check the surrounding field as well when the association is unclear. |
| Shared edges and intentional insets | Compare content edges across titles, toolbars, cards, and repeated rows. Use the shared-edge check below when the project specifies their alignment. |
| Hierarchy and reading order | Read the clean page in task order. Check whether titles, values, actions, and secondary details are easy to associate. Check that the visual order follows the meaningful DOM order where sequence matters. |
| Responsive relationships | Check the same group at supported widths and relevant states, such as loading, long labels, or an open drawer. Verify that related elements stay together when they wrap or stack and that actions remain reachable. Follow the overflow guidance for intentional scrolling. |

Select the composition first, then inspect individual controls where their measurements explain the issue. Use the parent’s computed gap for its layout rule. For actual space between adjacent rendered boxes, subtract the first box’s bottom from the next box’s top in a vertical stack. Apply the equivalent edges along the horizontal axis for a row. Confirm the impact in the clean render. For example, when a field’s helper text appears closer to the next field, check the field stack and its spacing before editing the text or individual controls.

## Verify a shared edge

1. **Choose the reference.** Identify the subject, its reference element, and the edge they should share in this state. Take the target from the brief, design system, or an approved sibling. If the intended line runs through content inside a padded container, select that content.
2. **Measure.** Add a [relative edge check](references/rules.md#shared-edge-checks) to the project rules and import them. Use selectors that each match one visible element. A shared edge has a target offset of `0` CSS px. Use the specified offset for intentional insets. The signed result is the subject coordinate minus the reference coordinate.
3. **Verify.** Select the subject for the ruler. Capture the starting state, then repeat the same check after the edit at the same viewport and state. Confirm the result in the clean render. Report the pair, edge, viewport, state, target and its source, and before/after offsets. If either element is unavailable, report that the alignment was unverified.

## Check overflow at the right scope

Use `horizontal-overflow` on the page to check for unintended horizontal scrolling. The same metric on a component reports how much content extends beyond its visible width. A positive value on an intentionally scrollable filter bar can be expected when there are many chips. Check that only the bar scrolls, the last chip can be fully revealed and activated, keyboard focus brings offscreen controls into view, and there is a visible cue that more filters exist. Capture both ends if the finding depends on reachability. Report clipped or unreachable controls and evaluate reflow separately at 320 CSS pixels.

## Inspect local grids

Open the modal, drawer, card, or form and select its outer container. Layout Cue draws the selected container's CSS Grid tracks and outlines visible nested CSS grids inside it. Labels identify the first nested grid level. Select a smaller composition to bring deeper labels into focus. Read `element.localGrids.grids` in `measure` or the capture JSON for each selector, content box, track sizes, CSS gap, and rendered gap. Narrow the selection if `truncated` is true. Measure again when the same container reflows at a narrower width.

Choose a shared local grid where fields or rows need common alignment. For a simple stack or icon-and-label row, inspect its padding and Flex gap. Use a [region rule](references/rules.md) when the project defines a reference grid independently of the current CSS. Check the composition first, then select an individual field or action to verify its atomic spacing.

When the layout contract specifies a column count, add a `grid-column-count` check with the appropriate viewport bounds. Run the same check before and after the edit and review the clean render to verify wrapping and reading order.

## Work with the guides on

1. **Set the expected layout.** Read the project’s layout and component rules, then check the existing tokens and accepted sibling components. Write down the relationships that matter for the task, such as a shared reading edge, a gap between nav groups, or the inline padding of a button. On a new page, choose these relationships from the brief and record your assumptions. Treat the extension’s default grid as an exploratory guide.
2. **Inspect from the page to the element.** Start guides before editing. Capture the rendered starting point and select the element that owns the problem. Use the report for exact measurements when labels are crowded. For a new page, start once the shell renders and keep the guides on as you add sections and controls.
3. **Edit the source with the selection active.** Compare the measured value to the expected one. Fix the CSS or shared component that owns the relationship. When the dev server applies the edit, check the same element’s guides and measurements before choosing another element. If a reload replaces the element, confirm the restored selection still refers to the intended control. Record the actual value, expected value, and measured result.
4. **Review the clean render.** Capture the corrected guide first, then turn guides off and inspect the actual page. Check grouping, hierarchy, alignment, wrapping, and visible focus at the widths where the layout changes. Include long labels or translated content and relevant open, collapsed, or dense states. Report remaining issues and the widths and states you checked.

| Scope | What to inspect |
| --- | --- |
| Page shell | Use the page guides to check shared reading edges, outer gutters, and how the header, sidebar, main area, and footer adapt at breakpoints. In the clean render, check that recurring actions stay easy to find and the main task gets the most visual emphasis. |
| Groups and repeated components | Use local grid tracks to check alignment and spans within a region. Compare the space between groups separately from the padding and gaps within each component. Keep related items visibly grouped and verify reading order when groups stack. |
| Individual elements | Select the control to inspect its box, padding, and icon-to-label gap. Compare line height and baseline among labels meant to align. Review icon size and stroke within the same family, then judge optical balance at rendered size. Measure the interactive target separately from its glyph. |

For a crowded sidebar, first check whether related links read as a group and adjacent sections have a clear gap. Then select a row and compare its inset and icon-to-label gap with equivalent rows. If the shared component calls for 16 px on each side and the guide reads 8 px on one side, restore the token and remeasure the same selection. Turn off the guide to check the expanded and collapsed sidebar in context.

Use strict checks for explicit expectations such as token values, alignment between named edges, and overflow. Use the project’s type scale to decide whether a baseline should align.

## Design references

- Adobe Spectrum 2 explains how proximity signals relationships, how spacing differs by scope, and how to review icon spacing and stroke within a family. [Spacing](https://spectrum.adobe.com/foundations/layout-and-structure/spacing/overview) · [Icon fundamentals](https://spectrum.adobe.com/page/iconography/)
- Figma shows how to choose guides for the page, nested regions, component padding, and text baselines. [Layout grids](https://www.figma.com/best-practices/everything-you-need-to-know-about-layout-grids/)
- Linear's design refresh is a case study in predictable header actions and visual hierarchy in a dense workspace. [Design refresh](https://linear.app/now/behind-the-latest-design-refresh)

When accessibility is in scope, use WCAG to check reflow, user text-spacing overrides, and actual pointer targets, including applicable exceptions. [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html) · [Text spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html) · [Target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

## Optional unattended captures

Use the CLI when automation needs fresh browser contexts across viewport widths or themes. It requires Node.js 22+ and Playwright Chromium. Set `WITNESS_DIR` to the installed skill directory and install its dependencies there:

```sh
(cd "$WITNESS_DIR" && npm ci && npx --no-install playwright install chromium)
```

Run the CLI from the project so its config and output paths resolve there:

```sh
node "$WITNESS_DIR/scripts/witness.mjs" capture http://localhost:3000 \
  --config ./layout-cue.json --width 1440 --width 390 --strict \
  --out .layout-cue/review
```

Read the generated overlay and JSON report. Capture mode opens a fresh page for each width and theme. See the [rules reference](references/rules.md) for region and check definitions. Use `watch` for the interactive CLI workflow.
