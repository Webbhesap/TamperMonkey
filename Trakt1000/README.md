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
| Betik (iki yön köprüsü) | **Yazıldı:** `imdb-trakt-bridge/` — Trakt'tan **canlı** okur (kendi oturumun, bağlı uygulama slotu harcamaz), IMDb'ye liste/watchlist/izlendi/puan yazar |
| Betik (Trakt tarafı) | **Yazılmadı** — Trakt listelerine *yazan* bir betik gereksiz: IMDb → Trakt yönünü Trakt'ın kendi içe aktarıcısı tarih koruyarak yapıyor |
| Dal | `arena/6834ba5b-tampermonkey` — `main`'e **merge edilmedi** |

## Klasör içeriği

| Yol | Ne |
|---|---|
| `imdb-tasima-rehberi.md` | Ana rehber (§0 yedek, §1 `tt` çıkarma, §2–4 IMDb listesi kurma/doğrulama, §5 taşınamayanlar + antoloji tuzağı, §5b Watched, §5c 12.000 üstü geçmiş, §6 karşılaştırma, §7 Trakt'ta kalma) |
| `imdb-watched-marker/imdb-watched-marker.user.js` | Tek dosyalık userscript: `addWatchedTitle` ile toplu Watched |
| `imdb-watched-marker/README.md` | Kurulum, kullanım, yakalama modu, sorun giderme, risk notları |
| `imdb-watched-marker/tests/parse.test.mjs` | 22 test (`node --test`) — ayrıştırıcı, filtreler, hazır filtre ön ayarları, CSV/hata yardımcıları |
| `imdb-userscript-onerileri.md` | Greasy Fork taraması (16 Kasım 2026): işe yarayan IMDb betikleri, tamamlayıcılar, tuzaklar ve minimum set |
| `imdb-trakt-bridge/imdb-trakt-bridge.user.js` | İki sayfalı userscript (v0.1.1): `app.trakt.tv`'de canlı okuma + `imdb.com`'da dört hedefe yazma; panel sağ alt köşeye sabitlenir |
| `imdb-trakt-bridge/README.md` | Akış şeması, uç tablosu, doğrulama kaynakları, sınırlar, marker ile karşılaştırma |
| `imdb-trakt-bridge/tests/bridge.test.mjs` | 38 test (`node --test`) — token çıkarma, Trakt yolları/kapasite, kayıt→satır dönüşümü, GraphQL gövdeleri, yazma origin'i uyarısı, CSV |

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
- **IMDb'ye "uygulama bağlanamaz":** IMDb'nin kullanıcı verisi için OAuth'u/API'si yok
  (resmî API yalnız B2B title/name metadata; Login with Amazon yalnız profil verisi verir;
  Amazon Data Portability'de IMDb ratings kapsamı yok; IMDb'de Trakt'taki gibi bir
  *connected apps* kavramı hiç yok). Tek yazma yolu `imdb.com` origin'inden, senin
  oturumunla `api.graphql.imdb.com` + `www.imdb.com` REST uçlarıdır.
- **Watchlist GraphQL değil, düz REST:** `PUT https://www.imdb.com/watchlist/tt…`
  (`Letterboxd-to-IMDb` · `add_to_imdb_watchlist`). Çıkarma (`DELETE`) hiçbir kaynakta
  doğrulanmadı.
- Liste/puan mutation gövdeleri kaynak koddan doğrulandı:
  `createList(input:{name,listDescription,allowDuplicates:false,listType:"TITLES",visibility:"PRIVATE"}) { listId }`,
  `addItemToList(input:{listId,item:{itemElementId}}) { listId }`,
  `rateTitle(input:{rating,titleId}) { rating{value} }`.
- **IMDb → Trakt yönü resmî ve tarih koruyor:** Trakt'ın kendi içe aktarıcısı
  (`trakt/trakt-web` · `settings/import`) kaynak olarak `imdb | letterboxd | tvtime |
  trakt-json | trakt-csv`, eylem olarak `history | watchlist | ratings | list | favorites`
  destekliyor. `ImdbParser.ts` puan satırından **hem** `ratings` (rating + `rated_at`)
  **hem** `history` (`watched_at = Date Rated`) üretiyor; `tvepisode → episode`
  eşlemesi ve `EpisodeMatchMode: 'id' | 'positional'` var. Yani IMDb'de tarih yazılamazken
  bu yönde tarihler korunuyor.
- Aynı parser'ın sınırı: IMDb CSV'lerinden yalnız **ratings** (`Your Rating` kolonu varsa)
  ve **watchlist** biçimini tanıyor → **IMDb özel listeleri ve check-ins içe aktarılamıyor**.
- `GET /users/me/usage` kovası `{current, free, vip}` üçlüsüyle dönüyor
  (`requests/models/UserLimits.ts` · `LimitsSchema`), kovalar: `history, ratings,
  watchlist_items, total_list_items, static_lists, dynamic_lists, digital_library,
  total_notes, connected_apps`.

## Olası sonraki adımlar (henüz yapılmadı)

1. Trakt içinde çözüm: dinamik listeye çevirme + izlenmiş/tekrar/bayat öğe temizliği.
2. Yerel taşma (gölge) listeleri: sınırı aşan öğeler tarayıcıda tutulur, arayüze enjekte
   edilir, yer açılınca sunucuya yükseltilir.
3. Taşıma: IMDb / MDBList / Plex / Simkl / Letterboxd dışa aktarma üreticileri.
   **Kısmen yapıldı:** `imdb-trakt-bridge/` IMDb'ye canlı yazıyor (liste, watchlist,
   izlendi, puan); MDBList/Plex/Simkl üreticileri hâlâ yok.
4. Köprüde eksik kalanlar: watchlist'ten çıkarma (`DELETE` ucu doğrulanmadı), Trakt
   `/sync/watched/episodes` davranışının gerçek hesapta sınanması, IMDb listelerinin
   sunucu tarafında okunup yinelemelerin yazmadan önce elenmesi.
