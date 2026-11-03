// Minimal Chrome harness that mimics a Tampermonkey userscript environment:
// GM_* storage/requests/clipboard APIs, @require module order and the
// @resource panel.html/styles.css injection used by the loader userscript.
import puppeteer from 'puppeteer-core';

export const GM_BOOTSTRAP = `
(function () {
  // Tampermonkey storage is shared by every tab of the same userscript; the
  // localStorage-backed store keeps that behaviour across reloads in tests.
  const memory = new Map();
  const read = key => {
    try { const raw = localStorage.getItem('__gm__' + key); return raw === null ? undefined : JSON.parse(raw); }
    catch { return memory.has(key) ? memory.get(key) : undefined; }
  };
  const write = (key, value) => {
    memory.set(key, value);
    try { localStorage.setItem('__gm__' + key, JSON.stringify(value)); } catch {}
  };
  const clear = key => {
    memory.delete(key);
    try { localStorage.removeItem('__gm__' + key); } catch {}
  };
  const state = { xhrLog: [], clipboard: [], seenRequests: [] };
  Object.defineProperty(window, '__gm', { value: state });
  window.GM_getValue = (key, fallback) => { const value = read(key); return value === undefined ? fallback : value; };
  window.GM_setValue = (key, value) => { write(key, value); };
  window.GM_deleteValue = key => { clear(key); };
  window.GM_setClipboard = (text) => { state.clipboard.push(text); };
  window.GM_getResourceText = name => window.__gmResources?.[name] ?? null;
  window.GM_getResourceURL = name => name === 'appCss' ? window.__gmCssUrl : null;
  window.GM_xmlhttpRequest = options => {
    const entry = { url: options.url, headers: options.headers || {}, aborted: false };
    state.xhrLog.push(entry); state.seenRequests.push(options.url);
    const controller = new AbortController();
    const finish = (fn, value) => { if (!entry.aborted) fn(value); };
    entry.abort = () => { entry.aborted = true; try { controller.abort(); } catch {} };
    fetch(options.url, { signal: controller.signal, credentials: 'include', headers: options.headers || {} })
      .then(async response => {
        const headers = [...response.headers.entries()].map(([k, v]) => k + ': ' + v).join('\\r\\n');
        if (options.responseType === 'blob') {
          const blob = await response.blob();
          finish(options.onload, { status: response.status, statusText: response.statusText, responseHeaders: headers, finalUrl: response.url, response: blob });
        } else {
          const text = await response.text();
          finish(options.onload, { status: response.status, statusText: response.statusText, responseHeaders: headers, finalUrl: response.url, responseText: text });
        }
      })
      .catch(error => {
        if (entry.aborted) finish(options.onabort, {});
        else finish(options.onerror, { error });
      });
    return entry;
  };
})();
`;

const SCRIPTS = [
  'lib/alpine.min.js',
  'lib/jszip.min.js',
  'modules/zip.js',
  'modules/settings-ui.js',
  'modules/page-tools.js',
  'modules/network.js',
  'modules/image-analysis.js',
  'modules/ui-results.js',
  'app.js',
];

export class Harness {
  constructor({ executablePath, browserArgs = [], userDataDir } = {}) {
    this.executablePath = executablePath;
    this.browserArgs = browserArgs;
    this.userDataDir = userDataDir;
  }

