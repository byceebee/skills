# CeeBee Skills

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
node scripts/agent.mjs capture ./ruler.jpg
node scripts/agent.mjs stop
node scripts/agent.mjs capture-clean ./clean.jpg
```

Run `measure` again after a CSS edit. The selected element and its guides stay in the same tab during development. The connection uses Node.js 22+ and Chrome 116+. It stays on the local machine and ends when the connected tab changes origin or closes. See the [skill instructions](skills/layout-cue/SKILL.md) for every command.

## Install the agent skill

```sh
npx skills add byceebee/skills --skill layout-cue
```

You can also copy the entire `skills/layout-cue` directory into your agent's skills folder. Follow the [skill instructions](skills/layout-cue/SKILL.md) for browser and optional CLI setup.

## Optional unattended captures

The CLI remains available for scripted capture runs that need a fresh browser context and Playwright. Manual extension use runs directly in Chrome. The local agent connection uses Node.js. Playwright is needed for this separate capture workflow.

<details>
<summary>Try the included demo</summary>

Clone this repository and run these commands from `skills/layout-cue`.

```sh
npm ci
npx --no-install playwright install chromium
node examples/serve.mjs
```

In another terminal in the same directory, run the live inspector.

```sh
node scripts/witness.mjs watch http://127.0.0.1:4173 --config examples/rules.json
```

Edit a spacing value in the demo and reload the page in the inspector window. The guide follows the new geometry, and the reported evidence directory contains the updated overlay and JSON. Use `capture` with `--strict` to review desktop and mobile in both themes.

</details>

The [rules reference](skills/layout-cue/references/rules.md) shows how to define regions and checks for your app.

[MIT license](LICENSE)
