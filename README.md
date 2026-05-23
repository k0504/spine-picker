# spine-picker

**English** | [繁體中文](./README.zh-TW.md)

Working on frontend code with an LLM and not sure how to point at a specific element on the page? "The second button in the right sidebar" is ambiguous; pasting the entire DOM blows past the context window. spine-picker lets you point at the element with the mouse and copy a structurally meaningful description — the ancestor chain plus a unique selector, with framework-generated hash class noise already stripped — straight to the clipboard.

Pick any element on any webpage and copy its ancestor spine (a minimal HTML opening-tag chain plus a unique CSS selector) to the clipboard. The output format is designed for LLM scenarios — pasting it into a conversation lets the model accurately identify which UI element the user is referring to.

For frameworks that emit hash class names (styled-components, Emotion, CSS Modules, etc.), spine-picker automatically filters out that noise; the final selector is composed of readable class names plus `:nth-of-type`.

## Features

- Hover any element to display a blue overlay marking the current tag
- Click to copy the ancestor chain from `<html>` down to the target, annotated with `<!-- TARGET -->`
- Automatically strips hash classes, overlong attribute values, and inline event handlers; preserves semantic attributes (`id`, `role`, `aria-*`, `data-*`, `href`, `src`, etc.)
- **Sibling expansion mode** (`S`): lists every sibling at the target's level (with `(child N/M)` position markers), giving the LLM the horizontal context
- **Expand-to-leaves mode** (`D`): recursively expands all of the target's descendants down to leaf nodes (capped at 300 elements; truncated automatically beyond that to keep the clipboard payload manageable); when disabled, the target's descendants are folded as `<!-- ...N child nodes omitted... -->`
- **UI language toggle** (`L`): UI defaults to English and can be switched to Traditional Chinese; clipboard output stays in English so the LLM payload does not mix locales
- Keyboard shortcuts: `Ctrl+Shift+E` to activate / deactivate, `Esc` to cancel, `S` / `D` / `L` during picking to toggle the three settings
- The Tampermonkey menu also exposes four entries (toggle pick mode + the three settings); preferences persist in GM storage

## Installation (end user)

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome, Edge, and Firefox all work).
2. Click the link below; Tampermonkey will open an install dialog:

   **[Install from GitHub Raw](https://raw.githubusercontent.com/k0504/spine-picker/main/dist/spine-picker.user.js)**

3. After installation, Tampermonkey periodically checks the same URL for updates; when the maintainer pushes a new version, an update prompt appears automatically.

## Usage

- On any webpage, press `Ctrl+Shift+E` to enter pick mode (or select `Spine Picker: Toggle pick mode` from the Tampermonkey menu).
- Move the mouse to the target element; a blue frame follows. Click to copy; a confirmation toast appears at the bottom right.
- Once pick mode is active, a banner shows the current state of all three settings, each of which can be toggled live:
  - `S` — toggle "expand siblings" (target's same-level siblings)
  - `D` — toggle "expand to leaves" (recursively expand the target's descendants)
  - `L` — toggle UI language (English / 中文)
- The same three settings can be toggled from the Tampermonkey menu; state persists in GM storage.

Sample clipboard output (default mode, excerpt):

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
            this is the target text
            <!-- ...3 child nodes omitted... -->
```

The same target with "expand to leaves" mode enabled (excerpt):

```html
<!-- siblings:   pruned -->
<!-- descendants:leaves -->
...
          <h2 class="post-title">  <!-- TARGET -->
            this is the target text
            <span class="badge">
              new
            </span>
            <a href="/permalink/123">
              read more
            </a>
```

Clipboard output is always English regardless of the UI language — this is the payload for an LLM, so locales are kept consistent.

## Known limitations

- On sites with strict CSP (`script-src 'self'` and no `unsafe-inline`), some of Tampermonkey's injection modes may degrade `GM_addStyle` behavior. Most sites are unaffected.
- Picking elements inside Shadow DOM relies on whether `elementFromPoint` pierces the shadow root, which varies by browser and host configuration; this script does not actively pierce closed shadow roots.
- Sibling expansion only lists the target's own siblings (the first level); it does not expand ancestor-level siblings.

## Development

The repository maintains two Tampermonkey entry points — one for end users and one for developers.

| File | Purpose |
| ---- | ---- |
| `dist/spine-picker.user.js` | End-user install file. Generated by `build.py` from the core source; once committed, distributed to end users via the GitHub raw URL. |
| `spine-picker.user.js` | Development bootstrap. `@version` is permanently pinned to `1.0.0`. Its only job is to fetch the core source from a local HTTP server and execute it, so editing the core does not require reinstalling in Tampermonkey. |
| `spine-picker-core.js` | The core source. Contains overlay rendering, attribute / class filtering, selector generation, clipboard output, menu registration, and all other logic. Both entry points share this single core. |
| `serve.py` | Local HTTP server (defaults to `127.0.0.1:8767`). Used only by the dev bootstrap to fetch the core; end users never need to run it. |
| `build.py` | Packages the core into `dist/spine-picker.user.js`, automatically extracting `CORE_VERSION` from the core source into `@version`. |

### Dev loop

```bash
python serve.py
# Open http://127.0.0.1:8767/spine-picker.user.js in the browser address bar
# Tampermonkey opens an install dialog; confirm the bootstrap installation (one-time)
```

Afterwards, edit `spine-picker-core.js` and reload any webpage to see the changes. The bootstrap appends a cache-bust parameter every time, so no manual cache clearing is required.

**CSP note**: the bootstrap loads the core via `eval`. Sites whose `script-src` directive forbids `'unsafe-eval'` (such as github.com, twitter.com, most banking sites) will block core execution; you will see `EvalError` in the console and a red error bar at the bottom right. For development, choose CSP-permissive test sites (example.com, locally hosted pages); for strict-CSP sites, install `dist/spine-picker.user.js` directly.

### Release

1. Bump `CORE_VERSION` at the top of `spine-picker-core.js`. Tampermonkey only triggers an auto-update when the version number increases.
2. Run `python build.py` to regenerate `dist/spine-picker.user.js`.
3. Commit the core source plus the `dist/` directory and push to GitHub. Tampermonkey typically picks up the new version for end users within 24 hours.

### Debug hooks

The core sets `__spinePickerLoaded` and `__spinePickerVersion` on `window`; the current version can be queried from the DevTools Console:

```js
window.__spinePickerVersion
// "0.2.1"
```

### Bootstrap installation notes

- The browser must visit `http://127.0.0.1:8767/spine-picker.user.js` directly via the address bar. Tampermonkey's `script_installation.php?url=...` intermediate page does not redirect to local HTTP resources.
- The local server must respond with `Content-Type: application/javascript`; `serve.py` enforces this.
- If Tampermonkey refuses to install, switch **Settings → Config mode** to `Advanced` in the dashboard, and tick **Security → Allow scripts to access cross-origin resources**.

### Why not Tampermonkey's `@updateURL` for dev auto-update

Tampermonkey rejects `http://127.0.0.1` as `@updateURL` (insecure-origin policy). The dev bootstrap exists precisely to work around this restriction: the bootstrap itself is version-locked and never updates, while the core logic is re-fetched from the local HTTP server every time. The `dist/` file that end users install is distributed via the GitHub raw URL and is not subject to this restriction.

## License

[MIT](./LICENSE)
