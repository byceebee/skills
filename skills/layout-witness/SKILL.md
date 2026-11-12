---
name: layout-witness
description: Guide layout edits with browser overlays and measured evidence. Use when implementing or reviewing a running web page against explicit alignment, spacing, or responsive requirements.
license: MIT
---

# Layout Witness

Use the Chrome extension first when the page is already open in a logged-in browser tab. It inspects the current page without signing in again or opening a separate browser. Load the extension directly in Chrome. Use the optional Playwright CLI for unattended captures in fresh browser contexts.

## Inspect an existing tab

Load the unpacked extension from the complete installed skill folder:

1. Open `chrome://extensions` and enable Developer mode.
2. Select **Load unpacked**, then choose the entire `layout-witness` skill directory. Its root contains `manifest.json`.
3. Open the target page in Chrome and select Layout Witness from the toolbar.
4. Choose **Start guides** to add guides to the active HTTP(S) tab. The default has guides only. To load project-specific rules, select **Import rules** and choose a file in the [rules format](references/rules.md).
5. Review the popup's report summary. Choose **Download report** to save `layout-witness.json` for a detailed comparison.
6. Choose **Stop guides** to remove the overlay.

The extension restores the guides on same-origin reloads while Chrome retains access. Activate it again after moving to another origin. Rules and measurements stay in the browser until you export a report.

Read the downloaded report before editing. If you need the path, ask the user or locate the report in Chrome's Downloads folder. Compare the measured and expected values, make the targeted edit, then use a new report from the same tab to verify the correction. Inspect the rendered page as well for wrapping, hierarchy, and visible controls.

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
