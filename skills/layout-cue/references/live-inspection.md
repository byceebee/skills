# Live inspection

## Capability map

| Scope | What the extension shows and measures | How to use it |
| --- | --- | --- |
| Page and shell | Viewport and theme, region outlines, planned column guides, and rule findings. The default content guide uses 4 columns below 640 CSS px, 8 at 640–1023, and 12 from 1024. Unresolved default content uses a viewport grid. | Check the main reading edge, gutters, and shell regions. Default header and sidebar selectors draw outlines when they resolve. Select those regions or define project guides to inspect their internal structure. |
| Modal, drawer, card, form, or repeated group | Selected box, insets, CSS Grid or Flex properties, and detectable nested CSS Grid tracks. Local grid JSON includes track sizes, content boxes, CSS gaps, and rendered gaps where measurable. | Select the composition in the rendered state. Use actual grid tracks to verify layout and a custom region to draw a separately specified reference. For a stack or flex group, compare its insets, gaps, and shared edges. |
| Atomic element | Rendered box, margin, border, padding, layout properties, and computed typography. The ruler can mark line height and a text baseline where measurable. SVG measurements can include the rendered box, viewBox, artwork bounds, and stroke widths. | Pick a specific control, text node's containing element, or SVG. Measure the interactive target and its glyph separately. Compare repeated labels and icons in context, then judge optical alignment in the clean render. |
| Relationships and responsive checks | Absolute box edges, shared-edge offsets, dimensions, padding, CSS gaps, type size, line height, SVG stroke, horizontal overflow, and CSS Grid column count. Checks can apply within width ranges and report pass, fail, or unavailable. | Derive expectations from the brief, tokens, or approved peers. For a visible gap between two boxes, measure each in the same stable viewport and subtract adjacent edges. Use an explicit rule for an expectation the tool can verify. See [rule metrics](rules.md). |

The planned page grid and actual CSS tracks answer different questions. A page can show `4 columns · Default` while a card correctly has one CSS column. A checks-only import keeps the default grid. A usable custom column region overrides it at its configured width.

## Live controls

Run these commands through `node "$WITNESS_DIR/scripts/agent.mjs" <command>`.

| Action | Commands and behavior |
| --- | --- |
| Connect and verify | In the popup choose **Agent access → Connect audit tab** after one-time native host setup. `status` confirms the pairing and current guide state. Use `serve` and manual pairing only when needed. |
| Open an audit state | `navigate <route-or-url>` stays on the paired origin. `click <selector>` activates a unique, visible, enabled, unobstructed target. Wait for the intended state and transition to settle. Use browser controls for viewport, theme, keyboard, scrolling, or interactions outside these commands. |
| Control guide focus | `start [selector]` turns on the page guides and selects the named element or an automatic starting point. `select <selector>` moves the ruler to one matching visible element. `pick` waits for a manual page click. `clear` removes only the element selection and its local guides. `stop` removes both overlays and clears selection. |
| Read and set expectations | `measure` prints the current report. Read `checks` and the selected `element` even when a label is crowded or absent. `import <rules.json>` replaces the rules for the current origin. Include existing relevant checks when extending a rules file. `defaults` removes the saved custom rules for that origin. |
| Save evidence | `capture <new.jpg>` saves the visible Chrome tab and matching measurement JSON. Bring the selected target into view and the paired tab to the foreground. `stop` then `capture-clean <new.jpg>` saves the clean visible tab. Use distinct filenames and verify the images. |
| Finish | `start [selector]` restores guides after clean review. `disconnect` ends agent access. A same-origin reload can restore the guides and a selector on the same route. Confirm the resulting selection after reload or state changes. |

The popup also offers manual selection and report download. The agent can use live JSON directly. **Page** and **Element** switch popup reports and leave the page overlays as they are.

## When a guide is absent or crowded

- For the page, verify `report.grids` and `report.regions` in `status`, or `grids` and `regions` in `measure`. A region may be outside the configured width, hidden, or matched ambiguously. Page-level defaults can still be available.
- For a composition, check `element.selector` and `element.localGrids`. Select the open panel or card itself. Choose a smaller nested container when `truncated` is true or a deeper grid needs its labels. An empty grid list can be normal for Flex or block flow. A detected grid can also have unplottable tracks, such as an unresolved subgrid or unsupported writing direction. Check the reported tracks and use box measurements when track positions are unavailable.
- For an atomic target, select it explicitly and verify `element.selector`. If labels overlap, use JSON for exact values. If the ruler is missing from a screenshot, check the target is visible and in frame. Verify the overlay in the actual render before counting it as captured. A visible target and returned JSON alone do not establish that the ruler is visible above the component.
- For a rule, check width bounds, selector uniqueness, and the reported reason. A missing measurement is unverified. Visual hierarchy, reading order, optical balance, and reachability still require looking at or interacting with the rendered UI.

## Walk through a composed state

For an open edit drawer, use the shell view to check the drawer boundary and its relationship to the page. Select the drawer, then its form or footer. Scope selectors to the open panel in the rendered DOM, including when a portal places it outside the main region. Check their content insets, field grouping, and which region scrolls. Select one field, the primary action, and any icon control implicated in a finding. Apply the same approach to a modal or a card, using the state and peer components relevant to the brief.

For each correction, state the expected relationship and its source, capture the starting measurement, edit the owning CSS or component with the guides on, and remeasure the same selector at the same viewport and state. Then check where the layout reflows. For example, a form that should have one column on mobile and two on desktop can use width-bounded `grid-column-count` checks. Verify keyboard focus and scroll reachability in the browser. Check the clean render for wrapping and order. Keep clean and ruler evidence from the same viewport, theme, state, and scroll position.
