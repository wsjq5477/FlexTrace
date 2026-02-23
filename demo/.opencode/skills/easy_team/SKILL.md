---
name: easy_team
description: PM统一编排的四角色协作机制，模拟团队需求交付
---

# Skill: Easy Team

## 目标
采用统一编排的多Agent协作机制简单模拟团队需求交付。

## 触发守卫（必须）
- 仅当当前主会话为 `pm` agent 时，才允许执行本 skill。
- 若当前主会话不是 `pm`（例如 `build`），必须拒绝执行，并提示用户先执行 `/agent pm`。
- 本 skill 不接受在非 `pm` 主会话下的隐式触发。

## 强制执行规则（必须遵守）
- **先用 `/agent pm` 切换到 `pm` 主会话**，再由 PM 执行第一步需求分析。
- PM 之后必须调度 3 个角色实例：`se / dev / qa`。
- 必须使用固定角色身份：`PM / SE / DEV / QA`（其中 PM 是主会话角色）。
- 不得由 SE/DEV/QA 反向拉起 PM，也不得由主代理以外角色执行编排。
- PM 主角色不得单人完成四个角色的工作，不得跳过角色实例调度步骤。
- 若任一角色实例未成功启动，PM 必须重试，直到 `SE / DEV / QA` 全部可用后再继续执行。
- 最终输出必须包含 4 个角色的分工与工作记录（可追溯到角色产物）。

## 运行时兼容说明
- 若运行时接口要求 `subagent_type`，禁止使用 `pm`。
- PM 必须由 `pm` agent 承担（不要由 `build` 或其他默认主会话直接扮演）。
- `@pm` 仅可作为沟通辅助，不视为主会话切换指令；必须使用 `/agent pm` 完成切换。
- 角色实例必须使用 `se`、`dev`、`qa`。
- 禁止在任何情况下将 `se/dev/qa` 降级为 `general`。
- 若出现 `ProviderModelNotFoundError`（或等价模型不可用错误），必须停止调度并上报环境配置问题，不得继续执行。

## 角色与责任

### PM（项目经理）
- 唯一客户接口：接收需求、澄清范围、确认优先级。
- 拆解任务并分派给 SE、DEV、QA。
- 跟踪进度、同步风险、组织角色对齐。
- 汇总所有过程件与结论，对客户输出最终状态。

### SE（架构师）
- 基于 PM 提供的需求上下文完成技术分析。
- 输出方案设计、系统边界、关键技术决策、风险点。
- 回答 DEV 的设计问题并维护方案一致性。

### DEV（开发）
- 按 SE 方案进行实现。
- 完成自测/联调/必要自动化测试。
- 输出实现说明、测试结果、已知问题与回退方案。

### QA（质量）
- 不主导编码测试执行，主责是检查报告与交付件完整性。
- 校验文档一致性（需求-方案-实现-测试）。
- 输出缺失项清单、阻塞项、最终质量结论。

## 标准执行流（单轮）
1. 先执行 `/agent pm` 切换到 `pm` 主会话，由 PM 完成第一步需求分析并产出任务简报。
2. PM 调度 3 个角色实例：`se`、`dev`、`qa`，并确认全部就绪。
3. PM 分派 SE 分析，SE 输出架构方案。
4. PM 组织方案对齐后，分派 DEV 实现与测试，QA 准备好审查清单。
5. DEV 提交实现与测试报告，和SE一起对比方案与实现的一致性。
6. PM 分派 QA 做完整性审查。
7. QA 输出检查清单与结论。
8. PM 汇总并向客户同步结果与下一步计划。

## 产物约定（无预置模板）
不再依赖 skill 目录下的预置 `.md` 模板文件。所有产物由固定 agents 在执行时生成。

结果统一生成在 `easy_team_output/`，按照角色分目录存放：
- `easy_team_output/pm/customer-brief.md`：客户输入与范围定义
- `easy_team_output/pm/customer-sync.md`：对外同步记录
- `easy_team_output/se/architecture.md`：技术方案与风险
- `easy_team_output/dev/implementation.md`：实现说明
- `easy_team_output/dev/test-report.md`：测试结果
- `easy_team_output/qa/qa-checklist.md`：完整性审查结果

## 启动检查清单（执行前）
- [ ] 已通过 `/agent pm` 进入 `pm` 主会话并完成第一步需求分析
- [ ] 已调度 `se` 角色实例
- [ ] 已调度 `dev` 角色实例
- [ ] 已调度 `qa` 角色实例
- [ ] 四个角色职责已明确且无重叠

## 协作边界
- PM 只做拉通与决策同步，不替代 SE 做方案设计，不替代 DEV 写代码，不替代 QA 审查。
- SE 负责“怎么设计”，DEV 负责“怎么实现并验证”，QA 负责“是否完整可审”。
- 角色只修改自己目录下文件；跨角色变更由 PM 协调。
- PM 未调度 SE/DEV/QA 三个角色实例前，禁止进入设计、编码、测试、审查步骤。

## 完成定义（DoD）
- 已按固定角色执行：PM（主会话）+ `se/dev/qa` 三个角色实例。
- PM 已完成编排，并成功调度 `se/dev/qa` 三个角色实例。
- 四个角色（PM/SE/DEV/QA）均有对应产出内容。
- 需求范围已在 `easy_team_output/pm/customer-brief.md` 明确。
- 方案在 `easy_team_output/se/architecture.md` 可执行且风险已标注。
- 实现与测试结果在 `easy_team_output/dev/implementation.md`、`easy_team_output/dev/test-report.md` 完整。
- QA 在 `easy_team_output/qa/qa-checklist.md` 给出可追溯结论。
- PM 在 `easy_team_output/pm/customer-sync.md` 完成对客户的最终同步。
