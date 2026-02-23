# 兼容性说明（v2）

## FlexTrace 协议

v2 仅支持 Task/Event 协议：

- `task_start` / `task_end`
- `tracepoint`
- `counter`

字段：

- `taskId`
- `parentTaskId`

## 与 v1 的关系

v2 是破坏性升级：

- 不再读取 `span_start/span_end`
- 不再支持工具名 `trace_span/trace_emit`

## 外部工具接入

### Perfetto / Chrome Trace

支持：`tracectl export --format chrome-trace`

```bash
npx tracectl export ./trace.ndjson --out ./trace.chrome.json --format chrome-trace
```

### OpenTelemetry

当前仓库未提供直接 OTLP exporter；可基于 `trace.ndjson` 做二次转换。
