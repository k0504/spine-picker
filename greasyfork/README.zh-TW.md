# spine-picker

在涉及前端的編碼過程中，不知道如何向 LLM 描述指定的網頁元素或結構？「右側欄第二個按鈕」太模糊，整段 DOM 又會撐爆 context window。spine-picker 將具結構意義的描述（祖先鏈 + 唯一 CSS selector，已自動過濾框架產生的 hash class 雜訊）直接複製到剪貼簿。

## 功能

- 滑鼠 hover 任意元素顯示藍色 overlay，標示當前指向的標籤
- 點擊複製從 `<html>` 到 target 的祖先鏈，附 `<!-- TARGET -->` 標記
- 自動過濾 hash class（styled-components / Emotion / CSS Modules）、過長屬性值與 inline event handler；保留語意屬性（`id`、`role`、`aria-*`、`data-*`、`href`、`src` 等）
- **同級展開**（`S`）：列出 target 同層所有兄弟元素，含 `(child N/M)` 位置標記
- **探到最底層**（`D`）：把 target 的所有子孫遞迴展開直至葉節點（上限 300 個元素）
- **中英文介面切換**（`L`）：英／中切換；剪貼簿輸出維持英文（給 LLM 的 payload 不混 locale）

## 鍵盤快捷鍵

| 按鍵 | 動作 |
|-----|--------|
| `Ctrl+Shift+E` | 啟動／停用拾取模式 |
| `Esc` | 取消拾取 |
| `S` | 切換「同級展開」（拾取中） |
| `D` | 切換「探到最底層」（拾取中） |
| `L` | 切換 UI 語言（拾取中） |

三項設定（`S` / `D` / `L`）同時提供於 Tampermonkey 選單，狀態持久化於 GM storage。

## 剪貼簿輸出範例

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
            這是 target 的文字內容
            <!-- ...3 child nodes omitted... -->
```

## 已知限制

- 嚴格 CSP（`script-src 'self'`、無 `unsafe-inline`）站點上，Tampermonkey 的部分注入模式可能讓 `GM_addStyle` 行為退化。多數站點不受影響。
- 對 Shadow DOM 內部元素的拾取仰賴 `elementFromPoint` 是否穿透 shadow root；本腳本不主動穿透 closed shadow root。
- 同級展開只列 target 自身的兄弟，不展開祖先層級的兄弟（設計決定，避免輸出過長）。

## 原始碼 / 議題回報 / 貢獻

完整原始碼、開發流程、AGENTS 層級導航與 issue tracker：
**https://github.com/k0504/spine-picker**

授權：[MIT](https://github.com/k0504/spine-picker/blob/main/LICENSE)
