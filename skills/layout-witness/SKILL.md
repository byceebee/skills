---
name: layout-witness
description: Build and refine web layouts with persistent browser guides, from the page shell to individual controls. Use when implementing or reviewing alignment, spacing, typography, icons, or responsive layout on a running page.
license: MIT
---

# Layout Witness

Make the page easier to scan and use. Give related elements a clear grouping, keep repeated components consistent, and preserve those relationships as content and viewport size change. Use the guides to decide what to fix while you edit.

Use the Chrome extension on the existing development tab. Pair its local agent connection to control guides and read page and element measurements as JSON in the terminal. Use the optional Playwright CLI for unattended captures in fresh browser contexts.

## Connect to the existing tab

Load the complete `layout-witness` skill directory as an unpacked extension from `chrome://extensions`. Use Chrome 116 or later.

1. Set `WITNESS_DIR` to the installed skill directory. Run `(cd "$WITNESS_DIR" && npm ci --omit=dev)` once, then start `node "$WITNESS_DIR/scripts/agent.mjs" serve` in a persistent terminal.
2. Open Layout Witness from the toolbar on the development tab. Under **Agent access**, paste the pairing URL printed by the terminal and choose **Connect agent**. This authorizes the one tab. If access is missing, ask the user to pair that tab once.
3. Use the CLI from any terminal on the same machine. Keep the local server running during edits.

```sh
node "$WITNESS_DIR/scripts/agent.mjs" start
node "$WITNESS_DIR/scripts/agent.mjs" select 'header [aria-label="Search"]'
node "$WITNESS_DIR/scripts/agent.mjs" measure
# Edit the project's CSS and wait for the dev server to apply it.
node "$WITNESS_DIR/scripts/agent.mjs" measure
```

`measure` prints page regions, check results and the currently selected element when available. That element can include its rendered box, margin, border, padding, grid and gap values, typography (including viewport baseline Y when measurable), and SVG geometry. Use a selector that matches one visible element. Keep the selection while editing and read its JSON again after the browser applies the change.

Use `status` to check the connection, `clear` to remove only the element guide, `pick` for manual click selection, `import <rules.json>` to load [project rules](references/rules.md), and `defaults` to restore default rules. Use `stop` to remove both guides and clear the selection for clean review. Use `start` and `select` to resume. Use `disconnect` when done if the tab should stop accepting commands. Same-origin reloads can restore guides and a selection on the same route. A different origin or tab closure ends the pairing.

For manual review, use **Start guides**, **Inspect element**, and **Stop guides** in the toolbar popup. **Download report** is available when you want to save a copy.

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

Use strict checks for explicit expectations such as token values, alignment between named edges, and overflow. Judge hierarchy and optical balance in the rendered page. Use the project's type scale to decide whether a baseline should align.

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
  --config ./layout-witness.json --width 1440 --width 390 --strict \
  --out .layout-witness/review
```

Read the generated overlay and JSON report. Capture mode opens a fresh page for each width and theme. See the [rules reference](references/rules.md) for region and check definitions. Use `watch` for the interactive CLI workflow.
