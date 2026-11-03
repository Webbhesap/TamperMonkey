// ==UserScript==
// @name         Image Scraper — harici dosyalı alternatif
// @namespace    https://example.invalid/image-scraper-alternative
// @version      0.3.5
// @description  Image Scraper arayüzünü yerel file:// HTML/CSS/JS dosyalarından yükleyen deneysel loader.
// @match        *://*/*
// @require      file:///C:/Users/Xxx/Downloads/Alternatif/lib/alpine.min.js
// @require      file:///C:/Users/Xxx/Downloads/Alternatif/lib/jszip.min.js
// @require      file:///C:/Users/Xxx/Downloads/Alternatif/modules/zip.js
// @require      file:///C:/Users/Xxx/Downloads/Alternatif/modules/settings-ui.js
// @require      file:///C:/Users/Xxx/Downloads/Alternatif/modules/page-tools.js
// @require      file:///C:/Users/Xxx/Downloads/Alternatif/modules/network.js
// @require      file:///C:/Users/Xxx/Downloads/Alternatif/modules/image-analysis.js
// @require      file:///C:/Users/Xxx/Downloads/Alternatif/modules/ui-results.js
// @require      file:///C:/Users/Xxx/Downloads/Alternatif/app.js
// @resource     appHtml file:///C:/Users/Xxx/Downloads/Alternatif/panel.html
// @resource     appCss file:///C:/Users/Xxx/Downloads/Alternatif/styles.css
// @grant        GM_getResourceText
// @grant        GM_getResourceURL
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  'use strict';
  try {
    const app = globalThis.ImageScraperApp;
    const panelHtml = GM_getResourceText('appHtml');
    const cssUrl = GM_getResourceURL('appCss');
    if (!app?.start || !panelHtml || !cssUrl) throw new Error('app.js, panel.html veya styles.css yüklenemedi. Metadata URL’lerini kontrol et.');
    app.start({ panelHtml, cssUrl });
  } catch (error) {
    console.error('[Image Scraper Alternative]', error);
  }
})();
