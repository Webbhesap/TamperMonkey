# Image Scraper — henüz uygulanmamış özellik önerileri

**Bu dosyada yalnızca HENÜZ YAPILMAMIŞ fikirler bulunur.**
Tamamlanan özellikler ayrı dosyadadır: [`tamamlanmis-ozellikler.md`](tamamlanmis-ozellikler.md).

Kural: bir madde uygulandığında bu dosyadan **çıkarılır** ve
`tamamlanmis-ozellikler.md` içine tarih + nasıl yapıldığı bilgisiyle eklenir.
Böylece burada kalan her madde gerçekten "yapılacak iş" listesidir.

> Son gözden geçirme: 2026-11-03. Derin tarama sayaçları, güvenli devam
> kaydı, içerik bağlantısı puanlaması, içerik sayfalama sınırı ve içerik bazlı
> tarama özeti uygulandı; maddeler bu dosyadan çıkarıldı.

---

## Yüksek öncelik

- **Tarayıcı ve Tampermonkey uyumluluk matrisi:** File System Access,
  Fullscreen, `createImageBitmap`, GM istekleri ve `@require` önbellek
  davranışını Chromium/Firefox × Tampermonkey/Violentmonkey için ayrı ayrı
  test edip destek durumunu arayüzde göster. *(Chromium tarafı otomatik
  testlerle kapsanıyor; Firefox canlı doğrulaması hâlâ yok.)*

## Orta öncelik

- **Arayüz erişilebilirlik kontrolü:** Odak halkası, ekran okuyucu metni,
  klavye dolaşımı ve yüksek karşıtlığı düzenli doğrula. *(Temel altyapı var:
  `role="dialog"`, `aria-modal`, odak tuzağı, ok tuşu gezinmesi, `aria-live`,
  `prefers-reduced-motion`, `prefers-contrast`. Otomatik erişilebilirlik
  ağacı/ekran okuyucu testi hâlâ yok.)*
- **Büyük oturumlarda arayüz performans ölçümü:** Sanallaştırılmış galeri,
  sonuç güncelleme ve oturum kaydetmeyi binlerce görselde ölç; uzun ana iş
  parçacığı görevlerini azalt ve ölçümleri regresyon testine bağla.
  *(5.200 görsel için tarama süresi ve sanallaştırma regresyon testi var.)*

## Yeni özellikler

- **Hiyerarşik kategori → içerik → sayfa önizlemesi:** Taramadan önce
  kategorileri, makaleleri ve alt sayfaları ağaç görünümünde listele;
  makale/sayfa seçimi ve içerik başına sayfa sınırı sun.
- **Konu bazlı tarama ve koleksiyon:** İçerik başlığını konu kabul edip konu
  başına görsel sayısını göster; seçilen konuları ayrı koleksiyon/ZIP yap.
- **İçerik kartı seçici yardımcısı:** Sayfadaki olası makale kartlarını
  işaretle; kullanıcı bir örnek seçsin, betik CSS seçicisini üretsin.
- **İçerik bazlı yeniden deneme:** İçerik tarama özeti artık hazır (URL,
  başlık, alt sayfa, benzersiz görsel, atlanan tekrar). Kalan iş: özet
  satırından tek bir içeriği yeniden tarayıp sonuçları mevcut oturuma
  birleştirme (başarısız içerikleri tek tek dene).
- **Benzer görselleri ZIP öncesi gözden geçirme:** Algısal benzerlik
  gruplarını yan yana göster, kullanıcı tutulacakları seçsin. Otomatik silme
  varsayılan olmasın.
- **Kaynak sayfaya göre gruplama ve ayrı ZIP:** Sayfa/alan adı/format bazında
  *seçim* hazır (çekmecedeki toplu seçim). Kalan iş: galeride bu ölçütlere göre
  gruplanmış bölüm başlıkları ve tek grubu ayrı ZIP'e çıkarma.
- **Yan yana görsel karşılaştırıcı:** İki görseli eş zamanlı yakınlaştırma ve
  kaydırmayla karşılaştır; benzer gruplarda en iyi kopyayı seçmeye yardımcı olur.
- **Kalıcı favoriler ve koleksiyonlar:** Görselleri oturumlar arasında
  favorile veya adlandırılmış koleksiyonlara ekle; depolama ve gizlilik
  etkisini açıkça göster.
- **İsteğe bağlı format dönüştürme:** Seçili görselleri ZIP'e eklemeden önce
  JPEG/PNG/WebP'ye dönüştürme ve kalite ayarı; orijinalleri koruma seçeneği;
  dönüşüm tarayıcıda yerel yapılsın.
