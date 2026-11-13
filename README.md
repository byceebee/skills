# byceebee skills

Agent skills from [byceebee](https://ceebee.biz.id).

| Skill | What it does |
| --- | --- |
| [Layout Cue](skills/layout-cue/SKILL.md) | Keep layout guides on a running page and turn browser measurements into evidence a coding agent can act on. |

## Inspect an existing browser tab

Clone this repository or [download the ZIP](https://github.com/byceebee/skills/archive/refs/heads/main.zip). Load its `skills/layout-cue` directory as an unpacked extension in Chrome.

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select the `skills/layout-cue` directory. It contains the extension manifest.
3. Open the page you want to inspect, then open Layout Cue from the toolbar.

Choose **Start guides** on the active HTTP(S) tab. For project-specific checks, open **Layout rules**, choose **Import rules**, and select a JSON file using the [rules reference](skills/layout-cue/references/rules.md).

Choose **Inspect element** and pick a button, icon, or layout region. Click it, or focus it and press Enter. Reopen Layout Cue to see the rendered box, spacing, typography, grid tracks, and SVG measurements when available. **Download report** saves the page checks and selected element together as `layout-cue.json`.

Chrome can restore the guide after a reload while it retains extension access to that page on the same origin. After navigating to another origin, activate the extension again from the toolbar. Imported rules are stored separately for each origin. Inspection and rule storage run locally in Chrome.

## Let an agent control the active tab

On macOS or Linux with Google Chrome, copy the extension ID shown under Layout Cue on `chrome://extensions`. From `skills/layout-cue`, register the local audit host once.

```sh
npm ci --omit=dev
node scripts/install-native.mjs <extension-id>
```

On your development tab, choose **Layout Cue → Agent access → Connect audit tab**. The terminal can now send commands and read the live JSON. The local host starts when you connect the tab.

```sh
node scripts/agent.mjs navigate /dashboard
node scripts/agent.mjs click '[aria-label="Open details"]'
node scripts/agent.mjs start
node scripts/agent.mjs select 'header [aria-label="Search"]'
node scripts/agent.mjs measure
node scripts/agent.mjs capture-pair ./search
```

Run `measure` again after a CSS edit. The selected element and its guides stay in the same tab during development. The connection uses Node.js 22+ and Chrome 116+. It stays on the local machine and ends when the connected tab changes origin or closes. See the [skill instructions](skills/layout-cue/SKILL.md) for every command.

## Install the agent skill

```sh
npx skills add byceebee/skills --skill layout-cue
```

You can also copy the entire `skills/layout-cue` directory into your agent's skills folder. Follow the [skill instructions](skills/layout-cue/SKILL.md) for browser and optional CLI setup.

## Try a layout regression

The included demo has a workspace, a form dialog, and a deliberate regression. At **360 × 812 CSS px**, the Save action starts below the dialog's visible area. The **8 px** gap between the actions still passes.

1. From `skills/layout-cue`, run `node examples/serve.mjs` and open [the audit demo](http://127.0.0.1:4173/?audit).
2. Set the tab to **360 × 812 CSS px** with your browser's viewport tools. Connect Layout Cue to this tab and keep it in the foreground.
3. Import the demo rules and run the before phase.

```sh
node scripts/agent.mjs import examples/audit-rules.json
node scripts/replay.mjs examples/audit-recipe.json before ./audit-evidence
```

The imported rule measures Save clipping. For a separate scan of possible layout issues in the open dialog, run `node scripts/agent.mjs discover '#demo-edit-dialog[open]'`.

In [audit.css](skills/layout-cue/examples/audit.css), replace `max-height: 354px` with `max-height: calc(100dvh - 32px)`. Run the same recipe again. The Save visibility check should now pass, and the action gap should still measure **8 px**.

```sh
node scripts/replay.mjs examples/audit-recipe.json after ./audit-evidence
node scripts/agent.mjs export-rules ./audit-rules-export.json
```

Each phase writes a ruler screenshot, clean screenshot, and measurement JSON. The after manifest reports the check deltas and whether the viewport, theme, route, and scroll position matched. To try the live two-element ruler, choose **Compare spacing** in the extension popup, click the first element, then hover and click the second.

[Live inspection and replay guide](skills/layout-cue/references/live-inspection.md) · [Rules reference](skills/layout-cue/references/rules.md)

## Optional unattended captures

Use [the separate Playwright capture workflow](skills/layout-cue/SKILL.md#optional-unattended-captures) for fresh browser contexts across widths and themes. The Chrome extension and its local agent commands run without Playwright.

[MIT license](LICENSE)
