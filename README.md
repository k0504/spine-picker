# spine-picker

於任意網頁上拾取元素，將其祖先脊椎（精簡 HTML 開放標籤鏈 + 唯一 CSS selector）複製到剪貼簿。輸出格式針對 LLM 場景設計，貼入對話即可讓模型準確理解使用者所指的是哪一個 UI 元素。

對於 styled-components、Emotion、CSS Modules 等會產生 hash class 的框架，會自動過濾掉這類雜訊；最終輸出的 selector 以可讀類名 + `:nth-of-type` 構成。

## 功能

- 滑鼠 hover 任意元素顯示藍色 overlay，標示當前指向的標籤
- 點擊複製從 `<html>` 到 target 的祖先鏈，附 `<!-- TARGET -->` 標記
- 自動過濾 hash class、過長屬性值與 inline event handler；保留語意屬性（`id`、`role`、`aria-*`、`data-*`、`href`、`src` 等）
- 可選「同級展開」模式：列出 target 同層所有兄弟元素（含 `(child N/M)` 位置標記），方便 LLM 理解橫向脈絡
- 鍵盤快捷鍵：`Ctrl+Shift+E` 啟動／停用、`Esc` 取消、拾取中按 `S` 切換同級展開
- Tampermonkey 選單也提供切換入口；設定持久化於 GM storage

## 安裝（end user）

1. 安裝 [Tampermonkey](https://www.tampermonkey.net/)（Chrome、Edge、Firefox 均可）。
2. 點擊以下連結，Tampermonkey 將彈出安裝對話框：

   **[從 GitHub Raw 安裝](https://raw.githubusercontent.com/k0504/spine-picker/main/dist/spine-picker.user.js)**

3. 安裝完成後，Tampermonkey 會定期向同一 URL 檢查更新；維護者推送新版時自動提示安裝。

## 使用

- 任意網頁按 `Ctrl+Shift+E` 進入拾取模式（或從 Tampermonkey 選單選 `Spine Picker: 切換拾取模式`）。
- 移動滑鼠到目標元素上，藍框跟隨；點擊複製，畫面右下角會顯示已複製的 toast。
- 同級展開：拾取模式中按 `S` 切換；亦可從 Tampermonkey 選單切換，狀態會持久化。

複製到剪貼簿的格式（截錄）：

```html
<!-- url:      https://example.com/some/page -->
<!-- selector: main > article > h2:nth-of-type(2) -->
<!-- depth:    7 layers (html > body > div > main > article > h2) -->
<!-- siblings: pruned -->

<html lang="en">
  <body class="page-content">
    <div id="root">
      <main class="main">
        <article class="post">
          <h2 class="post-title">  <!-- TARGET -->
            這是 target 的文字內容
          </h2>
```

## 已知限制

- 嚴格 CSP（`script-src 'self'`、無 `unsafe-inline`）站點上，Tampermonkey 的部分注入模式可能讓 `GM_addStyle` 行為退化。多數站點不受影響。
- 對 Shadow DOM 內部元素的拾取仰賴 `elementFromPoint` 是否穿透 shadow root，受瀏覽器與 host 設定影響；本腳本不主動穿透 closed shadow root。
- 同級展開只列 target 自身的兄弟（第一層），不展開祖先層級的兄弟。

## 開發

倉庫同時維護兩套 Tampermonkey 入口，分別面向端使用者與開發者。

| 檔 | 用途 |
| ---- | ---- |
| `dist/spine-picker.user.js` | 端使用者安裝檔。由 `build.py` 從核心代碼生成，提交後通過 GitHub raw URL 對外分發。 |
| `spine-picker.user.js` | 開發用 bootstrap，`@version` 永久鎖定為 `1.0.0`。僅負責從本地 HTTP 服務拉取核心代碼並執行，避免每次修改核心都需重新安裝 Tampermonkey。 |
| `spine-picker-core.js` | 核心代碼。包含 overlay 渲染、屬性／class 過濾、selector 生成、剪貼簿輸出、選單註冊等全部邏輯。兩套入口共享同一份核心。 |
| `serve.py` | 本地 HTTP 服務（預設 `127.0.0.1:8767`）。僅供 dev bootstrap 拉取核心代碼，端使用者無需執行。 |
| `build.py` | 將核心代碼打包為 `dist/spine-picker.user.js`，並自動從核心代碼中提取 `CORE_VERSION` 寫入 `@version`。 |

### 開發循環

```bash
python serve.py
# 瀏覽器位址列訪問 http://127.0.0.1:8767/spine-picker.user.js
# Tampermonkey 彈出安裝對話框，確認安裝 bootstrap（僅需一次）
```

隨後編輯 `spine-picker-core.js`，重新整理任意網頁即可生效。bootstrap 每次都會附加 cache-bust 參數，無需手動清除快取。

**CSP 注意**：bootstrap 透過 `eval` 載入核心代碼。`script-src` 禁止 `'unsafe-eval'` 的網站（如 github.com、twitter.com、多數銀行）會阻擋核心執行；console 會看到 `EvalError` 且右下角顯示紅色錯誤條。dev 模式請挑 CSP 寬鬆的測試站（example.com、自架頁面）；嚴格 CSP 站需直接安裝 `dist/spine-picker.user.js`。

### 發版

1. 修改 `spine-picker-core.js` 頂端的 `CORE_VERSION`。Tampermonkey 僅在版本號增大時觸發自動更新。
2. 執行 `python build.py` 重新生成 `dist/spine-picker.user.js`。
3. 提交核心代碼與 `dist/` 目錄並推送到 GitHub。Tampermonkey 通常在 24 小時內為端使用者拉取新版本。

### 偵錯接口

核心代碼將 `__spinePickerLoaded` 與 `__spinePickerVersion` 設定於 `window`，可於 DevTools Console 中查詢當前版本：

```js
window.__spinePickerVersion
// "0.2.1"
```

### bootstrap 安裝注意事項

- 必須在瀏覽器位址列直接訪問 `http://127.0.0.1:8767/spine-picker.user.js`。Tampermonkey 官網的 `script_installation.php?url=...` 中轉頁對本地 HTTP 資源不會 redirect。
- 本地服務回應的 `Content-Type` 必須為 `application/javascript`，`serve.py` 已強制此值。
- 若 Tampermonkey 拒絕安裝，於 Dashboard 中將 **Settings → Config mode** 切換為 `Advanced`，並在 **Security → Allow scripts to access cross-origin resources** 中勾選允許。

### 為何不使用 Tampermonkey 的 `@updateURL` 自動更新（dev）

Tampermonkey 拒絕 `http://127.0.0.1` 作為 `@updateURL`（insecure-origin policy）。dev 用 bootstrap 的存在即為解決此限制：bootstrap 自身鎖定版本永不更新，核心邏輯則由本地 HTTP 服務每次重新拉取。端使用者安裝的 `dist/` 檔案通過 GitHub raw URL 分發，不受此限制影響。

## License

[MIT](./LICENSE)
