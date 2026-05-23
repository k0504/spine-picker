# spine-picker

Working on frontend code with an LLM and stuck describing **which specific element** on the page you mean? "The second button in the right sidebar" is ambiguous; pasting the entire DOM blows past the context window. spine-picker copies a structurally meaningful description — the ancestor chain plus a unique CSS selector, with framework-generated hash class noise already stripped — straight to the clipboard.

## Features

- Hover any element to see a blue overlay marking the current tag
- Click to copy the ancestor chain from `<html>` down to the target, annotated with `<!-- TARGET -->`
- Auto-strips hash classes (styled-components / Emotion / CSS Modules), overlong attributes, and inline event handlers; preserves semantic attributes (`id`, `role`, `aria-*`, `data-*`, `href`, `src`, etc.)
- **Sibling expansion** (`S`): list every sibling at the target's level, with `(child N/M)` position markers
- **Expand to leaves** (`D`): recursively expand all descendants down to leaf nodes (capped at 300 elements)
- **UI language toggle** (`L`): English / 繁體中文; clipboard output stays English regardless (LLM payload locale stays consistent)

## Keyboard shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Shift+E` | Toggle pick mode |
| `Esc` | Cancel pick mode |
| `S` | Toggle "expand siblings" (during pick) |
| `D` | Toggle "expand to leaves" (during pick) |
| `L` | Switch UI language (during pick) |

All three settings (`S` / `D` / `L`) also appear in the Tampermonkey menu and persist across sessions.

## Sample clipboard output

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
            this is the target text
            <!-- ...3 child nodes omitted... -->
```

## Known limitations

- On sites with strict CSP (`script-src 'self'` and no `unsafe-inline`), some Tampermonkey injection modes may degrade `GM_addStyle` behavior. Most sites are unaffected.
- Picking inside Shadow DOM depends on whether `elementFromPoint` pierces the shadow root; this script does not actively pierce closed shadow roots.
- Sibling expansion lists only the target's own siblings, not ancestor-level siblings (design decision — avoid runaway output).

## Source / issues / contributions

Full source code, dev workflow, AGENTS-level navigation, and issue tracker:
**https://github.com/k0504/spine-picker**

License: [MIT](https://github.com/k0504/spine-picker/blob/main/LICENSE)
