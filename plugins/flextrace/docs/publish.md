# FlexTrace 发布指南（npm）

## 1. 准备

```bash
cd plugins/flextrace
npm install
npm run typecheck
npm run build
```

## 2. 登录 npm

```bash
npm login
npm whoami
```

## 3. 首次发布

当前包名：`flextrace-opencode`

```bash
npm publish --access public
```

## 4. 后续发版

```bash
# patch/minor/major 三选一
npm version patch
npm publish --access public
```

## 5. 发布前检查（推荐）

```bash
npm run pack:check
```

## 6. 在 OpenCode 中按 npm 包安装

发布完成后，你可以在 OpenCode 配置中直接引用包名（示例）：

```json
{
  "plugin": ["flextrace-opencode"]
}
```

如果你的 OpenCode 运行时要求插件默认导出工厂函数，请在包中保持默认导出入口，或在 OpenCode 侧用注册代码包装 `createFlexTracePlugin`。
