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
    var CORE_VERSION = '0.2.1';

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

    // 設定：持久化到 GM storage
    const SETTINGS_KEYS = {
        expandSiblings: { key: 'expandSiblings', default: false, label: '同級展開' },
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
    };

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
        const sib = SETTINGS.expandSiblings ? '同級展開:開' : '同級展開:關';
        return `Spine Picker | 點擊元素複製 | Esc 取消 | S 切換${sib}`;
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
            catch (err) { console.error('[Spine Picker] capture failed', err); showToast('擷取失敗：' + err.message); }
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
        // 拾取模式中按 S 切換「同級展開」
        if ((e.key === 's' || e.key === 'S') && !e.ctrlKey && !e.altKey && !e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            toggleExpandSiblings();
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
        // direct text-only content (not deep) — useful if it's a leaf
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
        if (!t) return '';
        return t.length > 100 ? t.slice(0, 97) + '...' : t;
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
        // posNote 例如 " (child 3/5)"，無位置資訊時傳空字串
        let html = `${indent}${buildOpenTag(el)}  <!-- TARGET${posNote} -->\n`;
        const text = getTextSummary(el);
        if (text) html += `${indent}  ${escAttr(text)}\n`;
        const childCount = el.children.length;
        if (childCount > 0) {
            html += `${indent}  <!-- ...${childCount} child node${childCount > 1 ? 's' : ''} omitted... -->\n`;
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
        const out =
            `<!-- url:      ${url} -->\n` +
            `<!-- selector: ${sel} -->\n` +
            `<!-- depth:    ${chain.length} layers (${tagPath}) -->\n` +
            `<!-- siblings: ${sibMode} -->\n\n` +
            html;

        GM_setClipboard(out);

        const briefSel = sel.length > 70 ? sel.slice(0, 67) + '...' : sel;
        showToast(`已複製祖先脊椎\n深度: ${chain.length} 層 / 同級: ${sibMode}\nselector: ${briefSel}`);
        console.log('[Spine Picker] copied:\n' + out);
    }

    // ============================================================
    //  Triggers + Menu
    // ============================================================
    try {
        const id = GM_registerMenuCommand('Spine Picker: 切換拾取模式 (Ctrl+Shift+E)', () => {
            STATE.active ? deactivate() : activate();
        });
        console.log('[Spine Picker] menu registered (toggle picker), id =', id);
    } catch (err) {
        console.warn('[Spine Picker] GM_registerMenuCommand 失敗，請用 Ctrl+Shift+E 啟動：', err);
    }

    // 同級展開 toggle — 嘗試動態重註冊，不支援時退回靜態標籤 + toast 提示
    let siblingsMenuId = null;
    function siblingsLabel() {
        return `Spine Picker: 同級展開（目前：${SETTINGS.expandSiblings ? '開' : '關'}）`;
    }
    function registerSiblingsMenu() {
        try {
            siblingsMenuId = GM_registerMenuCommand(siblingsLabel(), toggleExpandSiblings);
            console.log('[Spine Picker] menu registered (siblings), id =', siblingsMenuId, 'label =', siblingsLabel());
        } catch (err) {
            siblingsMenuId = null;
            console.warn('[Spine Picker] 同級展開 menu 註冊失敗，請用拾取模式中按 S 切換：', err);
        }
    }
    function toggleExpandSiblings() {
        SETTINGS.expandSiblings = !SETTINGS.expandSiblings;
        saveSetting('expandSiblings', SETTINGS.expandSiblings);
        // 嘗試 unregister 舊的、重註冊新 label；失敗就讓使用者重新整理才看到新 label
        if (siblingsMenuId != null && typeof GM_unregisterMenuCommand === 'function') {
            try { GM_unregisterMenuCommand(siblingsMenuId); } catch (_) {}
        }
        registerSiblingsMenu();
        // 啟用中的 banner 也更新
        if (STATE.active && STATE.banner) {
            STATE.banner.textContent = bannerText();
        }
        showToast(`同級展開：${SETTINGS.expandSiblings ? '開' : '關'}`);
    }
    registerSiblingsMenu();

    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
            e.preventDefault();
            e.stopPropagation();
            STATE.active ? deactivate() : activate();
        }
    }, true);

    console.log(`[Spine Picker] core ${CORE_VERSION} loaded | Ctrl+Shift+E 啟動 | 拾取中按 S 切換同級展開 | 目前同級展開: ${SETTINGS.expandSiblings ? 'on' : 'off'}`);
})();
