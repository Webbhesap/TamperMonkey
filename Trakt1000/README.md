# Trakt1000

Trakt'ın 2026 ücretsiz hesap limitleri (**tüm kişisel listelerde toplam 1.000 öğe**,
**5 statik + 3 dinamik liste**, liste başına 250 öğe) için çözüm çalışmaları.
Bu klasör ana depodaki `image-scraper` projesinden bağımsızdır.

## Durum

| Konu | Durum |
|---|---|
| Sorun | 18 liste var; toplam öğe sınırı 1.000 olduğu için listelere yeni öğe **eklenemiyor** |
| Doküman | `imdb-tasima-rehberi.md` — Trakt → IMDb taşıma adımları, antoloji tuzağı, Watched sınırları |
| Betik (IMDb tarafı) | **Yazıldı:** `imdb-watched-marker/` — Trakt geçmişini IMDb "Watched"a puansız/check-in'siz toplu çevirir |
| Betik (Trakt tarafı) | **Yazılmadı** — Trakt listelerine/akıllı listelere dokunan bir betik talebi yok |
| Dal | `arena/6834ba5b-tampermonkey` — `main`'e **merge edilmedi** |

## Klasör içeriği

| Yol | Ne |
|---|---|
| `imdb-tasima-rehberi.md` | Ana rehber (§0 yedek, §1 `tt` çıkarma, §2–4 IMDb listesi kurma/doğrulama, §5 taşınamayanlar + antoloji tuzağı, §5b Watched, §5c 12.000 üstü geçmiş, §6 karşılaştırma, §7 Trakt'ta kalma) |
| `imdb-watched-marker/imdb-watched-marker.user.js` | Tek dosyalık userscript: `addWatchedTitle` ile toplu Watched |
| `imdb-watched-marker/README.md` | Kurulum, kullanım, yakalama modu, sorun giderme, risk notları |
| `imdb-watched-marker/tests/parse.test.mjs` | 22 test (`node --test`) — ayrıştırıcı, filtreler, hazır filtre ön ayarları, CSV/hata yardımcıları |
| `imdb-userscript-onerileri.md` | Greasy Fork taraması (16 Kasım 2026): işe yarayan IMDb betikleri, tamamlayıcılar, tuzaklar ve minimum set |

## Bulgular (doğrulanmış)

- Limit **sunucu tarafında**: ekleme reddi `HTTP 420` + `X-Account-Limit` başlığı ve
  `total_list_item_limit_reached` / `list_item_limit_reached` hata kodlarıyla dönüyor.
  Bir userscript bunu aşamaz; yalnızca veri yönetebilir.
- Gerçek kullanım `GET https://api.trakt.tv/v3/users/me/usage` ucundan okunabiliyor
  (`static_lists`, `dynamic_lists`, `total_list_items`, ... → `current` / `free` / `vip`).
- **Dinamik (akıllı) listeler ayrı bir limit kovasında**: ücretsiz hesapta 3 adet ve
  filtre tabanlı oldukları için öğeleri 1.000'lük toplam sayaca girmiyor. Site içindeki
  en güçlü kaldıraç bu.
- `app.trakt.tv` OAuth token'ını `localStorage`'da tutuyor
  (`oidc.user:https://auth.trakt.tv:<client_id>` anahtarı) → ileride bir userscript
  yazılırsa ayrı API uygulaması kurmadan, mevcut oturumla API'ye erişebilir.
- Ücretsiz tam dışa aktarım: `app.trakt.tv/settings/data` → ZIP (JSON). Liste başına
  CSV indirme yeni sitede yok.
- **IMDb'de içe aktarma özelliği yok** (resmî yanıt); taşıma ancak üçüncü parti
  userscript ile yapılır. IMDb: 999 liste, liste başına 12.000 öğe, gizli liste var.
- **12.000 tavanı `Watchlist` / `Lists` / `Check-ins` üçlüsüne ait** (Lists FAQ,
  9 Temmuz 2026). **Watched** / `Your watch history` için belgelenmiş bir tavan yok.
- IMDb'de **bölüm düzeyinde** Watched var, **sezon toplu işaretleme yok**, izlenme
  **tarihi geriye dönük yazılamıyor** (Watched FAQ, 28 Ocak 2026).
- Watched'a toplu yazan **hazır araç yok**: IMDb'nin kendi aracı yok (Eylül 2025 isteği
  yanıtsız), Greasy Fork'taki "mark as watched" betikleri ya işareti yalnızca tarayıcıda
  tutuyor (#583777) ya da sadece okuyor (#581029), IMDB-Trakt-Syncer ise **check-in**
  yazdığı için 12.000'de tıkanıyor.
- Yazılabilir yol doğrulandı: IMDb'nin düğmesi `api.graphql.imdb.com` üzerinde
  `mutation AddWatchedTitle($titleId: ID!) { addWatchedTitle(titleId: $titleId) { success } }`
  çağırıyor; aynı mutation'ı kullanan yayında, MIT lisanslı bir betik daha var
  (`Juwan-Hwang/douban2imdb`, Greasy Fork #596763). Resmî olmayan iç API → imza
  değişebilir, bu yüzden betikte **yakalama modu** var.

## Olası sonraki adımlar (henüz yapılmadı)

1. Trakt içinde çözüm: dinamik listeye çevirme + izlenmiş/tekrar/bayat öğe temizliği.
2. Yerel taşma (gölge) listeleri: sınırı aşan öğeler tarayıcıda tutulur, arayüze enjekte
   edilir, yer açılınca sunucuya yükseltilir.
3. Taşıma: IMDb / MDBList / Plex / Simkl / Letterboxd dışa aktarma üreticileri.
