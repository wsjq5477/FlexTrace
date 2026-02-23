# FlexTrace v2 打点案例（易用优先）

## 1. 单 Agent 最小模板

```json
{ "tool": "trace_task", "args": { "op": "start", "name": "agent_run:pm", "attrs": { "agent": "pm", "activity": "agent_run", "phase": "TR1" } } }
{ "tool": "trace_task", "args": { "op": "start", "name": "activity:reasoning", "attrs": { "agent": "pm", "activity": "reasoning", "phase": "TR1" } } }
{ "tool": "trace_event", "args": { "name": "plan.generated", "level": "info", "attrs": { "agent": "pm", "activity": "reasoning", "phase": "TR1" } } }
{ "tool": "trace_task", "args": { "op": "end", "status": "ok", "attrs": { "agent": "pm", "activity": "reasoning", "phase": "TR1" } } }
{ "tool": "trace_task", "args": { "op": "start", "name": "activity:coding", "attrs": { "agent": "pm", "activity": "coding", "phase": "TR1" } } }
{ "tool": "trace_counter", "args": { "name": "artifact.count", "value": 3, "attrs": { "agent": "pm", "activity": "coding", "phase": "TR1" } } }
{ "tool": "trace_task", "args": { "op": "end", "status": "ok", "attrs": { "agent": "pm", "activity": "coding", "phase": "TR1" } } }
{ "tool": "trace_task", "args": { "op": "end", "status": "ok", "attrs": { "agent": "pm", "activity": "agent_run", "phase": "TR1" } } }
```

## 2. Skill 场景模板

```json
{ "tool": "trace_task", "args": { "op": "start", "name": "skill:risk_scan", "attrs": { "agent": "se", "activity": "tool", "phase": "TR2", "skill": "risk_scan" } } }
{ "tool": "trace_event", "args": { "name": "risk_scan.started", "attrs": { "agent": "se", "activity": "tool", "phase": "TR2", "skill": "risk_scan" } } }
{ "tool": "trace_counter", "args": { "name": "risk.item.count", "value": 12, "attrs": { "agent": "se", "activity": "tool", "phase": "TR2", "skill": "risk_scan" } } }
{ "tool": "trace_task", "args": { "op": "end", "status": "ok", "attrs": { "agent": "se", "activity": "tool", "phase": "TR2", "skill": "risk_scan" } } }
```

## 3. 命名建议

- `name`: `agent_run:<agent>`、`activity:<type>`、`skill:<name>`
- `attrs.agent`: `pm/pdm/se/dev/qa/reviewer`
- `attrs.activity`: `agent_run/reasoning/coding/tool`
- `attrs.phase`: `TR1/TR2/TR3...`

## 4. 常见坑

- `trace_event` 缺少 `name`
- `trace_counter` 缺少 `name/value`
- `trace_task start` 后忘记 `end`
- 长会话不传 `taskId` 导致 end 错配
