// ==UserScript==
// @name         Spine Picker (dev bootstrap)
// @namespace    https://github.com/k0504/spine-picker
// @version      1.0.0
// @description  Dev bootstrap for Spine Picker — fetches latest core logic from local server and runs it. @version 1.0.0 is permanent; never bump unless the bootstrap protocol itself changes.
// @author       k0504
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// @noframes
// @connect      127.0.0.1
// @connect      localhost
// @license      MIT
// ==/UserScript==

/*
 * Two-layer architecture (mirrors C:/project/bilibili-fav-list-fix):
 *
 *   1. THIS FILE — installed in Tampermonkey ONCE, version 1.0.0.
 *      Only job: fetch the core JS from the local server and eval it.
 *      NEVER bump @version — bumping forces the user to re-confirm install
 *      and re-approve every @grant.
 *
 *   2. spine-picker-core.js — all the real logic.
 *      Edit freely; reload the matched tab to pick up changes.
 *      No Tampermonkey re-touch needed.
 *
 * Why: TM rejects http://127.0.0.1 as @updateURL (insecure-origin policy),
 * so an auto-updating userscript pointing at the local server is impossible.
 * Solution: pin the stub at v1.0.0 forever, do all updates server-side.
 *
 * CSP caveat: this userscript matches every page (see @match) so the core
 * is eval()-ed on arbitrary sites. Sites with strict CSP that forbid
 * 'unsafe-eval' (e.g. github.com, twitter.com, many banks) will block the
 * eval — pick a permissive site to dev against (example.com, mdn.io, your
 * own page), or install the end-user single-file build from
 * https://github.com/k0504/spine-picker (dist/spine-picker.user.js).
 *
 * Trade-off: server down means userscript inert on every page until it
 * returns. The bootstrap fails silently on network error (would otherwise
 * spam an error toast on every page); console.warn is the only signal.
 */

(function () {
    'use strict';

    var SERVER_BASE = 'http://127.0.0.1:8767';
    var CORE_PATH = '/spine-picker-core.js';

    function showError(msg) {
        // Visible error toast — only shown for HTTP-level failures (server
        // is up but returned non-2xx, or eval threw). Network-level failure
        // (server simply down) is silent on every page; see ontimeout/onerror.
        try {
            var paint = function () {
                var el = document.createElement('div');
                el.textContent = 'spine-picker: ' + msg;
                el.style.cssText = [
                    'position:fixed', 'right:12px', 'bottom:12px', 'z-index:2147483647',
                    'padding:6px 10px', 'border-radius:14px',
                    'font:600 12px/1.2 -apple-system,Segoe UI,sans-serif',
                    'color:#fff', 'background:#c0392b',
                    'box-shadow:0 2px 6px rgba(0,0,0,.25)',
                    'pointer-events:none', 'user-select:none'
                ].join(';');
                document.body.appendChild(el);
                setTimeout(function () { el.remove(); }, 6000);
            };
            if (document.body) paint();
            else document.addEventListener('DOMContentLoaded', paint, { once: true });
        } catch (e) { /* ignore */ }
    }

    try {
        GM_xmlhttpRequest({
            method: 'GET',
            url: SERVER_BASE + CORE_PATH + '?t=' + Date.now(),
            timeout: 5000,
            headers: { 'Cache-Control': 'no-cache' },
            onload: function (resp) {
                if (resp.status < 200 || resp.status >= 300) {
                    console.warn('[spine-picker/bootstrap] core fetch HTTP', resp.status);
                    showError('core HTTP ' + resp.status);
                    return;
                }
                try {
                    // eval keeps the core in the userscript ISOLATED world so
                    // it inherits GM_setClipboard / GM_addStyle / GM_*Value etc.
                    eval(resp.responseText);
                    console.log('[spine-picker/bootstrap] core loaded ('
                                + resp.responseText.length + ' bytes)');
                } catch (e) {
                    console.error('[spine-picker/bootstrap] core eval failed', e);
                    // Likely CSP unsafe-eval block on strict-CSP sites — surface
                    // it so the user knows to use the dist build here.
                    showError('core eval failed: ' + e.message);
                }
            },
            onerror: function () {
                // Silent: this script matches *://*/* — server-down is the
                // normal state when not actively developing, and a toast on
                // every page would be unbearable. console.warn is enough.
                console.warn('[spine-picker/bootstrap] server unreachable at',
                             SERVER_BASE, '— run `python serve.py` to enable dev mode');
            },
            ontimeout: function () {
                console.warn('[spine-picker/bootstrap] core fetch timeout');
            }
        });
    } catch (e) {
        console.error('[spine-picker/bootstrap] GM_xmlhttpRequest threw', e);
        showError('bootstrap error');
    }
})();
