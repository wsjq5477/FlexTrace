# FlexTrace 实时看板（Task/Event）

看板核心能力：

- 按 Agent 展示任务时间轴（task）
- 展示事件点（event）
- 聚合 activity 统计与实时运行任务

## 启动

```bash
cd plugins/flextrace
node dist/src/cli.js serve ./trace.ndjson --port 7399
```

打开 `http://127.0.0.1:7399`。

## 推荐埋点字段

- `attrs.agent`
- `attrs.activity`
- `attrs.phase`

这些字段用于 lane 分组与聚合统计。

## 前端时间轴显示约定

- task: 横向条块（有开始/结束）
- event: 细竖线 + 小圆点（瞬时）
- event 双重显示：
- 挂在 parentTaskId 时，显示在对应 task lane 内
- 同时显示在独立 Event Track

## 故障排查

- 任务一直 running：
- 检查是否缺少 `trace_task end`

- 事件没挂到任务：
- 检查触发时是否有活跃 task
- 或显式关联 `parentTaskId`
