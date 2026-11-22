// Lectores de ofertas por tienda. Cada uno devuelve una lista de juegos normalizados:
// { id, tienda, id_tienda, titulo, url, imagen, plataformas[], precio, original, moneda, descuento, gratis, fin_oferta, extra }
// Los "parse*" son funciones puras (reciben texto/JSON) para poder probarlas sin red.
import { esperar, log } from "../lib/util.mjs";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const num = (s) => { const n = parseFloat(String(s ?? "").replace(/[^\d.,]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
const entidades = (s = "") => s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function pedir(url, opciones = {}, intentos = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { ...opciones, headers: { "user-agent": UA, "accept-language": "es-AR,es;q=0.9", ...(opciones.headers || {}) }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
      return r;
    } catch (err) {
      if (i >= intentos) throw err;
      await esperar(2000 * i);
    }
  }
}

// ---------- Steam (precios regionales de Argentina, en USD) ----------
export function parseSteam(html) {
  const out = [];
  for (const fila of html.split(/<a href="/).slice(1)) {
    const url = (fila.match(/^([^"]+)"/) || [])[1];
    const appid = (fila.match(/data-ds-appid="(\d+)"/) || [])[1];
    if (!url || !appid || /data-ds-bundleid|data-ds-packageid/.test(fila)) continue; // solo juegos sueltos
    const titulo = entidades((fila.match(/<span class="title">([\s\S]*?)<\/span>/) || [])[1] || "").trim();
    const descuento = +((fila.match(/data-discount="(\d+)"/) || [])[1] || 0);
    const final = (fila.match(/data-price-final="(\d+)"/) || [])[1];
    const original = num((fila.match(/discount_original_price">([^<]+)</) || [])[1]);
    if (!titulo || final == null || !descuento) continue;
    const precio = +final / 100;
    if (precio === 0 && descuento < 100) continue; // dato inconsistente de la tienda
    const resenas = (fila.match(/search_review_summary (\w+)/) || [])[1] || null;
    out.push({
      id: `steam:${appid}`, tienda: "steam", id_tienda: appid, titulo,
      url: url.split("?")[0], imagen: `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`,
      imagen2: (fila.match(/search_capsule"><img src="([^"]+)"/) || [])[1] || null,
      plataformas: ["PC"], precio, original: original ?? precio, moneda: "USD", descuento, gratis: precio === 0, fin_oferta: null,
      extra: resenas ? { resenas } : {},
    });
    const ult = out[out.length - 1]; if (ult.imagen2) ult.extra.img2 = ult.imagen2; delete ult.imagen2;
  }
  return out;
}
export async function leerSteam({ paginas = 4 } = {}) {
  const todos = new Map();
  for (let p = 0; p < paginas; p++) {
    const url = `https://store.steampowered.com/search/results/?specials=1&infinite=1&cc=ar&l=spanish&category1=998&filter=topsellers&count=100&start=${p * 100}`;
    const j = await (await pedir(url)).json();
    for (const g of parseSteam(j.results_html || "")) if (!todos.has(g.id)) todos.set(g.id, g);
    if ((p + 1) * 100 >= (j.total_count || 0)) break;
    await esperar(1500);
  }
  return [...todos.values()];
}

// ---------- Epic: juegos gratis (feed oficial) + descuentos (CheapShark) ----------
export function parseEpicGratis(json) {
  const out = [];
  for (const e of json?.data?.Catalog?.searchStore?.elements || []) {
    const ahora = e.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
    const prox = e.promotions?.upcomingPromotionalOffers?.[0]?.promotionalOffers?.[0];
    const p = e.price?.totalPrice;
    const promo = ahora && p && p.discountPrice === 0 && p.originalPrice > 0 ? ahora : null;
    const futura = !promo && prox && prox.discountSetting?.discountPercentage === 0 ? prox : null;
    if (!promo && !futura) continue;
    const slug = e.offerMappings?.[0]?.pageSlug || e.catalogNs?.mappings?.[0]?.pageSlug || (e.productSlug || "").replace(/\/home$/, "");
    if (!slug) continue;
    const img = (e.keyImages || []).find((k) => k.type === "OfferImageWide") || (e.keyImages || []).find((k) => k.type === "Thumbnail") || e.keyImages?.[0];
    const dec = 10 ** (p?.currencyInfo?.decimals ?? 2);
    out.push({
      id: `epic:${e.id}`, tienda: "epic", id_tienda: e.id, titulo: e.title,
      url: `https://store.epicgames.com/es-ES/p/${slug}`, imagen: img?.url || null, plataformas: ["PC"],
      precio: 0, original: p ? p.originalPrice / dec : null, moneda: p?.currencyCode || "USD", descuento: 100, gratis: true,
      fin_oferta: (promo || futura).endDate,
      extra: futura ? { proximamente: true, desde: futura.startDate } : { desde: promo.startDate },
    });
  }
  return out;
}
export function parseCheapShark(lista, tienda = "epic") {
  return (lista || []).filter((d) => +d.savings >= 5 && +d.salePrice > 0).map((d) => ({
    id: `${tienda}:cs${d.gameID}`, tienda, id_tienda: `cs${d.gameID}`, titulo: d.title,
    // Enlace directo a la tienda de Epic (búsqueda por nombre), sin pasar por la redirección de CheapShark
    url: `https://store.epicgames.com/es-ES/browse?q=${encodeURIComponent(d.title)}&sortBy=relevancy&sortDir=DESC&count=40`, imagen: d.steamAppID ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${d.steamAppID}/header.jpg` : d.thumb,
    plataformas: ["PC"], precio: +d.salePrice, original: +d.normalPrice, moneda: "USD", descuento: Math.round(+d.savings), gratis: false, fin_oferta: null,
    extra: { metacritic: +d.metacriticScore || undefined, via: "CheapShark" },
  }));
}
export async function leerEpic({ paginas = 3 } = {}) {
  const gratis = parseEpicGratis(await (await pedir("https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=es-ES&country=AR&allowCountries=AR")).json());
  const desc = [];
  try {
    for (let p = 0; p < paginas; p++) {
      const r = await fetch(`https://www.cheapshark.com/api/1.0/deals?storeID=25&onSale=1&sortBy=Deal%20Rating&pageSize=60${p ? `&pageNumber=${p}` : ""}`,
        { headers: { "user-agent": "BolsilloGamer/1.0 (+https://juegos.bolsillo.online)" }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 150)}`);
      const lista = await r.json();
      desc.push(...parseCheapShark(lista));
      if (lista.length < 60) break;
      await esperar(1500);
    }
  } catch (err) { log("Epic (descuentos vía CheapShark):", err.message); if (!desc.length && !gratis.length) throw err; }
  const titulos = new Set(gratis.map((g) => g.titulo.toLowerCase()));
  return [...gratis, ...desc.filter((d) => !titulos.has(d.titulo.toLowerCase()))];
}

// ---------- Xbox (tienda Argentina, precios en ARS) ----------
const PLAT_XBOX = { XboxSeriesX: "Xbox Series X|S", XboxOne: "Xbox One", PC: "PC" };
const fechaXbox = (s) => { const m = String(s || "").match(/^(\d\d)\/(\d\d)\/(\d{4}) (\d\d:\d\d:\d\d)/); return m ? `${m[3]}-${m[1]}-${m[2]}T${m[4]}Z` : null; };
const slugXbox = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "juego";
export function parseXbox(html) {
  const m = html.match(/window\.__PRELOADED_STATE__ = (\{.*?\});\s*\n/s);
  if (!m) throw new Error("Xbox: no se encontró el estado de la página");
  const prods = JSON.parse(m[1])?.core2?.products?.productSummaries || {};
  const out = [];
  for (const p of Object.values(prods)) {
    const pr = p.specificPrices?.purchaseable?.[0];
    if (!pr || !(pr.discountPercentage > 0)) continue;
    const img = p.images?.boxArt?.url || p.images?.poster?.url || null;
    out.push({
      id: `xbox:${p.productId}`, tienda: "xbox", id_tienda: p.productId, titulo: p.title,
      url: `https://www.xbox.com/es-AR/games/store/${slugXbox(p.title)}/${p.productId}`, imagen: img ? `${img}?w=400` : null,
      plataformas: (p.availableOn || []).map((x) => PLAT_XBOX[x]).filter(Boolean),
      precio: pr.listPrice, original: pr.msrp, moneda: pr.currency || "ARS", descuento: Math.round(pr.discountPercentage),
      gratis: pr.listPrice === 0, fin_oferta: fechaXbox(pr.endDateUtc),
      extra: { gamePass: (p.includedWithPassesProductIds || []).length > 0 || undefined },
    });
  }
  return out;
}
export async function leerXbox() {
  const orden = ["", "?orderby=Title+Asc", "?orderby=Title+Desc", "?orderby=ReleaseDate+Desc", "?orderby=Price+Asc", "?orderby=Price+Desc", "?PlayWith=PC", "?PlayWith=XboxSeriesX%7CS"];
  const todos = new Map();
  for (const q of orden) {
    try {
      const html = await (await pedir(`https://www.xbox.com/es-AR/games/browse/DynamicChannel.GameDeals${q}`)).text();
      for (const g of parseXbox(html)) if (!todos.has(g.id)) todos.set(g.id, g);
    } catch (err) { log("Xbox:", err.message); }
    await esperar(2000);
  }
  if (!todos.size) throw new Error("Xbox: no se pudo leer ninguna página");
  return [...todos.values()];
}

// ---------- PlayStation (tienda Argentina, precios en USD; se lee la página ya dibujada) ----------
export function parsePsTile(t) {
  const meta = JSON.parse(t.meta || "{}");
  const pr = meta.price || {};
  if (!meta.id || pr.isTiedToSubscription) return null; // descuentos solo para PS Plus quedan afuera
  const precio = pr.isFree ? 0 : num(pr.discount), original = num(pr.base);
  if (precio == null || original == null || !(original > precio)) return null;
  return {
    id: `playstation:${meta.id}`, tienda: "playstation", id_tienda: meta.id, titulo: meta.name,
    url: `https://store.playstation.com/es-ar/product/${meta.id}`, imagen: t.img ? t.img.replace(/\?w=\d+.*$/, "?w=440") : null,
    plataformas: (t.tags || []).filter((x) => /^PS\d$/.test(x)), precio, original, moneda: "USD",
    descuento: Math.round((1 - precio / original) * 100), gratis: precio === 0, fin_oferta: null, extra: {},
  };
}
export async function leerPlayStation({ paginas = 10 } = {}) {
  let chromium;
  try { ({ chromium } = await import("playwright")); } catch { throw new Error("PlayStation: falta Playwright (se instala en GitHub Actions)"); }
  const nav = await chromium.launch();
  const todos = new Map();
  try {
    const pag = await nav.newPage({ userAgent: UA, locale: "es-AR" });
    for (let n = 1; n <= paginas; n++) {
      await pag.goto(`https://store.playstation.com/es-ar/category/3f772501-f6f8-49b7-abac-874a88ca4897/${n}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await pag.waitForSelector('[data-qa="ems-sdk-grid#productTile0"] a[data-telemetry-meta]', { timeout: 30000 });
      const tiles = await pag.$$eval('[data-qa^="ems-sdk-grid#productTile"]', (els) => els
        .filter((e) => /productTile\d+$/.test(e.dataset.qa) && e.querySelector("a[data-telemetry-meta]"))
        .map((e) => ({
          meta: e.querySelector("a[data-telemetry-meta]").getAttribute("data-telemetry-meta"),
          img: e.querySelector("img[src*='image.api.playstation.com']")?.getAttribute("src") || null,
          tags: [...e.querySelectorAll('[data-qa*="game-art#tag"]')].map((x) => x.textContent.trim()),
        })));
      let nuevos = 0;
      for (const t of tiles) { try { const g = parsePsTile(t); if (g && !todos.has(g.id)) { todos.set(g.id, g); nuevos++; } } catch {} }
      log(`PlayStation página ${n}: ${tiles.length} productos, ${nuevos} ofertas nuevas`);
      if (!tiles.length) break;
      await esperar(3000 + Math.random() * 3000);
    }
  } finally { await nav.close(); }
  if (!todos.size) throw new Error("PlayStation: no se leyó ninguna oferta");
  return [...todos.values()];
}

export const TIENDAS = { steam: leerSteam, epic: leerEpic, xbox: leerXbox, playstation: leerPlayStation };
