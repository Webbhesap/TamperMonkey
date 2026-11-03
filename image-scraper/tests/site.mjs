// Local test site used by the Image Scraper test suite.
// It exercises every supported pagination mode, deep crawl, lazy loading,
// source filtering, blocked/challenge responses and ZIP/image transport paths.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_DIR = path.join(here, 'fixtures', 'images');

const MIME = {
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

const image = name => `/images/${encodeURIComponent(name)}`;

const page = (title, body, head = '') => `<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>${title}</title>${head}</head><body>${body}</body></html>`;

const img = (name, attrs = '') => `<img src="${image(name)}" alt="${name}" ${attrs}>`;

// Performans testi: çok sayıda görsel içeren sayfa. Kaynak kodda her görsel
// başına O(n) dizi araması yapılırsa bu sayfa karesel yavaşlar.
function manyImagesPage(count = 500) {
  const rows = [];
  const names = ['red-400x300.png', 'blue-320x240.png', 'green-1200x800.png', 'tiny-30x30.png', 'vector.svg'];
  for (let i = 0; i < count; i++) rows.push(img(names[i % names.length], `width="400" height="300"`));
  // Aynı adres birden çok kez: tekrar kaydı yolu da ölçülür.
  for (let i = 0; i < 200; i++) rows.push(img('red-400x300.png'));
  return page('Büyük sayfa', `<h1>Büyük test sayfası</h1><main><article>${rows.join('')}</article></main>`);
}

function lazyPage() {
  return page('Temel sayfa', `
  <h1>Temel test sayfası</h1>
  <main>
    <article>
      ${img('red-400x300.png', 'width="400" height="300"')}
      ${img('blue-320x240.png')}
      ${img('green-1200x800.png')}
      ${img('tiny-30x30.png')}
      ${img('pixel-1x1.gif')}
      ${img('thumb-100x100.png')}
      ${img('vector.svg')}
      ${img('spaced name 500x400.png')}
      <img data-src="${image('pattern-900x600.png')}" src="/images/placeholder.gif" alt="lazy">
      <picture>
        <source srcset="${image('green-1200x800.png')} 1200w, ${image('blue-320x240.png')} 320w">
        <img src="${image('tiny-30x30.png')}" alt="picture">
      </picture>
      <img src="${image('red-400x300.png')}" alt="duplicate-url">
      <img src="${image('red-400x300.png')}#fragment" alt="duplicate-url-fragment">
    </article>
    <aside>${img('thumb-100x100.png', 'alt="aside thumb"')}</aside>
  </main>`);
}

function selectorPage() {
  return page('Seçici sayfası', `
  <div class="single-content">
    <p>${img('red-400x300.png')}</p>
    <p>${img('blue-320x240.png')}</p>
  </div>
  <div class="sidebar">${img('green-1200x800.png')}</div>`);
}

function paginationLinks(current, total, hrefFor, rel = true) {
  let out = `<nav class="pagination" aria-label="pagination">`;
  for (let i = 1; i <= total; i++) {
    out += i === current
      ? `<span class="current" aria-current="page">${i}</span>`
      : `<a href="${hrefFor(i)}">${i}</a>`;
  }
  if (current < total) out += `<a rel="next" href="${hrefFor(current + 1)}">Sonraki</a>`;
  out += `</nav>`;
  return out;
}

const notFoundPage = () => page('404', '<h1>Bulunamadı</h1>');

function pagedPage(mode, n, total) {
  const href = i => {
    if (mode === 'html-slash') return i === 1 ? '/paged-html/index.html' : `/paged-html/index.html/${i}`;
    if (mode === 'query-page') return `/paged-query/?page=${i}`;
    if (mode === 'page-path') return `/paged-path/page/${i}/`;
    if (mode === 'slash-page') return i === 1 ? '/paged-slash/' : `/paged-slash/${i}`;
    if (mode === 'dash-html') return `/paged-dash/post-${i}.html`;
    if (mode === 'custom') return i === 1 ? '/paged-custom/1' : `/paged-custom/${i}`;
    return '/';
  };
  return page(`${mode} ${n}`, `
  <h1>${mode} sayfa ${n}</h1>
  <main>
    <article>${img(`page-${mode}-${n}.png`, 'width="400" height="300"')}<p>Sayfa ${n} içeriği</p></article>
    ${paginationLinks(n, total, href)}
  </main>`);
}

function duplicatePage(n) {
  return page('yinelenen', `
  <h1>Aynı içerik</h1>
  <article>${img('red-400x300.png')}<p>Her sayfada tamamen aynı içerik.</p></article>
  <nav class="pagination"><a rel="next" href="/duplicate-page/?page=${n + 1}">Sonraki</a></nav>`);
}

function categoryPage(n, articleCount) {
  const cards = Array.from({ length: articleCount }, (_, i) => {
    const id = (n - 1) * articleCount + i + 1;
    return `<article class="card"><h2><a href="/article/${id}">İçerik ${id} başlığı</a></h2>
      <p>Özet ${id}</p><a href="/category/?page=${n + 1}">Sonraki sayfa</a></article>`;
  }).join('');
  return page(`Kategori ${n}`, `<h1>Kategori sayfa ${n}</h1><main>${cards}</main>
    <nav class="pagination"><a rel="next" href="/category/?page=${n + 1}">Sonraki</a></nav>`);
}

function articlePage(id, part = 1) {
  return page(`İçerik ${id}`, `<h1>İçerik ${id} başlığı</h1>
    <article class="single-content">
      ${img(`article-${id}-${part}.png`, 'width="400" height="300"')}
      <p>İçerik ${id} bölüm ${part}</p>
    </article>
    ${part < 2 ? `<nav class="pagination"><a class="next" href="/article/${id}/${part + 1}">Sonraki sayfa</a></nav>` : `<nav class="pagination"><a href="/category/?page=1">Kategoriye dön</a></nav>`}`);
}

function challengeLinkPage() {
  return page('Bağlantılı sayfa', `<h1>Bağlantılı sayfa</h1><article>${img('red-400x300.png')}</article>
    <nav class="pagination"><a rel="next" href="/challenge/">Sonraki</a></nav>`);
}

function localizedChallengeLinkPage() {
  return page('Yerelleştirilmiş bağlantı', `<h1>Yerelleştirilmiş bağlantı</h1><article>${img('blue-320x240.png')}</article>
    <nav class="pagination"><a rel="next" href="/challenge-tr/">Sonraki</a></nav>`);
}

function forbiddenLinkPage() {
  return page('Yasak sonrası', `<h1>Yasak sonrası</h1><article>${img('blue-320x240.png')}</article>
    <nav class="pagination"><a rel="next" href="/forbidden/">Sonraki</a></nav>`);
}

function brokenImagesPage() {
  return page('Kırık görseller', `<h1>Kırık görseller</h1><article>
    ${img('red-400x300.png')}
    ${img('404.png')}
    ${img('403.png')}
    ${img('no-extension')}
  </article>`);
}

function challengeBody(localized = false) {
  // Türkçe/yerelleştirilmiş challenge sayfası: başlık İngilizce değil ama
  // yapısal işaretler (challenge-platform betiği, cf_chl_) aynı.
  const title = localized ? 'Bir dakika lütfen...' : 'Just a moment...';
  return page(title, '<div id="challenge"></div>',
    '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script>');
}

function serveImage(req, res, url) {
  const name = decodeURIComponent(url.pathname.replace('/images/', ''));
  if (name === '404.png') { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('yok'); return; }
  if (name === '403.png') { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('yasak'); return; }
  if (name === 'challenge.png') {
    res.writeHead(403, { 'content-type': 'text/html', 'cf-mitigated': 'challenge' });
    res.end(challengeBody()); return;
  }
  if (name === 'slow.png') {
    setTimeout(() => {
      try { res.writeHead(200, { 'content-type': 'image/png' }); res.end(fs.readFileSync(path.join(IMAGE_DIR, 'red-400x300.png'))); } catch { /* client went away */ }
    }, 1500); return;
  }
  if (name === 'no-extension') {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(fs.readFileSync(path.join(IMAGE_DIR, 'blue-320x240.png'))); return;
  }
  // Deterministic generated images for pagination / article / dedupe tests.
  const generated = /^((?:page|article)-[\w-]+)\.png$/.exec(name);
  if (generated) {
    const seed = generated[1];
    const color = [...seed].reduce((a, c) => (a * 33 + c.charCodeAt(0)) % 0xffffff, 7);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#${color.toString(16).padStart(6, '0')}"/><text x="20" y="150" font-size="20">${seed}</text></svg>`;
    res.writeHead(200, { 'content-type': 'image/svg+xml' }); res.end(svg); return;
  }
  const file = path.join(IMAGE_DIR, name);
  if (!file.startsWith(IMAGE_DIR) || !fs.existsSync(file)) { res.writeHead(404); res.end('yok'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(name).toLowerCase()] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}

export async function startSite() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;
    const send = (status, type, body, headers = {}) => {
      res.writeHead(status, { 'content-type': type, ...headers }); res.end(body);
    };
    const html = body => send(200, 'text/html; charset=utf-8', body);

    if (p.startsWith('/images/')) return serveImage(req, res, url);
    if (p === '/basic/' || p === '/') return html(lazyPage());
    if (p === '/many/') return html(manyImagesPage());
    if (p === '/huge/') return html(manyImagesPage(5000));
    if (p === '/selector/') return html(selectorPage());
    if (p === '/broken-images/') return html(brokenImagesPage());
    if (p === '/challenge-link/') return html(challengeLinkPage());
    if (p === '/challenge-tr-link/') return html(localizedChallengeLinkPage());
    if (p === '/forbidden-link/') return html(forbiddenLinkPage());
    const TOTAL_PAGES = 3;
    const paged = (mode, n) => (n < 1 || n > TOTAL_PAGES ? send(404, 'text/html; charset=utf-8', notFoundPage()) : html(pagedPage(mode, n, TOTAL_PAGES)));
    if (p.startsWith('/paged-html/')) {
      if (p === '/paged-html/index.html' || p === '/paged-html/') return paged('html-slash', 1);
      const m = /\/paged-html\/index\.html\/(\d+)\/?$/.exec(p);
      return m ? paged('html-slash', Number(m[1])) : send(404, 'text/html; charset=utf-8', notFoundPage());
    }
    if (p === '/paged-query/') return paged('query-page', Number(url.searchParams.get('page') || 1));
    if (p.startsWith('/paged-path/')) {
      const m = /\/paged-path\/page\/(\d+)\/?$/.exec(p);
      if (/\/paged-path\/?$/.test(p)) return paged('page-path', 1);
      return m ? paged('page-path', Number(m[1])) : send(404, 'text/html; charset=utf-8', notFoundPage());
    }
    if (p.startsWith('/paged-slash/')) {
      const m = /\/paged-slash\/(\d+)\/?$/.exec(p);
      return m ? paged('slash-page', Number(m[1])) : paged('slash-page', 1);
    }
    if (p.startsWith('/paged-dash/')) {
      const m = /\/paged-dash\/post-(\d+)\.html$/.exec(p);
      return m ? paged('dash-html', Number(m[1])) : send(404, 'text/html; charset=utf-8', notFoundPage());
    }
    if (p.startsWith('/paged-custom/')) {
      const m = /\/paged-custom\/(\d+)\/?$/.exec(p);
      return m ? paged('custom', Number(m[1])) : send(404, 'text/html; charset=utf-8', notFoundPage());
    }
    if (p === '/duplicate-page/') return html(duplicatePage(Number(url.searchParams.get('page') || 1)));
    if (p === '/category/') return html(categoryPage(Number(url.searchParams.get('page') || 1), 2));
    if (p.startsWith('/article/')) {
      const m = /\/article\/(\d+)(?:\/(\d+))?$/.exec(p);
      return m ? html(articlePage(m[1], Number(m[2] || 1))) : send(404, 'text/plain', 'yok');
    }
    if (p === '/challenge/') {
      send(403, 'text/html; charset=utf-8', challengeBody(), { 'cf-mitigated': 'challenge' }); return;
    }
    if (p === '/challenge-tr/') {
      // Yerelleştirilmiş challenge sayfası (Türkçe başlık, aynı yapısal işaretler).
      send(403, 'text/html; charset=utf-8', challengeBody(true), { 'cf-mitigated': 'challenge' }); return;
    }
    if (p === '/forbidden/') return send(403, 'text/html', '<h1>403</h1>');
    if (p === '/plain-text/') return send(200, 'text/plain', 'bu html değil');
    if (p === '/cross-origin-redirect/') { res.writeHead(302, { location: 'http://localhost.invalid/' }); res.end(); return; }
    send(404, 'text/html; charset=utf-8', '<h1>404</h1>');
  });
  // Slow endpoints must not stall the server for other requests.
  server.keepAliveTimeout = 1000;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
