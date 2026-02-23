# FlexTrace

[English](README.md) | [中文](README-zh.md)

> Agent execution tracing and observability for OpenCode  
> Inspired by `perf` / `ftrace`, turning agent runtime behavior into structured, analyzable traces.

------------------------------------------------------------------------

## ✨ Overview

**FlexTrace** currently has two parts:

- `plugins/flextrace`: OpenCode plugin and trace capture core
- `flextrace-dashboard`: local real-time dashboard (Next.js)

Core goals:

- Automatically capture OpenCode session and tool execution traces
- Provide manual instrumentation via `trace_task / trace_event / trace_counter`
- Organize trace files by root-session
- Support local dashboard analysis and Perfetto export

------------------------------------------------------------------------
## ⚡ Quick Start

### Step 1 - Install and enable plugin

Install:

```bash
npm install flextrace-opencode@latest
```

Add this to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "flextrace-opencode@latest"
  ]
}
```

Restart OpenCode, then run `status` to confirm the plugin is loaded.

### Step 2 - Run any agent task

For example:

```text
Help me fix this failing test and make sure all tests pass.
```

The plugin will automatically write traces to:

```text
~/.flextrace/<project_id>/
  _capture.ndjson
  <root_session_id>.ndjson
```

### Step 3 - Open dashboard

```bash
cd flextrace-dashboard
npm install
npm run dev
```

Open the local URL in your browser (default Next.js port) to view the real-time dashboard:

1. Metrics panel: shows live counts for sessions, agents, and tasks, plus current task status and timing.

2. TRACE TIMELINE: shows per-agent/per-task runtime traces and highlights agent invocation relationships.

![Demo Kanban](./doc/png/kanban.png)

------------------------------------------------------------------------

### 🔎 Export to Perfetto (Optional)
Supports both CLI export and direct export from Kanban.

```bash
tracectl export ~/.flextrace/<project_id>/<root_session_id>.ndjson \
  --out ./trace.chrome.json \
  --format chrome-trace
```

![Kanban Export Perfetto](./doc/png/export-perfetto.png)

Perfetto example:
<https://ui.perfetto.dev>
![Perfetto View](./doc/png/perfetto.png)

------------------------------------------------------------------------

## 🎬 Demo

- Quick start demo: `demo/README.md`
- Includes: skill install check, `@pm` multi-role collaboration trigger, and dashboard linkage view

------------------------------------------------------------------------

## 🚀 Core Capabilities

### 1️⃣ Multi-session / Root-session tracing

- Split `.ndjson` files by `rootSessionId`
- Parent-child session relationships supported (`parentSessionId`)
- Dashboard can load and filter multiple root-session files at once

### 2️⃣ Automatic activity capture

The plugin maps OpenCode events into visual tasks:

- `reasoning` parts -> `activity:reasoning`
- `tool` parts -> `activity:tool` or `activity:coding` (via tool whitelist)
- assistant turns -> `agent_run:*`

### 3️⃣ Manual instrumentation API (tool-level)

#### `trace_event`

```json
{ "tool": "trace_event", "args": { "name": "phase.spec_ready", "attrs": { "agent": "pm", "activity": "reasoning" } } }
```

#### `trace_task`

```json
{ "tool": "trace_task", "args": { "op": "start", "name": "phase:spec", "attrs": { "agent": "pm", "activity": "reasoning" } } }
{ "tool": "trace_task", "args": { "op": "end", "status": "ok" } }
```

#### `trace_counter`

```json
{ "tool": "trace_counter", "args": { "name": "artifact.count", "value": 3, "attrs": { "agent": "dev", "activity": "coding" } } }
```

### 4️⃣ Analysis and export

- `tracectl analyze`: output summary (task count, error count, P95, slow tasks)
- `tracectl export`: export JSON / CSV / Chrome Trace
- `tracectl serve`: start lightweight local viewer

------------------------------------------------------------------------

## 🏗 Architecture Overview

```text
                 OpenCode Runtime
                        |
        +---------------+----------------+
        |                                |
   SSE / Event Stream              Tool Hooks
(session/message/part)       (tool.execute.before/after)
        |                                |
        +---------------+----------------+
                        v
                 flextrace-opencode
                        |
              +---------+---------+
              |                   |
       NDJSON Session Writer   Trace Tools
      (~/.flextrace/<project>) task/event/counter
              |
     +--------+-----------------------------+
     |                                      |
plugins/flextrace CLI                flextrace-dashboard
(analyze/export/serve)               (Timeline / Sessions / Events)
```

------------------------------------------------------------------------

## ⚙️ Configuration

Environment variables:

```bash
FLEXTRACE_ROOT=~/.flextrace
FLEXTRACE_MAX_PROJECT_BYTES=1073741824
```

These are default values. You can override them with environment variables, or adjust them in Kanban Settings.

------------------------------------------------------------------------

## 📜 License

MIT License
