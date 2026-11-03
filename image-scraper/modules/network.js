/* Page and image transport: fetch/GM bridge, retries, cancellation, and challenge checks. */
(function (global) {
  const modules = global.ImageScraperModules || (global.ImageScraperModules = Object.create(null));
  modules.createNetworkModule = function createNetworkModule(deps) {
    const { location, GM_xmlhttpRequest, checkAbort, abortError, isAbort, fetchImpl, DOMParserImpl } = deps;
    function isChallengeHTML(html) {
      return /<title>\s*just a moment\s*\.\.\./i.test(html) && /(?:\/cdn-cgi\/challenge-platform|cf_chl_|challenges\.cloudflare\.com)/i.test(html);
    }
    function pageGM(url, config, signal) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(abortError()); return; }
        let request, done = false;
        const finish = (err, value) => {
          if (done) return; done = true; signal.removeEventListener('abort', cancel);
          if (err) reject(err); else resolve(value);
        };
        const cancel = () => { try { request?.abort(); } catch {} finish(abortError()); };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          request = GM_xmlhttpRequest({
            method: 'GET', url, responseType: 'text', timeout: config.TIMEOUT_MS,
            anonymous: false, nocache: true, cookiePartition: { topLevelSite: location.origin },
            headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', Referer: location.origin + '/' },
            onload: r => {
              const challenge = /(?:^|\r?\n)cf-mitigated:\s*challenge/i.test(r.responseHeaders || '');
              if (r.status < 200 || r.status >= 300) return finish(Object.assign(new Error(`HTTP ${r.status || '?'}${challenge ? ' · Cloudflare doğrulaması gerekli' : ''}`), { status: r.status, challenge }));
              try {
                const finalUrl = new URL(r.finalUrl || url, url).href;
                if (new URL(finalUrl).origin !== location.origin) throw new Error('Sayfa farklı bir kaynağa yönlendirildi.');
                const type = /(?:^|\r?\n)content-type:\s*([^\r\n]+)/i.exec(r.responseHeaders || '')?.[1] || '';
                if (type && !/html|xhtml/i.test(type)) throw new Error('Yanıt bir HTML sayfası değil.');
                const html = typeof r.responseText === 'string' ? r.responseText : r.response;
                if (typeof html !== 'string' || !html.trim()) throw new Error('Sayfa yanıtı boş.');
                if (challenge || isChallengeHTML(html)) throw Object.assign(new Error('Cloudflare doğrulaması gerekli.'), { status: 403, challenge: true });
                finish(null, { doc: new DOMParserImpl().parseFromString(html, 'text/html'), url: finalUrl });
              } catch (e) { finish(e); }
            },
            onerror: () => finish(new Error('GM sayfa isteğinde ağ hatası')),
            ontimeout: () => finish(new Error('GM sayfa isteği zaman aşımına uğradı')),
            onabort: () => finish(abortError()),
          });
          if (signal.aborted) cancel();
        } catch (e) { finish(e); }
      });
    }
    async function fetchPage(url, config, signal) {
      checkAbort(signal);
      const controller = new AbortController();
      const cancel = () => controller.abort();
      signal.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, config.TIMEOUT_MS);
      let fallbackError;
      try {
        const res = await fetchImpl(url, { credentials: 'same-origin', signal: controller.signal });
        checkAbort(signal);
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
        if (new URL(res.url).origin !== location.origin) throw new Error('Sayfa farklı bir kaynağa yönlendirildi.');
        const type = res.headers.get('content-type') || '';
        if (type && !/html|xhtml/i.test(type)) throw new Error('Yanıt bir HTML sayfası değil.');
        const html = await res.text(); checkAbort(signal);
        if (res.headers.get('cf-mitigated') === 'challenge' || isChallengeHTML(html)) throw Object.assign(new Error('Cloudflare doğrulaması gerekli.'), { status: 403, challenge: true });
        return { doc: new DOMParserImpl().parseFromString(html, 'text/html'), url: res.url };
      } catch (e) {
        if (signal.aborted) throw abortError();
        if (controller.signal.aborted) fallbackError = new Error('Sayfa isteği zaman aşımına uğradı.');
        else fallbackError = e;
      } finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
      // Yalnızca 403, ağ veya zaman aşımında aynı kaynağa GM ile bir kez daha dene.
      // Tamamlanmamış doğrulamayı çözmez ve sunucu kuralları yine geçerlidir.
      if (fallbackError.status === 403 || !fallbackError.status && (fallbackError instanceof TypeError || /zaman aşımı/i.test(fallbackError.message))) {
        try { return await pageGM(url, config, signal); }
        catch (e) {
          if (isAbort(e)) throw e;
          if (e.status === 403) e.message += ' (normal istek ve Tampermonkey denemesi reddedildi)';
          throw e;
        }
      }
      throw fallbackError;
    }

    function gmBlob(url, timeout, signal, referer, partitionSite) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(abortError()); return; }
        let request, done = false;
        const finish = (err, value) => {
          if (done) return; done = true; signal.removeEventListener('abort', cancel);
          if (err) reject(err); else resolve(value);
        };
        const cancel = () => { try { request?.abort(); } catch {} finish(abortError()); };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          request = GM_xmlhttpRequest({
            method: 'GET', url, responseType: 'blob', timeout, anonymous: false, nocache: true,
            ...(partitionSite ? { cookiePartition: { topLevelSite: partitionSite } } : {}),
            // Eklentinin/tarayıcının cookie ve yönlendirme politikaları geçerlidir.
            headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8', ...(referer ? { Referer: referer } : {}) },
            onload: r => {
              if (r.status >= 200 && r.status < 300 && r.response instanceof Blob && r.response.size) {
                finish(null, r.response);
              } else {
                const challenge = /(?:^|\r?\n)cf-mitigated:\s*challenge/i.test(r.responseHeaders || '');
                const message = challenge ? `HTTP ${r.status}: Cloudflare doğrulaması gerekiyor` : `GM HTTP ${r.status || '?'} veya boş yanıt`;
                const retryMatch = /(?:^|\r?\n)retry-after:\s*([^\r\n]+)/i.exec(r.responseHeaders || '');
                const rawRetry = retryMatch && retryMatch[1].trim();
                const retryAfter = rawRetry ? (/^\d+$/.test(rawRetry) ? Number(rawRetry) * 1000 : Math.max(0, Date.parse(rawRetry) - Date.now())) : 0;
                finish(Object.assign(new Error(message), { status: r.status, challenge, retryAfter: Number.isFinite(retryAfter) ? retryAfter : 0 }));
              }
            },
            onerror: () => finish(Object.assign(new Error('GM ağ hatası'), { transient: true })),
            ontimeout: () => finish(Object.assign(new Error('GM zaman aşımı'), { transient: true })),
            onabort: () => finish(abortError()),
          });
          if (signal.aborted) cancel();
        } catch (e) { finish(e); }
      });
    }
    async function downloadImage(url, c, signal) {
      const same = new URL(url).origin === location.origin;
      if (same) {
        const controller = new AbortController(), cancel = () => controller.abort();
        signal.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(cancel, c.TIMEOUT_MS);
        try {
          checkAbort(signal);
          const response = await fetchImpl(url, { credentials: 'same-origin', signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          if (!blob.size) throw new Error('Boş yanıt');
          return { blob, method: 'same' };
        } catch (e) { if (signal.aborted) throw abortError(); console.warn('[Image Scraper] fetch başarısız; GM deneniyor:', url, e); }
        finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
      }
      // Referer kısıtlamalı bazı sunucular, eksik/yanlış Referer için 404 döndürür.
      // Denemeler yalnızca 403/404'te yapılır. Header desteği eklentiye bağlıdır.
      const referers = [null];
      if (c.RETRY_REFERER) {
        referers.push(location.origin + '/', new URL(url).origin + '/');
      }
      let lastError;
      for (const referer of [...new Set(referers)]) {
        checkAbort(signal);
        try { return { blob: await gmBlob(url, c.TIMEOUT_MS, signal, referer), method: 'gm' }; }
        catch (e) {
          if (isAbort(e)) throw e;
          lastError = e;
          if (e.challenge) {
            // Kullanıcı hedef siteyi üst düzey sekmede doğruladıysa, desteklenen
            // Tampermonkey sürümlerinde o sitenin çerez bölümünü deneyebiliriz.
            // Doğrulamayı çözmez; tarayıcı/site politikaları buna izin vermeyebilir.
            const targetOrigin = new URL(url).origin;
            try {
              return { blob: await gmBlob(url, c.TIMEOUT_MS, signal, targetOrigin + '/', targetOrigin), method: 'gm' };
            } catch (partitionError) {
              if (isAbort(partitionError)) throw partitionError;
              lastError = partitionError;
              if (partitionError.challenge || partitionError.status === 403) {
                lastError.challenge = true;
                lastError.message = 'HTTP 403: Doğrulama gerekli veya doğrulanmış oturum bu istekle paylaşılamıyor';
              }
            }
            break;
          }
          if (e.status !== 403 && e.status !== 404) break;
        }
      }
      throw lastError;
    }
    async function downloadImageRetry(url, config, signal) {
      for (let attempt = 0; ; attempt++) {
        try { return await downloadImage(url, config, signal); }
        catch (e) {
          if (isAbort(e)) throw e;
          if (attempt >= 2 || e.challenge || !(e.transient || e.status === 429 || e.status >= 500)) throw e;
          if (e.retryAfter > 30000) throw Object.assign(new Error(`Sunucu ${Math.ceil(e.retryAfter / 1000)} saniye beklenmesini istiyor; daha sonra tekrar deneyin.`), { status: e.status });
          const delay = Math.min(30000, Math.max(e.retryAfter || 0, 700 * 2 ** attempt + Math.random() * 250));
          await new Promise((resolve, reject) => {
            if (signal.aborted) { reject(abortError()); return; }
            const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, delay);
            const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(abortError()); };
            signal.addEventListener('abort', cancel, { once: true });
          });
        }
      }
    }
    // İçerik türü yanıltıcı olabilir; sık kullanılan formatların imzalarını kontrol et.
    return { isChallengeHTML, pageGM, fetchPage, gmBlob, downloadImage, downloadImageRetry };
  };
})(globalThis);
