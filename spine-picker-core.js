/* spine-picker-core.js
 *
 * Loaded by spine-picker.user.js bootstrap. Runs in the userscript ISOLATED
 * world (inherits GM_* APIs from the bootstrap's @grant block).
 *
 * What it does:
 *   Activates a "spine picker" mode (Ctrl+Shift+E or TM menu). Hover any
 *   element on the page; click to copy the ancestor chain (trimmed open
 *   tags + unique CSS selector) to clipboard, optimized for pasting to an
 *   LLM that needs to know which UI element on the page you mean.
 *
 *   Optional "expand siblings" mode (toggle via TM menu or `S` during
 *   pick) — lists the target's direct siblings on the deepest level, so
 *   the LLM sees the target's lateral context as well.
 *
 * Architecture:
 *   - Dev install: spine-picker.user.js (bootstrap, @version 1.0.0)
 *     fetches this file from serve.py per page load. Edit + reload tab.
 *   - End-user install: dist/spine-picker.user.js (single file built
 *     from this core by build.py). GitHub raw URL serves as @updateURL.
 *   See AGENTS.md for the cross-file invariants.
 */

(function () {
    'use strict';

    // Bump on every meaningful change. dist's @version is derived from this
    // by build.py — bump CORE_VERSION → run build.py → commit dist/ to push
    // an update to end users (TM only auto-updates when @version increases).
    var CORE_VERSION = '0.3.1';

    // Defensive: if bootstrap fires twice (shouldn't, but) or dist + dev
    // bootstrap are both installed, the second load no-ops.
    if (window.__spinePickerLoaded) {
        console.warn('[Spine Picker] already loaded — skipping (existing version: '
                     + window.__spinePickerVersion + ', this version: ' + CORE_VERSION + ')');
        return;
    }
    window.__spinePickerLoaded = true;
    window.__spinePickerVersion = CORE_VERSION;

    // ============================================================
    //  State + Settings
    // ============================================================
    const STATE = {
        active: false,
        overlay: null,
        banner: null,
        toast: null,
        currentTarget: null,
    };

    // Settings: persisted to GM storage. To add a new setting:
    //   1. Add an entry to SETTINGS_KEYS (key + default).
    //   2. Add a corresponding line to SETTINGS init.
    //   3. Add a toggle*() function below.
    //   4. Add menu + (optional) keyboard shortcut wiring at the bottom.
    //   5. Add the on/off labels to STRINGS.en / STRINGS.zh.
    const SETTINGS_KEYS = {
        expandSiblings: { key: 'expandSiblings', default: false },
        expandToLeaves: { key: 'expandToLeaves', default: false },
        // 'en' | 'zh' — UI language. Clipboard output stays English regardless
        // (it's payload for an LLM, not a UI string).
        language:       { key: 'language',       default: 'en' },
    };

    function loadSetting(name) {
        const spec = SETTINGS_KEYS[name];
        try { return GM_getValue(spec.key, spec.default); }
        catch (_) { return spec.default; }
    }
    function saveSetting(name, val) {
        const spec = SETTINGS_KEYS[name];
        try { GM_setValue(spec.key, val); } catch (_) {}
    }

    const SETTINGS = {
        expandSiblings: loadSetting('expandSiblings'),
        expandToLeaves: loadSetting('expandToLeaves'),
        language:       loadSetting('language'),
    };

    // Cap for "expand to leaves" mode — picking <body> on a complex page
    // would otherwise blow up the clipboard. 300 elements ≈ ~30KB of HTML
    // output, comfortable for paste-to-LLM scenarios.
    const LEAVES_MAX_DESCENDANTS = 300;

    // ============================================================
    //  i18n
    //
    //  UI strings only. Clipboard HTML output stays English regardless
    //  of the selected language — mixing locales in machine-consumed
    //  payloads is a footgun, and LLMs handle English consistently.
    // ============================================================
    const STRINGS = {
        en: {
            bannerLabel:   'Spine Picker | Click to copy | Esc cancel | S siblings | D leaves | L lang',
            siblingsOn:    'siblings:on',
            siblingsOff:   'siblings:off',
            leavesOn:      'leaves:on',
            leavesOff:     'leaves:off',
            langNameEn:    'English',
            langNameZh:    '中文',

            menuTogglePicker: 'Spine Picker: Toggle pick mode (Ctrl+Shift+E)',
            menuSiblings:  (on)   => `Spine Picker: Expand siblings (currently: ${on ? 'ON' : 'OFF'})`,
            menuLeaves:    (on)   => `Spine Picker: Expand to leaves (currently: ${on ? 'ON' : 'OFF'})`,
            menuLang:      (lang) => `Spine Picker: Language (currently: ${lang === 'zh' ? '中文' : 'English'})`,

            toastSiblings: (on)   => `Expand siblings: ${on ? 'ON' : 'OFF'}`,
            toastLeaves:   (on)   => `Expand to leaves: ${on ? 'ON' : 'OFF'}`,
            toastLang:     (lang) => `Language: ${lang === 'zh' ? '中文' : 'English'}`,
            toastCopied:   (depth, sib, lvs, sel) =>
                `Copied ancestor spine\nDepth: ${depth} layers / siblings: ${sib} / descendants: ${lvs}\nselector: ${sel}`,
            toastCaptureFailed: (msg) => `Capture failed: ${msg}`,

            menuRegisterFailWarn:   'GM_registerMenuCommand failed, use Ctrl+Shift+E instead:',
            siblingsMenuRegisterFailWarn: 'siblings menu register failed, press S during pick to toggle:',
        },
        zh: {
            bannerLabel:   'Spine Picker | 點擊元素複製 | Esc 取消 | S 同級 | D 探底 | L 語言',
            siblingsOn:    '同級:開',
            siblingsOff:   '同級:關',
            leavesOn:      '探底:開',
            leavesOff:     '探底:關',
            langNameEn:    'English',
            langNameZh:    '中文',

            menuTogglePicker: 'Spine Picker: 切換拾取模式 (Ctrl+Shift+E)',
            menuSiblings:  (on)   => `Spine Picker: 同級展開（目前：${on ? '開' : '關'}）`,
            menuLeaves:    (on)   => `Spine Picker: 探到最底層（目前：${on ? '開' : '關'}）`,
            menuLang:      (lang) => `Spine Picker: 語言（目前：${lang === 'zh' ? '中文' : 'English'}）`,

            toastSiblings: (on)   => `同級展開：${on ? '開' : '關'}`,
            toastLeaves:   (on)   => `探到最底層：${on ? '開' : '關'}`,
            toastLang:     (lang) => `語言：${lang === 'zh' ? '中文' : 'English'}`,
            toastCopied:   (depth, sib, lvs, sel) =>
                `已複製祖先脊椎\n深度: ${depth} 層 / 同級: ${sib} / 子孫: ${lvs}\nselector: ${sel}`,
            toastCaptureFailed: (msg) => `擷取失敗：${msg}`,

            menuRegisterFailWarn:   'GM_registerMenuCommand 失敗，請用 Ctrl+Shift+E 啟動：',
            siblingsMenuRegisterFailWarn: '同級展開 menu 註冊失敗，請用拾取模式中按 S 切換：',
        },
    };

    function t(key, ...args) {
        const bag = STRINGS[SETTINGS.language] || STRINGS.en;
        const v = bag[key] !== undefined ? bag[key] : STRINGS.en[key];
        if (v === undefined) return key;
        return typeof v === 'function' ? v(...args) : v;
    }

    // ============================================================
    //  Styles
    // ============================================================
    GM_addStyle(`
        .__spine-overlay {
            position: fixed;
            pointer-events: none;
            z-index: 2147483646;
            border: 2px solid #2196F3;
            background: rgba(33, 150, 243, 0.12);
            box-shadow: 0 0 0 9999px rgba(0,0,0,0.0);
            transition: top 60ms ease-out, left 60ms ease-out, width 60ms ease-out, height 60ms ease-out;
            box-sizing: border-box;
        }
        .__spine-overlay::after {
            content: attr(data-tag);
            position: absolute;
            top: -22px;
            left: 0;
            background: #2196F3;
            color: #fff;
            font: 11px/1 -apple-system, system-ui, "Segoe UI", sans-serif;
            padding: 4px 6px;
            border-radius: 3px;
            white-space: nowrap;
        }
        .__spine-banner {
            position: fixed;
            top: 12px;
            left: 50%;
            transform: translateX(-50%);
            background: #2196F3;
            color: #fff;
            padding: 6px 14px;
            border-radius: 999px;
            font: 12px/1.4 -apple-system, system-ui, "Segoe UI", sans-serif;
            z-index: 2147483647;
            box-shadow: 0 2px 8px rgba(0,0,0,0.25);
            pointer-events: none;
        }
        .__spine-toast {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: #1e1e1e;
            color: #fff;
            padding: 12px 16px;
            border-radius: 8px;
            font: 13px/1.45 ui-monospace, Consolas, monospace;
            z-index: 2147483647;
            box-shadow: 0 4px 16px rgba(0,0,0,0.35);
            max-width: 420px;
            white-space: pre-wrap;
            word-break: break-all;
            opacity: 0;
            transition: opacity 200ms;
            pointer-events: none;
        }
        .__spine-toast.show { opacity: 1; }
    `);

    // ============================================================
    //  DOM helpers
    // ============================================================
    function makeOverlay() {
        const el = document.createElement('div');
        el.className = '__spine-overlay';
        document.documentElement.appendChild(el);
        return el;
    }

    function bannerText() {
        // The "S/D/L toggle" hints are part of the static label (`bannerLabel`).
        // The state badges (siblings:on / leaves:off) trail behind so the
        // banner always reflects current settings without re-creating the DOM.
        const sib = t(SETTINGS.expandSiblings ? 'siblingsOn' : 'siblingsOff');
        const lvs = t(SETTINGS.expandToLeaves ? 'leavesOn'   : 'leavesOff');
        return `${t('bannerLabel')} | ${sib} | ${lvs}`;
    }

    function makeBanner() {
        const el = document.createElement('div');
        el.className = '__spine-banner';
        el.textContent = bannerText();
        document.documentElement.appendChild(el);
        return el;
    }

    function showToast(text) {
        if (STATE.toast) STATE.toast.remove();
        const el = document.createElement('div');
        el.className = '__spine-toast';
        el.textContent = text;
        document.documentElement.appendChild(el);
        STATE.toast = el;
        requestAnimationFrame(() => el.classList.add('show'));
        setTimeout(() => {
            el.classList.remove('show');
            setTimeout(() => { el.remove(); if (STATE.toast === el) STATE.toast = null; }, 250);
        }, 2800);
    }

    function moveOverlay(el) {
        if (!STATE.overlay || !el) return;
        const r = el.getBoundingClientRect();
        STATE.overlay.style.top = r.top + 'px';
        STATE.overlay.style.left = r.left + 'px';
        STATE.overlay.style.width = r.width + 'px';
        STATE.overlay.style.height = r.height + 'px';
        STATE.overlay.dataset.tag = describeBrief(el);
    }

    function describeBrief(el) {
        let s = el.tagName.toLowerCase();
        if (el.id) s += '#' + el.id;
        const cls = pickClasses(el);
        if (cls.length) s += '.' + cls.slice(0, 2).join('.');
        return s;
    }

    // ============================================================
    //  Activation
    // ============================================================
    function activate() {
        if (STATE.active) return;
        STATE.active = true;
        STATE.overlay = makeOverlay();
        STATE.banner = makeBanner();
        document.addEventListener('mousemove', onMouseMove, true);
        document.addEventListener('mouseover', onMouseMove, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('contextmenu', onContextMenu, true);
        document.documentElement.style.cursor = 'crosshair';
    }

    function deactivate() {
        if (!STATE.active) return;
        STATE.active = false;
        if (STATE.overlay) STATE.overlay.remove();
        if (STATE.banner) STATE.banner.remove();
        STATE.overlay = null;
        STATE.banner = null;
        STATE.currentTarget = null;
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('mouseover', onMouseMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('contextmenu', onContextMenu, true);
        document.documentElement.style.cursor = '';
    }

    function onMouseMove(e) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el || el === STATE.currentTarget) return;
        if (el.classList && (
            el.classList.contains('__spine-overlay') ||
            el.classList.contains('__spine-banner') ||
            el.classList.contains('__spine-toast'))) return;
        STATE.currentTarget = el;
        moveOverlay(el);
    }

    function onClick(e) {
        if (!STATE.active) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const target = STATE.currentTarget || document.elementFromPoint(e.clientX, e.clientY);
        if (target) {
            try { capture(target); }
            catch (err) { console.error('[Spine Picker] capture failed', err); showToast(t('toastCaptureFailed', err.message)); }
        }
        deactivate();
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            deactivate();
            return;
        }
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const k = (e.key || '').toLowerCase();
        // S/D/L are pick-mode shortcuts for the three toggle settings.
        // Mirrored on the banner text (`bannerLabel` in STRINGS) so the
        // user sees them without opening the TM menu.
        if (k === 's') {
            e.preventDefault(); e.stopPropagation();
            toggleExpandSiblings();
        } else if (k === 'd') {
            e.preventDefault(); e.stopPropagation();
            toggleExpandToLeaves();
        } else if (k === 'l') {
            e.preventDefault(); e.stopPropagation();
            toggleLanguage();
        }
    }

    function onContextMenu(e) {
        e.preventDefault();
        e.stopPropagation();
        deactivate();
    }

    // ============================================================
    //  Spine extraction
    // ============================================================
    const KEEP_ATTRS = new Set([
        'id', 'role', 'name', 'type', 'href', 'src', 'alt', 'title',
        'placeholder', 'value', 'for', 'rel', 'target', 'lang', 'tabindex',
    ]);

    function isHashClass(cls) {
        if (!cls) return true;
        if (cls.length > 32) return true;
        // styled-components / emotion: sc-xxxxxx, css-xxxxxx
        if (/^(sc|css|jsx|emotion|svelte)-[a-zA-Z0-9_-]{4,}$/i.test(cls)) return true;
        // CSS modules with hash suffix: foo__bar___AbC12
        if (/___[a-zA-Z0-9_-]{4,}$/.test(cls)) return true;
        // pure hash: _Ab1c2D3
        if (/^_[a-zA-Z0-9]{6,}$/.test(cls)) return true;
        // looks like base64-ish: contains digits + mixed case + length >= 8
        if (cls.length >= 10 && /[0-9]/.test(cls) && /[A-Z]/.test(cls) && /[a-z]/.test(cls)) return true;
        return false;
    }

    function pickClasses(el) {
        if (!el.classList) return [];
        const list = Array.from(el.classList);
        const filtered = list.filter(c => !isHashClass(c));
        return filtered.slice(0, 5);
    }

    function pickAttrs(el) {
        const out = [];
        if (!el.attributes) return out;
        for (const attr of Array.from(el.attributes)) {
            const n = attr.name;
            if (n === 'class' || n === 'style' || n === 'id') continue;
            if (n.startsWith('on')) continue;
            const keep = KEEP_ATTRS.has(n) || n.startsWith('data-') || n.startsWith('aria-');
            if (!keep) continue;
            let v = attr.value;
            if (v && v.length > 60) v = v.slice(0, 57) + '...';
            out.push([n, v]);
        }
        return out;
    }

    function escAttr(v) {
        return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function buildOpenTag(el) {
        const tag = el.tagName.toLowerCase();
        const segs = [];
        if (el.id) segs.push(`id="${escAttr(el.id)}"`);
        const classes = pickClasses(el);
        if (classes.length) segs.push(`class="${escAttr(classes.join(' '))}"`);
        for (const [n, v] of pickAttrs(el)) {
            segs.push(v === '' ? n : `${n}="${escAttr(v)}"`);
        }
        return segs.length ? `<${tag} ${segs.join(' ')}>` : `<${tag}>`;
    }

    function getTextSummary(el) {
        // Deep concatenation — used for sibling one-line summary and for the
        // non-leaves rendering of TARGET (where children are pruned and we
        // want to show "what's in there" in one shot).
        const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (!txt) return '';
        return txt.length > 100 ? txt.slice(0, 97) + '...' : txt;
    }

    function getDirectText(el) {
        // Only direct text-node children. Used by expandToLeaves rendering
        // — if we used textContent here, every ancestor level would repeat
        // the same concatenated string (textContent is recursive).
        let s = '';
        for (const node of el.childNodes) {
            if (node.nodeType === 3) s += node.nodeValue;
        }
        s = s.trim().replace(/\s+/g, ' ');
        if (!s) return '';
        return s.length > 100 ? s.slice(0, 97) + '...' : s;
    }

    function renderDescendant(el, indent, stats) {
        // Recursive renderer for expandToLeaves mode. `stats` carries the
        // descendant counter + truncation flag across the recursion so the
        // first call site knows whether to append a truncation comment.
        if (stats.count >= stats.limit) { stats.truncated = true; return ''; }
        stats.count++;
        let html = `${indent}${buildOpenTag(el)}\n`;
        const text = getDirectText(el);
        if (text) html += `${indent}  ${escAttr(text)}\n`;
        for (const child of el.children) {
            html += renderDescendant(child, indent + '  ', stats);
            if (stats.truncated) break;
        }
        return html;
    }

    function uniqueSelector(el) {
        if (el.id) {
            try {
                const sel = '#' + CSS.escape(el.id);
                if (document.querySelectorAll(sel).length === 1) return sel;
            } catch (_) {}
        }
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
            let part = cur.tagName.toLowerCase();
            if (cur.id) {
                try {
                    part = part + '#' + CSS.escape(cur.id);
                    parts.unshift(part);
                    break;
                } catch (_) {}
            }
            const classes = pickClasses(cur);
            if (classes.length) {
                try {
                    part += '.' + classes.map(c => CSS.escape(c)).join('.');
                } catch (_) {}
            }
            const parent = cur.parentElement;
            if (parent) {
                const sameTag = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
                if (sameTag.length > 1) {
                    const idx = sameTag.indexOf(cur) + 1;
                    part += `:nth-of-type(${idx})`;
                }
            }
            parts.unshift(part);
            cur = cur.parentElement;
        }
        return parts.length ? parts.join(' > ') : el.tagName.toLowerCase();
    }

    function renderTargetLine(el, indent, posNote) {
        // posNote like " (child 3/5)"; pass empty string when no positional info.
        let html = `${indent}${buildOpenTag(el)}  <!-- TARGET${posNote} -->\n`;
        if (SETTINGS.expandToLeaves) {
            // Leaves mode: recurse all descendants, direct text per node, with
            // a cap so picking <body> on a complex page doesn't blow up the
            // clipboard. See LEAVES_MAX_DESCENDANTS at top of file.
            const text = getDirectText(el);
            if (text) html += `${indent}  ${escAttr(text)}\n`;
            const stats = { count: 0, limit: LEAVES_MAX_DESCENDANTS, truncated: false };
            for (const child of el.children) {
                html += renderDescendant(child, indent + '  ', stats);
                if (stats.truncated) break;
            }
            if (stats.truncated) {
                html += `${indent}  <!-- ...truncated at ${stats.limit} descendants -->\n`;
            }
        } else {
            const text = getTextSummary(el);
            if (text) html += `${indent}  ${escAttr(text)}\n`;
            const childCount = el.children.length;
            if (childCount > 0) {
                html += `${indent}  <!-- ...${childCount} child node${childCount > 1 ? 's' : ''} omitted... -->\n`;
            }
        }
        return html;
    }

    function renderSiblingLine(el, indent, posNote) {
        // 同級元素：只列 open tag，子孫只標數量
        let note = `  <!-- sibling${posNote} -->`;
        const childCount = el.children.length;
        if (childCount > 0) {
            note = `  <!-- sibling${posNote}, ${childCount} child${childCount > 1 ? 'ren' : ''} -->`;
        } else {
            const text = getTextSummary(el);
            if (text) {
                const brief = text.length > 40 ? text.slice(0, 37) + '...' : text;
                note = `  <!-- sibling${posNote}: "${escAttr(brief)}" -->`;
            }
        }
        return `${indent}${buildOpenTag(el)}${note}\n`;
    }

    function capture(target) {
        // build chain from <html> down to target
        const chain = [];
        let cur = target;
        while (cur && cur.nodeType === 1) {
            chain.unshift(cur);
            if (cur === document.documentElement) break;
            cur = cur.parentElement;
        }
        if (chain[0] !== document.documentElement) chain.unshift(document.documentElement);

        let html = '';
        for (let i = 0; i < chain.length; i++) {
            const el = chain[i];
            const indent = '  '.repeat(i);
            const isTarget = el === target;
            const open = buildOpenTag(el);
            const sibCount = el.parentElement ? el.parentElement.children.length - 1 : 0;
            const sibNote = sibCount > 0 ? `  <!-- +${sibCount} sibling${sibCount > 1 ? 's' : ''} pruned -->` : '';

            if (isTarget) {
                if (SETTINGS.expandSiblings && el.parentElement && el.parentElement.children.length > 1 && el.parentElement !== document.documentElement) {
                    // 列出 target 同級所有 children（含 target 自己），保持 DOM 順序
                    const allChildren = Array.from(el.parentElement.children);
                    const total = allChildren.length;
                    for (let j = 0; j < total; j++) {
                        const sib = allChildren[j];
                        const pos = ` ${j + 1}/${total}`;
                        if (sib === el) {
                            html += renderTargetLine(sib, indent, ` (child${pos})`);
                        } else {
                            html += renderSiblingLine(sib, indent, pos);
                        }
                    }
                } else {
                    html += renderTargetLine(el, indent, '');
                }
            } else {
                html += `${indent}${open}${sibNote}\n`;
            }
        }

        const sel = uniqueSelector(target);
        const url = location.href;
        const tagPath = chain.map(e => e.tagName.toLowerCase()).join(' > ');
        const sibMode = SETTINGS.expandSiblings ? 'expanded' : 'pruned';
        const lvsMode = SETTINGS.expandToLeaves ? 'leaves'   : 'pruned';
        // Clipboard output stays English regardless of UI language — see
        // STRINGS block: this is payload for an LLM, not a UI string.
        const out =
            `<!-- url:        ${url} -->\n` +
            `<!-- selector:   ${sel} -->\n` +
            `<!-- depth:      ${chain.length} layers (${tagPath}) -->\n` +
            `<!-- siblings:   ${sibMode} -->\n` +
            `<!-- descendants:${lvsMode} -->\n\n` +
            html;

        GM_setClipboard(out);

        const briefSel = sel.length > 70 ? sel.slice(0, 67) + '...' : sel;
        showToast(t('toastCopied', chain.length, sibMode, lvsMode, briefSel));
        console.log('[Spine Picker] copied:\n' + out);
    }

    // ============================================================
    //  Triggers + Menu
    //
    //  All four TM menu items live in MENU_IDS and are reregistered
    //  together whenever a label-affecting setting changes (siblings /
    //  leaves toggle update one label each; language toggle rewrites
    //  all four). This avoids stale labels and keeps the registration
    //  logic in one place — easier to extend with new toggles.
    // ============================================================
    const MENU_IDS = {
        togglePicker: null,
        siblings:     null,
        leaves:       null,
        lang:         null,
    };

    function safeUnregister(id) {
        if (id == null) return;
        if (typeof GM_unregisterMenuCommand !== 'function') return;
        try { GM_unregisterMenuCommand(id); } catch (_) {}
    }

    function safeRegister(label, fn, slot) {
        try {
            MENU_IDS[slot] = GM_registerMenuCommand(label, fn);
        } catch (err) {
            MENU_IDS[slot] = null;
            if (slot === 'togglePicker') {
                console.warn('[Spine Picker]', t('menuRegisterFailWarn'), err);
            } else if (slot === 'siblings') {
                console.warn('[Spine Picker]', t('siblingsMenuRegisterFailWarn'), err);
            } else {
                console.warn('[Spine Picker] menu register failed (' + slot + '):', err);
            }
        }
    }

    function reregisterAllMenus() {
        // Tear down, then rebuild — language changes rotate every label.
        for (const slot of Object.keys(MENU_IDS)) {
            safeUnregister(MENU_IDS[slot]);
            MENU_IDS[slot] = null;
        }
        safeRegister(t('menuTogglePicker'),
                     () => { STATE.active ? deactivate() : activate(); },
                     'togglePicker');
        safeRegister(t('menuSiblings', SETTINGS.expandSiblings),
                     toggleExpandSiblings,
                     'siblings');
        safeRegister(t('menuLeaves',   SETTINGS.expandToLeaves),
                     toggleExpandToLeaves,
                     'leaves');
        safeRegister(t('menuLang',     SETTINGS.language),
                     toggleLanguage,
                     'lang');
        console.log('[Spine Picker] menus registered:', MENU_IDS);
    }

    function refreshBanner() {
        if (STATE.active && STATE.banner) STATE.banner.textContent = bannerText();
    }

    function toggleExpandSiblings() {
        SETTINGS.expandSiblings = !SETTINGS.expandSiblings;
        saveSetting('expandSiblings', SETTINGS.expandSiblings);
        // Only siblings label needs refresh, but reregisterAllMenus is cheap
        // enough that we don't bother with per-slot updates — keeps the
        // toggle functions trivial and the menu state always consistent.
        reregisterAllMenus();
        refreshBanner();
        showToast(t('toastSiblings', SETTINGS.expandSiblings));
    }

    function toggleExpandToLeaves() {
        SETTINGS.expandToLeaves = !SETTINGS.expandToLeaves;
        saveSetting('expandToLeaves', SETTINGS.expandToLeaves);
        reregisterAllMenus();
        refreshBanner();
        showToast(t('toastLeaves', SETTINGS.expandToLeaves));
    }

    function toggleLanguage() {
        SETTINGS.language = SETTINGS.language === 'zh' ? 'en' : 'zh';
        saveSetting('language', SETTINGS.language);
        // Language flip rotates EVERY menu label (and the banner) — the same
        // reregisterAllMenus() handles it uniformly.
        reregisterAllMenus();
        refreshBanner();
        showToast(t('toastLang', SETTINGS.language));
    }

    reregisterAllMenus();

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
            e.preventDefault();
            e.stopPropagation();
            STATE.active ? deactivate() : activate();
        }
    }, true);

    console.log(`[Spine Picker] core ${CORE_VERSION} loaded | Ctrl+Shift+E pick | in pick: S=siblings D=leaves L=lang | siblings=${SETTINGS.expandSiblings ? 'on' : 'off'} leaves=${SETTINGS.expandToLeaves ? 'on' : 'off'} lang=${SETTINGS.language}`);
})();
