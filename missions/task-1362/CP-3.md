# CP-3: Create config/integration-pipelines.json with lib gate entry

## Work Done

Created `config/integration-pipelines.json` with a `lib` gate entry mapping to the command `./scripts/verify-local.sh static-analysis`.

Config content:
```json
{
  "gates": {
    "lib": {
      "command": "./scripts/verify-local.sh static-analysis",
      "order": 1,
      "run_last": false
    }
  }
}
```

Verified the config is valid JSON and loadable by `loadIntegrationConfig`.

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | File exists and is valid JSON | `JSON.parse(fs.readFileSync('./config/integration-pipelines.json'))` succeeds |
| 2 | Contains `gates.lib` entry | `config.gates.lib.command === './scripts/verify-local.sh static-analysis'` |
| 3 | Gate has `order` and `run_last` fields | `order: 1`, `run_last: false` |

## Next action
Add unit tests for `lib` area detection and gate execution in `test/integration-pipelines.test.js` (CP-4).
