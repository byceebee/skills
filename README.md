# CeeBee Skills

Agent skills from [byceebee](https://ceebee.biz.id).

| Skill | What it does |
| --- | --- |
| [Layout Witness](skills/layout-witness/SKILL.md) | Keep layout guides on a running page and turn browser measurements into evidence a coding agent can act on. |

## Install Layout Witness

```sh
npx skills add byceebee/skills --skill layout-witness
```

You can also copy the entire `skills/layout-witness` directory into your agent's skills folder. Set up Node.js and Chromium using the [skill instructions](skills/layout-witness/SKILL.md).

## Use it on your dev server

Run your app as usual and point Layout Witness at its local URL. The skill runs the inspector from its own directory, so your app can use its existing dev server and dependencies.

The current CLI opens a separate Chromium window for live inspection and uses Playwright for automated captures. Install its dependencies and Chromium once in the skill directory.

<details>
<summary>Try the included demo</summary>

Clone this repository and run these commands from `skills/layout-witness`.

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

The [rules reference](skills/layout-witness/references/rules.md) shows how to define regions and checks for your app.

[MIT license](LICENSE)