  async launch() {
    this.browser = await puppeteer.launch({
      executablePath: this.executablePath,
      headless: 'shell',
      args: [...this.browserArgs, '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run'],
      env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '' },
      userDataDir: this.userDataDir,
    });
    return this.browser;
  }

  async close() { await this.browser?.close(); }

  /**
   * Opens a page, injects the userscript environment (GM stubs, @require
   * scripts, panel resources) and optionally runs the loader's start logic.
   */
  async open(target, { files = {}, start = true, resetStorage = true, requireScripts = [] } = {}) {
    const browserPage = await this.browser.newPage();
    const consoleMessages = [], pageErrors = [];
    browserPage.on('console', msg => consoleMessages.push(`${msg.type()}: ${msg.text()}`));
    browserPage.on('pageerror', error => pageErrors.push(String(error && error.stack || error)));
    const client = await browserPage.createCDPSession();
    // Serve the userscript assets from the workspace, like a CDN would.
    await client.send('Fetch.enable', { patterns: [{ urlPattern: 'https://userscript.test/*', requestStage: 'Request' }] });
    client.on('Fetch.requestPaused', async event => {
      const url = new URL(event.request.url);
      const key = url.pathname.replace(/^\/+/, '');
      const body = files[key];
      if (body === undefined) {
        await client.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 404, body: Buffer.from('missing').toString('base64') });
        return;
      }
      await client.send('Fetch.fulfillRequest', {
        requestId: event.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'content-type', value: key.endsWith('.css') ? 'text/css; charset=utf-8' : key.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' },
          { name: 'access-control-allow-origin', value: '*' },
        ],
        body: Buffer.from(body).toString('base64'),
      });
    });
    if (resetStorage) {
      // Keep tests independent: storage belongs to the userscript, not the page.
      await browserPage.evaluateOnNewDocument(() => {
        try {
          for (const key of Object.keys(localStorage)) if (key.startsWith('__gm__')) localStorage.removeItem(key);
        } catch { /* opaque origin */ }
      });
    }
    await browserPage.evaluateOnNewDocument(GM_BOOTSTRAP);
    // @require ile gelen dosyalar: gerçek Tampermonkey bunları sayfa betiklerinden
    // önce, belge oluşmadan çalıştırır. Loader testleri bu davranışı taklit eder.
    const preload = requireScripts.length ? requireScripts : (start ? SCRIPTS : []);
    if (preload.length) {
      for (const script of preload) {
        const code = files[script];
        if (code === undefined) throw new Error(`Missing script fixture: ${script}`);
        await browserPage.evaluateOnNewDocument(code);
      }
    }
    await browserPage.goto(target, { waitUntil: 'domcontentloaded' });
    // Evaluate the userscript modules exactly like @require does (classic scripts in page context).
    if (start) {
      for (const script of SCRIPTS) {
        const code = files[script];
        await browserPage.evaluate(code);
        if (script === 'app.js') continue;
      }
      await browserPage.evaluate(async (panelHtml, cssPath) => {
        const response = await fetch(cssPath);
        window.__gmCssUrl = URL.createObjectURL(await response.blob());
        window.__gmResources = { appHtml: panelHtml };
        const app = globalThis.ImageScraperApp;
        if (!app?.start) throw new Error('app.js yüklenmedi');
        app.start({ panelHtml: window.__gmResources.appHtml, cssUrl: window.__gmCssUrl });
      }, files['panel.html'], 'https://userscript.test/styles.css');
    }
    return { page: browserPage, consoleMessages, pageErrors, client };
  }
}

/** Waits until fn() is truthy inside the page, returns its value. */
export async function waitFor(page, fn, { timeout = 20000, interval = 100, arg } = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    try {
      const value = await page.evaluate(fn, arg);
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`waitFor zaman aşımı${lastError ? `: ${lastError.message}` : ''}`);
}

/** Resolves the shadow root handle of the scraper UI. */
export async function shadow(page) {
  const handle = await page.evaluateHandle(() => document.getElementById('__image_scraper_v4__')?.shadowRoot || null);
  const element = handle.asElement();
  if (!element) throw new Error('Shadow root bulunamadı');
  return element;
}

/** Finds a node inside the shadow DOM by CSS selector, searching nested dialogs. */
export async function shadowQuery(page, selector) {
  const root = await shadow(page);
  const found = await root.$$(selector);
  return found;
}

export async function shadowText(page) {
  const root = await shadow(page);
  return root.evaluate(node => node.textContent || '');
}
