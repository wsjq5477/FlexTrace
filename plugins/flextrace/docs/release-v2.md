# FlexTrace v2.0.0 Release Notes

## Breaking Changes

- `trace_span` removed, use `trace_task`
- `trace_emit` removed, use `trace_event`
- record type renamed: `span_start/span_end` -> `task_start/task_end`
- field renamed: `spanId/parentSpanId` -> `taskId/parentTaskId`
- config renamed: `includeSpanTool` -> `includeTaskTool`

## New UX

- task/event/counter 三分模型
- dashboard timeline 支持 event 双重显示：
- lane 内 marker（有 parentTaskId）
- 独立 Event Track（全量事件）

## Migration Checklist

1. 替换所有工具名（span/emit -> task/event）
2. 更新脚本解析字段（spanId -> taskId）
3. 重新生成并验证 `trace.ndjson`
4. 使用 `tracectl analyze/export/serve` 验证端到端
