# spine-picker

[English](./README.md) | [繁體中文](./README.zh-TW.md) | **简体中文**

在涉及前端的编码过程中，不知道如何向 LLM 描述指定的网页元素或结构？"右侧栏第二个按钮"太模糊，整段 DOM 又会撑爆 context window。spine-picker 让你用鼠标对着元素一点，将具结构意义的描述（祖先链 + 唯一 selector，已自动过滤框架产生的 hash class 噪音）直接复制到剪贴板。

于任意网页上拾取元素，将其祖先脊椎（精简 HTML 开放标签链 + 唯一 CSS selector）复制到剪贴板。输出格式针对 LLM 场景设计，贴入对话即可让模型准确理解用户所指的是哪一个 UI 元素。

对于 styled-components、Emotion、CSS Modules 等会产生 hash class 的框架，会自动过滤掉这类噪音；最终输出的 selector 以可读类名 + `:nth-of-type` 构成。

## 功能

- 鼠标 hover 任意元素显示蓝色 overlay，标示当前指向的标签
- 点击复制从 `<html>` 到 target 的祖先链，附 `<!-- TARGET -->` 标记
- 自动过滤 hash class、过长属性值与 inline event handler；保留语意属性（`id`、`role`、`aria-*`、`data-*`、`href`、`src` 等）
- **同级展开模式**（`S`）：列出 target 同层所有兄弟元素（含 `(child N/M)` 位置标记），方便 LLM 理解横向脉络
- **探到最底层模式**（`D`）：把 target 的所有子孙递归展开直至叶节点（上限 300 个元素，超过自动截断以免剪贴板爆掉）；不开启时 target 子孙以 `<!-- ...N child nodes omitted... -->` 折叠
- **中英文界面切换**（`L`）：UI 默认英文，可切换为中文；剪贴板输出保持英文（避免给 LLM 的 payload 混 locale）
- 键盘快捷键：`Ctrl+Shift+E` 启动／停用、`Esc` 取消、拾取中按 `S`／`D`／`L` 切换三项设置
- Tampermonkey 菜单也提供四个入口（切换拾取模式 + 三项设置）；设置持久化于 GM storage

## 安装（end user）

