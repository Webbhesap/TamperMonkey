/* Page/image URL parsing and pagination rules. */
(function (global) {
  const modules = global.ImageScraperModules || (global.ImageScraperModules = Object.create(null));
  modules.createPageTools = function createPageTools(deps) {
    const { document, location, normalizeExcludedSite, isExcludedHost, DEFAULTS } = deps;
    function buildUrl(raw, base, config) {
      try {
        let url = new URL(raw.trim(), base).href;
        if (config.USE_REPLACE) for (const rule of config.REPLACEMENTS) url = url.split(rule.from).join(rule.to);
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return null;
        parsed.hash = '';
        return parsed.href; // encodeURI/decodeURI tekrar uygulanmaz; imzalı URL'ler korunur.
      } catch { return null; }
    }
    function srcsetUrl(srcset) {
      if (!srcset || /^\s*data:/i.test(srcset)) return null;
      return srcset.split(',').map(part => {
        const bits = part.trim().split(/\s+/);
        const m = /^(\d+(?:\.\d+)?)(w|x)$/.exec(bits[1] || '');
        return { url: bits[0], score: m ? Number(m[1]) : 1 };
      }).filter(x => x.url).sort((a, b) => b.score - a.score)[0]?.url || null;
    }
    function imageUrl(img, live) {
      // Lazy-load alanları, çoğu sitede src içindeki yer tutucudan daha değerlidir.
      for (const attr of ['data-full', 'data-original', 'data-src', 'data-lazy-src', 'data-lazy', 'data-url']) {
        const value = img.getAttribute(attr); if (value && value.trim() && !/^data:/i.test(value.trim())) return value;
      }
      const picture = img.closest('picture');
      const source = picture && [...picture.querySelectorAll('source')].find(s => (!s.media || matchMedia(s.media).matches) && (s.getAttribute('data-srcset') || s.getAttribute('srcset')));
      const responsive = srcsetUrl(img.getAttribute('data-srcset')) || srcsetUrl(img.getAttribute('srcset')) || (source && (srcsetUrl(source.getAttribute('data-srcset')) || srcsetUrl(source.getAttribute('srcset'))));
      if (responsive) return responsive;
      return (live && img.currentSrc) || img.getAttribute('src') || null;
    }
    function documentBase(doc, url) {
      const base = doc.querySelector('base[href]');
      try { return base ? new URL(base.getAttribute('href'), url).href : url; } catch { return url; }
    }
    function passesImageSourceHost(imageUrlValue, pageUrl, config) {
      const mode = config.IMAGE_SOURCE_MODE || 'any';
      if (mode === 'any') return true;
      try {
        const imageHost = new URL(imageUrlValue).hostname.toLowerCase();
        if (mode === 'same-host') return isExcludedHost(imageHost, [new URL(pageUrl).hostname.toLowerCase()]);
        const hosts = String(config.IMAGE_SOURCE_HOSTS || '').split(/[\n,;]+/).map(normalizeExcludedSite).filter(Boolean);
        return hosts.length > 0 && isExcludedHost(imageHost, hosts);
      } catch { return false; }
    }
    function smartFitMode(imageWidth, imageHeight, viewportWidth, viewportHeight) {
      if (!(imageWidth > 0 && imageHeight > 0 && viewportWidth > 0 && viewportHeight > 0)) return 'contain';
      return imageWidth / imageHeight > viewportWidth / viewportHeight ? 'cover' : 'contain';
    }
    function htmlDimension(img, name) {
      const value = String(img.getAttribute(name) || '').trim();
      if (!/^\d+$/.test(value)) return 0;
      const number = Number(value); return Number.isSafeInteger(number) && number > 0 && number <= 1000000 ? number : 0;
    }
    function collect(doc, url, config, seen, seenNodes = null, onDuplicate = null) {
      const base = documentBase(doc, url);
      let imgs;
      if (config.USE_SELECTOR) {
        imgs = [];
        for (const node of doc.querySelectorAll(config.SELECTOR)) {
          if (node.matches('img')) imgs.push(node);
          imgs.push(...node.querySelectorAll('img'));
        }
      } else imgs = [...doc.querySelectorAll('img')];
      const rx = config.SKIP_PATTERNS ? new RegExp(config.SKIP_PATTERNS, 'i') : null;
      const found = [];
      for (const img of imgs) {
        const raw = imageUrl(img, doc === document);
        const resolved = raw && buildUrl(raw, base, config);
        if (!resolved || !passesImageSourceHost(resolved, url, config) || (rx && rx.test(resolved))) continue;
        if (seenNodes) {
          const previousUrl = seenNodes.get(img);
          if (previousUrl === resolved) continue;
          seenNodes.set(img, resolved);
        }
        if (seen.has(resolved)) { if (typeof onDuplicate === 'function') onDuplicate(resolved, url); continue; }
        seen.add(resolved);
        // Width/height HTML öznitelikleri genellikle doğal boyut değil, görüntüleme boyutudur.
        const w = doc === document && img.currentSrc === resolved ? img.naturalWidth : 0;
        const h = doc === document && img.currentSrc === resolved ? img.naturalHeight : 0;
        found.push({ url: resolved, width: w || 0, height: h || 0, displayWidth: htmlDimension(img, 'width'), displayHeight: htmlDimension(img, 'height'), page: url, selected: true, status: 'bekliyor' });
      }
      return found;
    }
    function nextByTemplate(currentUrl, mode, visited, config = {}, currentPageNumber = 1) {
      try {
        let url = new URL(currentUrl); let match, n;
        if (mode === 'query-page') {
          const raw = url.searchParams.get('page');
          if (raw && !/^\d+$/.test(raw)) return null;
          n = raw ? Number(raw) + 1 : 2;
          const original = url.search.slice(1);
          url.search = /(?:^|&)page=/.test(original) ? original.replace(/(^|&)page=[^&]*/, (_, prefix) => `${prefix}page=${n}`) : (original ? `${original}&page=${n}` : `page=${n}`);
        } else if (mode === 'html-slash') {
          match = url.pathname.match(/^(.*\.html)(?:\/(\d+))?\/?$/i);
          if (!match) return null;
          n = match[2] ? Number(match[2]) + 1 : 2; url.pathname = `${match[1]}/${n}`;
        } else if (mode === 'page-path') {
          match = url.pathname.match(/^(.*)\/page\/(\d+)\/?$/i);
          if (match) { n = Number(match[2]) + 1; url.pathname = `${match[1]}/page/${n}/`; }
          else url.pathname = url.pathname.replace(/\/$/, '') + '/page/2/';
        } else if (mode === 'slash-page') {
          match = url.pathname.match(/^(.*)\/(\d{1,3})\/?$/i);
          if (match) n = Number(match[2]) + 1;
          else n = 2;
          url.pathname = match ? `${match[1]}/${n}` : url.pathname.replace(/\/+$/, '') + `/${n}`;
        } else if (mode === 'dash-html' || mode === 'underscore-html') {
          const sep = mode === 'dash-html' ? '-' : '_';
          match = url.pathname.match(mode === 'dash-html' ? /^(.*?)(?:-(\d+))?\.html$/i : /^(.*?)(?:_(\d+))?\.html$/i);
          if (!match) return null;
          n = match[2] ? Number(match[2]) + 1 : 2; url.pathname = `${match[1]}${sep}${n}.html`;
        } else if (mode === 'custom') {
          const tmpl = config.CUSTOM_PAGINATION_TEMPLATE || DEFAULTS.CUSTOM_PAGINATION_TEMPLATE;
          const ordinal = pageOrdinal(url.href) || currentPageNumber;
          n = ordinal + 1;
          let current = url.href;
          // When the current URL ends in its page number (e.g. /2 or /2/),
          // treat {url}{n} and {url}/{n} as replacing that number, not appending
          // to it. Trim a trailing slash only when the template adds its own slash.
          if (tmpl.includes('{url}') && tmpl.includes('{n}')) {
            const pageSuffix = new RegExp(`/${ordinal}/?$`);
            if (ordinal > 0 && pageSuffix.test(url.pathname)) {
              url.pathname = url.pathname.replace(pageSuffix, '/');
              current = url.href;
            }
            if (/\{url\}\/\{n\}/.test(tmpl)) current = current.replace(/\/+$/, '');
          }
          const candidate = tmpl.replace(/\{url\}/g, current).replace(/\{n\}/g, String(n));
          try {
            const parsed = new URL(candidate, url.href); parsed.hash = '';
            url = parsed;
          } catch { return null; }
        } else return null;
        url.hash = '';
        return url.origin === location.origin && !visited.has(url.href) ? url.href : null;
      } catch { return null; }
    }
    function pageOrdinal(url) {
      try {
        const u = new URL(url), q = u.searchParams.get('page') || u.searchParams.get('paged');
        const p = (u.pathname.match(/(?:\.html\/|\/page\/|\/)(\d{1,3})\/?$/i) || [])[1];
        const n = Number(q || p); return Number.isInteger(n) && n >= 1 && n <= 999 ? n : 0;
      } catch { return 0; }
    }
    function nextPage(doc, currentUrl, visited, config = {}, currentPageNumber = 1) {
      const base = documentBase(doc, currentUrl);
      const links = [...doc.querySelectorAll('a[href]')];
      const strongPaginationSelector = 'nav[aria-label*="pagination" i], nav[aria-label*="page" i], nav[aria-label*="sayfa" i], .pagination, .pager, .page-numbers, .wp-pagenavi, .page-links, .pagenavi, .pages, .pgntn-page-pagination-block, [data-pagination], [class*="pagination" i], [class*="pagenavi" i]';
      const areas = [...doc.querySelectorAll(`${strongPaginationSelector}, .nav-links, .navigation, [role="navigation"]`)];
      const paginationLinks = areas.flatMap(el => [...el.querySelectorAll('a[href]')]);
      const isStrongPaginationContext = node => !!node?.closest?.(strongPaginationSelector);
      const normalizedPath = pathname => {
        let p = pathname.replace(/\/page\/\d+\/?$/i, '').replace(/(\.html)\/\d+\/?$/i, '$1')
          .replace(/\/\d+\.html$/i, '.html').replace(/[-_]\d+\.html$/i, '.html')
          .replace(/\/(?:page[-_]?\d+|\d{1,3})\/?$/i, '').replace(/[-_]\d+\/?$/i, '').replace(/\/+$/, '');
        return p || '/';
      };
      const samePaginationFamily = target => {
        try {
          const currentUrlObj = new URL(currentUrl), targetUrlObj = new URL(target);
          if (currentUrlObj.origin !== targetUrlObj.origin || normalizedPath(currentUrlObj.pathname) !== normalizedPath(targetUrlObj.pathname)) return false;
          const pageKeys = /^(?:page|paged|page_num|page_number|pagenum|page-no|pageno)$/i;
          const stable = u => [...u.searchParams.entries()].filter(([key]) => !pageKeys.test(key)).sort(([ak,av],[bk,bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
          return JSON.stringify(stable(currentUrlObj)) === JSON.stringify(stable(targetUrlObj));
        } catch { return false; }
      };
      const marked = doc.querySelector('[aria-current="page"], .pagination .current, .pagination .active, .wp-pagenavi .current, .page-numbers.current') || areas.map(el => el.querySelector('.current, .active, [aria-current="page"]')).find(Boolean);
      const markedNumber = Number(marked?.textContent.trim());
      const current = Number.isInteger(markedNumber) && markedNumber > 0 && markedNumber <= 999 ? markedNumber : (pageOrdinal(currentUrl) || 1);
      const usable = (node, enforceNext = true, trustPaginationContext = false) => {
        if (!node || node.matches?.('[aria-disabled="true"], .disabled, [disabled]') || node.closest?.('[aria-disabled="true"], .disabled')) return null;
        const raw = node.getAttribute('href'); if (!raw) return null;
        try {
          const u = new URL(raw, base); u.hash = '';
          if (u.origin !== location.origin || !['http:', 'https:'].includes(u.protocol) || visited.has(u.href)) return null;
          const label = (node.textContent || '').trim();
          const textNum = /^\d{1,3}$/.test(label) ? Number(label) : 0;
          const num = pageOrdinal(u.href) || textNum;
          // Belirli bir 6. sayfa bağlantısı seçildiğinde 2–5 atlanmamalı.
          if (enforceNext && num && num !== current + 1) return null;
          // Otomatik modda sayısal sıra veya URL ailesi tutmuyorsa, genel bir "Sonraki"
          // yazısının başka yazıya/bölüme götürmesini engelle. Semantik sayfalama
          // kapsayıcısı veya kullanıcı seçicisi varsa bu bağlam güvenilir kabul edilir.
          if (!trustPaginationContext && !samePaginationFamily(u.href)) return null;
          if (/^(?:all|showall|viewall)$/i.test(u.searchParams.get('page') || '') || /^(?:all pages|tüm sayfalar|hepsi)$/i.test(label)) return null;
          return u.href;
        } catch { return null; }
      };
      if (config.PAGINATION_MODE && config.PAGINATION_MODE !== 'auto') return nextByTemplate(currentUrl, config.PAGINATION_MODE, visited, config, currentPageNumber);
      let selectorHadNodes = false;
      if (config.NEXT_SELECTOR) {
        try {
          const nodes = doc.querySelectorAll(config.NEXT_SELECTOR);
          selectorHadNodes = nodes.length > 0;
          for (const node of nodes) {
            const anchor = node.hasAttribute('href') ? node : node.querySelector('a[href]');
            if (!anchor) continue;
            // nth-child(7) gibi bir seçici çoğu zaman son sayfayı işaret eder.
            // Seçici açıkça verildiğinde diğer sayfalama yöntemlerine düşülmez;
            // aynı grubundaki sıradaki sayısal kardeş (current + 1) tercih edilir.
            const group = anchor.closest('.pgntn-page-pagination-block, .pagination, .pager, .page-links, .wp-pagenavi, .pagenavi, nav') || anchor.parentElement;
            if (group) for (const a of group.querySelectorAll('a[href]')) {
              if ((a.textContent || '').trim() === String(current + 1)) { const url = usable(a, true, true); if (url) return url; }
            }
            const url = usable(anchor, true, true); if (url) return url;
          }
        } catch (e) { console.warn('[Image Scraper] Sonraki sayfa seçicisi geçersiz:', e); }
      }
      // Açıkça belirtilen bir seçici eşleşen düğüm bulduysa fakat kullanılabilir
      // bir sonraki sayfa üretemediysse, sayfanın sonuna ulaşıldı sayılır; genel
      // "Sonraki"/"»" bağlantısına atlanarak fazladan bir sayfa çekilmez.
      if (selectorHadNodes) return null;
      for (const node of doc.querySelectorAll('link[rel~="next"][href], a[rel~="next"][href]')) {
        const url = usable(node, true, isStrongPaginationContext(node)); if (url) return url;
      }
      const isNext = a => /(?:\bnext\b|sonraki|\bileri\b|›|»|→|older posts?)/i.test(`${a.textContent || ''} ${a.getAttribute('aria-label') || ''} ${a.getAttribute('title') || ''}`);
      for (const a of paginationLinks) if (isNext(a)) { const url = usable(a, true, isStrongPaginationContext(a)); if (url) return url; }
      for (const a of links) {
        const text = (a.textContent || '').trim().toLowerCase();
        const aria = (a.getAttribute('aria-label') || a.getAttribute('title') || '').trim().toLowerCase();
        const classes = a.getAttribute('class') || '';
        if (/(?:^|\s)(?:next|next-page|nextpostslink|nav-next)(?:\s|$)/i.test(classes) ||
            /^(?:next(?: page)?|sonraki(?: sayfa)?|ileri|›|»|→)$/i.test(text) ||
            /^(?:next page|sonraki sayfa)$/i.test(aria)) {
          const url = usable(a); if (url) return url;
        }
      }
      let numberLinks = paginationLinks;
      if (marked?.parentElement) numberLinks = [...new Set([...numberLinks, ...marked.parentElement.querySelectorAll('a[href]')])];
      for (const a of numberLinks) if (a.textContent.trim() === String(current + 1)) { const url = usable(a, true, isStrongPaginationContext(a)); if (url) return url; }
      // Belirgin sayfalama kapsayıcısı yoksa aktif URL'si eşleşen sayısal kardeşler.
      for (const a of links) {
        const label = (a.textContent || '').trim();
        if (!/^\d+$/.test(label) || !a.parentElement) continue;
        const siblings = [...a.parentElement.querySelectorAll('a[href]')].filter(x => /^\d+$/.test(x.textContent.trim()));
        if (siblings.length < 2) continue;
        try {
          const u = new URL(a.getAttribute('href'), base); u.hash = '';
          if (u.href === currentUrl) for (const candidate of siblings) if (candidate.textContent.trim() === String(Number(label) + 1)) { const url = usable(candidate, true, true); if (url) return url; }
        } catch {}
      }
      return null;
    }
    return { buildUrl, srcsetUrl, imageUrl, documentBase, passesImageSourceHost, smartFitMode, htmlDimension, collect, nextByTemplate, pageOrdinal, nextPage };
  };
})(globalThis);
