# Demo 1：使用 `easy_team` 完成计算器协作任务

本 Demo 用于验证：

- 在多 Agent 协作下完成一个 Python 小项目
- FlexTrace 能正确记录 Session/Agent/Task 时间线

## 运行步骤

### 1. 在 `demo` 目录启动 OpenCode

```bash
cd demo
opencode
```

### 2. 检查 Skill 是否已安装

在 OpenCode 中输入：

```text
/skills
```

确认列表中包含：`easy_team`。

### 3. 检查固定 Agents 是否存在

在 OpenCode 中输入：

```text
/agent
```

确认列表中包含：`pm`、`se`、`dev`、`qa`。

### 4. 执行 Demo 任务

在 OpenCode 中输入：

```text
/agent pm
```

确认当前主会话已切换为 `pm` 后，再输入：

```text
设计一个python的计算器程序，输入两个数，支持10000以内输入的加减法。
```

## 观测验证（FlexTrace）

执行后，可在看板中看到多 Agent 的协作过程。

Kanban 视图：

![Demo 1 Kanban](./png/kanban.png)

Timeline 视图：

![Demo 1 Timeline](./png/demo1-timeline.png)
