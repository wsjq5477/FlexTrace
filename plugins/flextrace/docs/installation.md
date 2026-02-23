# FlexTrace Installation Guide

## Prerequisites

- Node.js >= 20
- Access to your OpenCode config file (`~/.config/opencode/opencode.json`)

## Install

```bash
npm install flextrace-opencode@latest
```

## Configure OpenCode (`~/.config/opencode/opencode.json`)

Add the plugin entry:

```json
{
  "plugin": [
    "flextrace-opencode@latest"
  ]
}
```

Notes:

- If `plugin` already exists, append this item and keep existing plugins.
- You can pin a fixed version (for example `flextrace-opencode@2.0.0`) for reproducibility.

## Verify

1. Restart OpenCode.
2. Run `status` in OpenCode and confirm `flextrace-opencode` is loaded.
3. Run one workflow that includes agent/tool activity.
4. Check `~/.flextrace/<project_id>/` for `<root_session_id>.ndjson`.
5. Confirm record types include:
- `capture_start`
- `task_start` / `task_end`
- `tracepoint`

## CLI

```bash
cd plugins/flextrace

node dist/src/cli.js analyze ./trace.ndjson
node dist/src/cli.js export ./trace.ndjson --out ./trace.json --format json
node dist/src/cli.js export ./trace.ndjson --out ./trace.csv --format csv
node dist/src/cli.js export ./trace.ndjson --out ./trace.chrome.json --format chrome-trace
node dist/src/cli.js serve ./trace.ndjson --port 7399
```

## Troubleshooting

- No trace file generated:
- confirm `~/.config/opencode/opencode.json` includes `flextrace-opencode`
- confirm `status` shows the plugin loaded
- confirm real tasks ran (idle sessions may not produce full business records)

- `task_start` exists but no `task_end`:
- check workflow logic for missing end calls
- use explicit `taskId` for long-running flows

- `trace_event` unavailable:
- verify plugin tools are loaded correctly in runtime
