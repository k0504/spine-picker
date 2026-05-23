# spine-picker

在涉及前端的编码过程中，不知道如何向 LLM 描述指定的网页元素或结构？"右侧栏第二个按钮"太模糊，整段 DOM 又会撑爆 context window。spine-picker 将具结构意义的描述（祖先链 + 唯一 CSS selector，已自动过滤框架产生的 hash class 噪音）直接复制到剪贴板。

## 功能

- 鼠标 hover 任意元素显示蓝色 overlay，标示当前指向的标签
- 点击复制从 `<html>` 到 target 的祖先链，附 `<!-- TARGET -->` 标记
- 自动过滤 hash class（styled-components / Emotion / CSS Modules）、过长属性值与 inline event handler；保留语意属性（`id`、`role`、`aria-*`、`data-*`、`href`、`src` 等）
- **同级展开**（`S`）：列出 target 同层所有兄弟元素，含 `(child N/M)` 位置标记
- **探到最底层**（`D`）：把 target 的所有子孙递归展开直至叶节点（上限 300 个元素）
- **中英文界面切换**（`L`）：英／中切换；剪贴板输出维持英文（给 LLM 的 payload 不混 locale）

## 键盘快捷键

| 按键 | 动作 |
|-----|--------|
| `Ctrl+Shift+E` | 启动／停用拾取模式 |
| `Esc` | 取消拾取 |
| `S` | 切换"同级展开"（拾取中） |
| `D` | 切换"探到最底层"（拾取中） |
| `L` | 切换 UI 语言（拾取中） |

三项设置（`S` / `D` / `L`）同时提供于 Tampermonkey 菜单，状态持久化于 GM storage。

## 剪贴板输出范例

```
<!-- url:        https://example.com/some/page -->
<!-- selector:   main > article > h2:nth-of-type(2) -->
<!-- depth:      7 layers (html > body > div > main > article > h2) -->
<!-- siblings:   pruned -->
<!-- descendants:pruned -->

<html lang="en">
  <body class="page-content">
    <div id="root">
      <main class="main">
        <article class="post">
          <h2 class="post-title">  <!-- TARGET -->
            这是 target 的文字内容
            <!-- ...3 child nodes omitted... -->
```

## 已知限制

- 严格 CSP（`script-src 'self'`、无 `unsafe-inline`）站点上，Tampermonkey 的部分注入模式可能让 `GM_addStyle` 行为退化。多数站点不受影响。
- 对 Shadow DOM 内部元素的拾取依赖 `elementFromPoint` 是否穿透 shadow root；本脚本不主动穿透 closed shadow root。
- 同级展开只列 target 自身的兄弟，不展开祖先层级的兄弟（设计决定，避免输出过长）。

## 源代码 / 议题反馈 / 贡献

完整源代码、开发流程、AGENTS 层级导航与 issue tracker：
**https://github.com/k0504/spine-picker**

授权：[MIT](https://github.com/k0504/spine-picker/blob/main/LICENSE)
