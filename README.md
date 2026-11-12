# CeeBee Skills

Agent skills with tools you can run from your own projects.

| Skill | What it does |
| --- | --- |
| [Layout Witness](skills/ceebee-layout-witness/SKILL.md) | Keep layout guides on a running page and turn browser measurements into evidence a coding agent can act on. |

## Install Layout Witness

```sh
npx skills add byceebee/skills --skill ceebee-layout-witness
```

You can also copy the entire `skills/ceebee-layout-witness` directory into your agent's skills folder. Set up Node.js and Chromium using the [skill instructions](skills/ceebee-layout-witness/SKILL.md).

## Try the included example

Clone this repository and run these commands from `skills/ceebee-layout-witness`.

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

The example runs locally and can be replaced with a dev URL and rules from any web project. The [rules reference](skills/ceebee-layout-witness/references/rules.md) shows how to define regions and checks.

[MIT license](LICENSE)