1. 安装 [Tampermonkey](https://www.tampermonkey.net/)（Chrome、Edge、Firefox 均可）。
2. 从以下任一来源安装 spine-picker，两者皆会唤起 Tampermonkey 安装对话框：

   - **[Greasy Fork](https://greasyfork.org/zh-CN/scripts/579375-element-ancestor-spine-picker)**（推荐 —— 上架页附版本历史、评分与 issue 讨论串）
   - **[GitHub Raw](https://raw.githubusercontent.com/k0504/spine-picker/main/dist/spine-picker.user.js)**（直接从原始 repo 获取）

3. 安装完成后，Tampermonkey 会定期向安装来源检查更新；新版本推出时自动提示安装。Greasy Fork 镜像 GitHub raw URL，同一份 release 通常数小时内在两处同步上架。

## 使用

- 任意网页按 `Ctrl+Shift+E` 进入拾取模式（或从 Tampermonkey 菜单选 `Spine Picker: Toggle pick mode`）。
- 移动鼠标到目标元素上，蓝框跟随；点击复制，画面右下角会显示已复制的 toast。
- 进入拾取模式后 banner 显示当前三项设置状态，可即时切换：
  - `S` — 切换"同级展开"（target 同层兄弟）
  - `D` — 切换"探到最底层"（target 子孙递归展开）
  - `L` — 切换 UI 语言（英／中）
- 同三项设置亦可从 Tampermonkey 菜单切换，状态会持久化于 GM storage。

复制到剪贴板的格式（默认模式，节录）：

```html
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

开启"探到最底层"模式后同一份输出（节录）：

```html
<!-- siblings:   pruned -->
<!-- descendants:leaves -->
...
          <h2 class="post-title">  <!-- TARGET -->
            这是 target 的文字内容
            <span class="badge">
              new
            </span>
            <a href="/permalink/123">
              read more
            </a>
```

剪贴板输出固定为英文，无论界面语言为何 —— 这是给 LLM 的 payload，不混 locale。

## 已知限制

- 严格 CSP（`script-src 'self'`、无 `unsafe-inline`）站点上，Tampermonkey 的部分注入模式可能让 `GM_addStyle` 行为退化。多数站点不受影响。
- 对 Shadow DOM 内部元素的拾取依赖 `elementFromPoint` 是否穿透 shadow root，受浏览器与 host 设置影响；本脚本不主动穿透 closed shadow root。
- 同级展开只列 target 自身的兄弟（第一层），不展开祖先层级的兄弟。

## 开发

仓库同时维护两套 Tampermonkey 入口，分别面向终端用户与开发者。

| 文件 | 用途 |
| ---- | ---- |
| `dist/spine-picker.user.js` | 终端用户安装文件。由 `build.py` 从核心代码生成，提交后通过 GitHub raw URL 对外分发。 |
| `spine-picker.user.js` | 开发用 bootstrap，`@version` 永久锁定为 `1.0.0`。仅负责从本地 HTTP 服务拉取核心代码并执行，避免每次修改核心都需重新安装 Tampermonkey。 |
| `spine-picker-core.js` | 核心代码。包含 overlay 渲染、属性／class 过滤、selector 生成、剪贴板输出、菜单注册等全部逻辑。两套入口共享同一份核心。 |
| `serve.py` | 本地 HTTP 服务（默认 `127.0.0.1:8767`）。仅供 dev bootstrap 拉取核心代码，终端用户无需运行。 |
| `build.py` | 将核心代码打包为 `dist/spine-picker.user.js`，并自动从核心代码中提取 `CORE_VERSION` 写入 `@version`。 |

### 开发循环

```bash
python serve.py
# 浏览器地址栏访问 http://127.0.0.1:8767/spine-picker.user.js
# Tampermonkey 弹出安装对话框，确认安装 bootstrap（仅需一次）
```

随后编辑 `spine-picker-core.js`，刷新任意网页即可生效。bootstrap 每次都会附加 cache-bust 参数，无需手动清除缓存。

**CSP 注意**：bootstrap 透过 `eval` 加载核心代码。`script-src` 禁止 `'unsafe-eval'` 的网站（如 github.com、twitter.com、多数银行）会阻挡核心执行；console 会看到 `EvalError` 且右下角显示红色错误条。dev 模式请挑 CSP 宽松的测试站（example.com、自建页面）；严格 CSP 站需直接安装 `dist/spine-picker.user.js`。

### 发版

1. 修改 `spine-picker-core.js` 顶端的 `CORE_VERSION`。Tampermonkey 仅在版本号增大时触发自动更新。
2. 运行 `python build.py` 重新生成 `dist/spine-picker.user.js`。
3. 提交核心代码与 `dist/` 目录并推送到 GitHub。Tampermonkey 通常在 24 小时内为终端用户拉取新版本。

### 调试接口

核心代码将 `__spinePickerLoaded` 与 `__spinePickerVersion` 设置于 `window`，可于 DevTools Console 中查询当前版本：

```js
window.__spinePickerVersion
// "0.2.1"
```

### bootstrap 安装注意事项

- 必须在浏览器地址栏直接访问 `http://127.0.0.1:8767/spine-picker.user.js`。Tampermonkey 官网的 `script_installation.php?url=...` 中转页对本地 HTTP 资源不会 redirect。
- 本地服务响应的 `Content-Type` 必须为 `application/javascript`，`serve.py` 已强制此值。
- 若 Tampermonkey 拒绝安装，于 Dashboard 中将 **Settings → Config mode** 切换为 `Advanced`，并在 **Security → Allow scripts to access cross-origin resources** 中勾选允许。

### 为何不使用 Tampermonkey 的 `@updateURL` 自动更新（dev）

Tampermonkey 拒绝 `http://127.0.0.1` 作为 `@updateURL`（insecure-origin policy）。dev 用 bootstrap 的存在即为解决此限制：bootstrap 自身锁定版本永不更新，核心逻辑则由本地 HTTP 服务每次重新拉取。终端用户安装的 `dist/` 文件通过 GitHub raw URL 分发，不受此限制影响。

## License

[MIT](./LICENSE)
