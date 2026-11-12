---
name: ceebee-layout-witness
description: Guide layout edits with live browser overlays and measured evidence. Use when implementing or reviewing a running web page against explicit alignment, spacing, or responsive requirements.
license: MIT
---

# Layout Witness

Requires Node.js 22 or later and Playwright Chromium. Watch mode opens a browser window.

Use the running page as evidence while you work. A guide marks where a project expects an edge or column. A check tells you how far the rendered element is from that expectation.

## Prepare the view

1. Identify the route and the UI state the request concerns. Open the state with enough data to expose layout problems, including the parts outside the main content when they matter.
2. Look for a project-owned rules file. If there is none, define a small set of guides and checks using the project's design tokens, an approved reference, or explicit requirements. Use [the rule format](references/rules.md). Leave aesthetic judgments in the visual review.
3. Locate this installed skill directory and use its path for `WITNESS_DIR`. Set up its dependencies if needed.

   ```sh
   (cd "$WITNESS_DIR" && npm ci && npx --no-install playwright install chromium)
   ```

## Work with the guide open

Run the script from the project so the config and output paths resolve there.

```sh
node "$WITNESS_DIR/scripts/witness.mjs" watch http://localhost:3000   --config ./layout-witness.json --width 1440 --theme light --out .layout-witness/live
```

Read `overlay.png` next to `layout.json` before changing CSS. Find the guide, compare the observed and expected values, and locate the rule that owns that edge or gap. After the edit reaches the browser, inspect the same area again. Reload the browser if the dev server requires it. A missing measurement calls for checking the selector, breakpoint, or loaded state. The evidence files update while the browser stays open.

## Review the result

Capture the widths and themes the task supports. Add `--headed` when the final review needs the same browser mode as live work.

```sh
node "$WITNESS_DIR/scripts/witness.mjs" capture http://localhost:3000   --config ./layout-witness.json --width 1440 --width 390 --strict --out .layout-witness/review
```

Review clean screenshots alongside the overlay. Check hierarchy, text wrapping, visible controls, and access to content below the fold. Report the changes the measurements supported and any remaining findings. Close the watch window or stop its command when finished.
