/* Image signature detection and perceptual similarity helpers. */
(function (global) {
  const modules = global.ImageScraperModules || (global.ImageScraperModules = Object.create(null));
  modules.createImageAnalysisModule = function createImageAnalysisModule(deps) {
    // Bağımlılık sözleşmesi: eksik bağımlılık ilk kullanımda değil, modül
    // kurulurken anlaşılır bir hatayla bildirilir (geç ReferenceError yerine).
    const requireDeps = (label, names) => {
      const missing = names.filter(name => deps?.[name] === undefined);
      if (missing.length) throw new Error(`${label} modülü için eksik bağımlılık: ${missing.join(', ')}`);
    };
    requireDeps('Görsel analizi', ['document', 'Blob']);
    const { document, Blob, createImageBitmapImpl } = deps;
    async function imageFormat(blob) {
      const b = new Uint8Array(await blob.slice(0, 512).arrayBuffer());
      const ascii = (start, end) => String.fromCharCode(...b.slice(start, end));
      if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
      if (b.length >= 8 && [137,80,78,71,13,10,26,10].every((x, i) => b[i] === x)) return 'png';
      if (/^GIF8[79]a$/.test(ascii(0, 6))) return 'gif';
      if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
      if (ascii(0, 2) === 'BM') return 'bmp';
      if ((ascii(0, 4) === 'II*\x00') || (ascii(0, 4) === 'MM\x00*')) return 'tif';
      if (ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 64))) return 'avif';
      if (ascii(4, 8) === 'ftyp' && /heic|heix|hevc|mif1/.test(ascii(8, 64))) return 'heic';
      // SVG imzası: XML bildirimi/yorumları öncesinde bulunabilir; HTML yanıtı olmasın.
      const text = new TextDecoder().decode(b).replace(/^\uFEFF/, '').trimStart();
      if (!/^<!doctype\s+html|^<html\b/i.test(text) && /<svg(?:\s|>)/i.test(text) && (/^image\/svg\+xml/i.test(blob.type) || /^(?:<\?xml\b|<svg\b)/i.test(text))) return 'svg';
      return null;
    }
    async function perceptualHash(buffer) {
      if (typeof createImageBitmapImpl !== 'function') return null;
      let bitmap;
      try {
        bitmap = await createImageBitmapImpl(new Blob([buffer]));
        const canvas = document.createElement('canvas'); canvas.width = 9; canvas.height = 8;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return null;
        ctx.drawImage(bitmap, 0, 0, 9, 8);
        const pixels = ctx.getImageData(0, 0, 9, 8).data;
        const gray = (x,y) => { const i=(y*9+x)*4; return .299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2]; };
        let hash = 0n;
        for (let y=0;y<8;y++) for (let x=0;x<8;x++) hash = (hash << 1n) | (gray(x,y) > gray(x+1,y) ? 1n : 0n);
        return hash.toString(16).padStart(16,'0');
      } catch { return null; }
      finally { bitmap?.close(); }
    }
    function hashDistance(a,b) {
      let value = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), bits = 0;
      while (value) { bits += Number(value & 1n); value >>= 1n; }
      return bits;
    }
    return { imageFormat, perceptualHash, hashDistance };
  };
})(globalThis);
