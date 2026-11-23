// Ficha de cada videojuego: datos reales del juego (descripción, géneros, desarrolladora, editora, fecha de
// lanzamiento, reseñas) para que cada página tenga información propia y no solo precios.
// Fuentes: la API pública de la tienda de Steam (appdetails) e IsThereAnyDeal (con ITAD_API_KEY).
// Nada se inventa: si una fuente no trae un dato, la ficha no lo muestra.
// Se guarda un archivo por juego en data/fichas/ (así cada cambio toca un archivo chico); cada juego se
// consulta una vez y se refresca cada 30 días.
// Por corrida se consulta un máximo de juegos nuevos para no saturar las APIs. Si algo falla, el sitio sigue igual.
import fs from "node:fs";
import { leerJSON, guardarJSON, ruta, log, decodificar } from "../lib/util.mjs";

const CARPETA = ruta("data", "fichas");
const VIEJO = ruta("data", "fichas.json"); // formato anterior: un solo archivo
const VERSION = 6; // subir cuando se agregan datos nuevos, para volver a consultar todo de a poco
const VIGENCIA_MS = 30 * 864e5;
const REINTENTO_MS = 3 * 864e5; // si no se encontró nada, se vuelve a probar a los 3 días
const MAX_POR_CORRIDA = 150;
const ITAD = "https://api.isthereanydeal.com";
const UA = "BolsilloGamer/1.0 (+https://juegos.bolsillo.online/contacto/)";

// Clave del juego a partir del título: une el mismo juego de distintas tiendas, pero no mezcla ediciones
// distintas (Deluxe, Ultimate, etc. quedan separadas). Solo saca marcas, la plataforma y "edición estándar".
export function claveJuego(titulo) {
  return String(titulo || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[™®©]/g, "")
    .replace(/[’']/g, "")
    .replace(/\s*[(\[]\s*(ps4|ps5|pc|xbox[^)\]]*|ps4\s*(&|y|and|\/)\s*ps5|ps5\s*(&|y|and|\/)\s*ps4)\s*[)\]]/g, " ")
    .replace(/\s+(para|for)\s+(ps4|ps5|xbox|pc|windows)\b.*$/g, " ")
    .replace(/\s+-?\s*(ps4|ps5)(\s*(&|y|and|\/)\s*(ps4|ps5))?\s*$/g, " ")
    .replace(/\b(edicion estandar|standard edition|edicion standard)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const pedir = async (url, opciones = {}) => {
  const r = await fetch(url, { ...opciones, headers: { "User-Agent": UA, ...(opciones.headers || {}) }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url.split("?")[0]}`);
  return r.json();
};
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const sinHtml = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// HTML de Steam -> bloques de texto plano [tipo, texto] (nunca se publica HTML ajeno tal cual)
export function bloques(html, max = 5000) {
  const out = [];
  let total = 0;
  const partes = String(html || "")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, "\n\u0001h$2\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\n\u0001l$1\n")
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, "\n").replace(/<\/?(p|ul|ol|div)[^>]*>/gi, "\n").replace(/<br\s*\/?>/gi, "\n")
    .split("\n");
  for (const raw of partes) {
    const tipo = raw.startsWith("\u0001h") ? "h" : raw.startsWith("\u0001l") ? "li" : "p";
    const x = decodificar(raw.replace(/^\u0001[hl]/, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!x || x.length < 2) continue;
    if (total + x.length > max) break;
    total += x.length;
    out.push([tipo, x]);
  }
  return out;
}
export const requisitos = (html) => {
  const items = [...String(html || "").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((m) => decodificar(m[1].replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((t) => { const k = t.indexOf(":"); return k > 0 && k < 40 ? [t.slice(0, k).trim(), t.slice(k + 1).trim()] : ["", t]; })
    .filter(([, v]) => v);
  return items.length ? items.slice(0, 12) : null;
};
export const idiomas = (html) => {
  const [lista] = String(html || "").split(/<br\s*\/?>/i);
  const out = lista.split(",").map((x) => ({ nombre: decodificar(x.replace(/<[^>]+>/g, "").replace(/\*/g, "")).trim(), voces: /\*/.test(x) }))
    .filter((x) => x.nombre && x.nombre.length < 40);
  return out.length ? out : null;
};

async function steamDetalle(appid) {
  const d = await pedir(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=spanish&cc=ar`);
  const x = d?.[appid];
  if (!x?.success || !x.data) return null;
  const a = x.data;
  const req = a.pc_requirements && !Array.isArray(a.pc_requirements)
    ? { minimo: requisitos(a.pc_requirements.minimum), recomendado: requisitos(a.pc_requirements.recommended) } : null;
  return {
    tipo: a.type || null,
    nombreSteam: a.name || null,
    descripcion: sinHtml(a.short_description) || null,
    acerca: bloques(a.about_the_game),
    generos: (a.genres || []).map((g) => g.description).filter(Boolean),
    caracteristicas: (a.categories || []).map((c) => c.description).filter(Boolean).slice(0, 14),
    idiomas: idiomas(a.supported_languages),
    requisitos: req && (req.minimo || req.recomendado) ? req : null,
    capturas: (a.screenshots || []).slice(0, 8).map((c) => ({ chica: c.path_thumbnail, grande: c.path_full })).filter((c) => c.chica && c.grande),
    desarrolladores: a.developers || [],
    editores: a.publishers || [],
    lanzamientoTexto: a.release_date?.coming_soon ? null : a.release_date?.date || null,
    metacritic: a.metacritic?.score ? { puntaje: a.metacritic.score, url: a.metacritic.url || null } : null,
    web: /^https?:\/\//.test(a.website || "") ? a.website : null,
    juegoBase: a.type === "dlc" && a.fullgame?.appid ? { appid: String(a.fullgame.appid), nombre: a.fullgame.name || null } : null,
    dlcIds: (a.dlc || []).map(String),
    // Opciones de compra de la tienda (estándar, deluxe, etc.): cada una es un "paquete" de Steam
    paquetes: ((a.package_groups || []).find((g) => g.name === "default")?.subs || [])
      .filter((x) => x.packageid && !x.is_free_license).slice(0, 6)
      .map((x) => ({ packageid: String(x.packageid), texto: sinHtml(x.option_text) })),
    // Tráileres oficiales que la editora sube a Steam (archivos de video de Steam, no de YouTube)
    trailers: (a.movies || []).map((m) => ({ nombre: m.name || null, poster: m.thumbnail || null,
      mp4: m.mp4?.max || m.mp4?.["480"] || null, webm: m.webm?.max || m.webm?.["480"] || null }))
      .filter((m) => /^https:\/\//.test(m.mp4 || m.webm || "") && /^https:\/\//.test(m.poster || "")).slice(0, 3),
  };
}

// Nombre y precio actual en Argentina de varios productos de Steam a la vez (para la lista de DLC de un juego)
async function steamItems(appids) {
  if (!appids.length) return [];
  const input = { ids: appids.map((a) => ({ appid: +a })), context: { language: "spanish", country_code: "AR", steam_realm: 1 }, data_request: {} };
  const r = await pedir(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
  return (r?.response?.store_items || []).filter((x) => x.success === 1 && x.visible !== false && x.name && x.appid).map((x) => {
    const b = x.best_purchase_option || {};
    // Steam Argentina cobra en dólares: el precio se guarda como número en USD
    const usd = (c, txt) => c != null && !isNaN(+c) ? +c / 100 : txt && /\d/.test(txt) ? +txt.replace(/[^\d.,]/g, "").replace(",", ".") : null;
    return { appid: String(x.appid), nombre: x.name, gratis: !!x.is_free,
      usd: usd(b.final_price_in_cents, b.formatted_final_price), descuento: b.discount_pct || 0 };
  });
}

// Contenido exacto de un paquete de Steam (qué productos incluye) y su precio en Argentina
async function steamPaquete(id) {
  const r = await pedir(`https://store.steampowered.com/api/packagedetails?packageids=${id}&cc=ar&l=spanish`);
  const x = r?.[id];
  if (!x?.success || !x.data) return null;
  const d = x.data;
  return {
    packageid: String(id), nombre: d.name || null,
    apps: (d.apps || []).map((a) => ({ appid: String(a.id), nombre: a.name })),
    usd: d.price?.currency === "USD" ? d.price.final / 100 : null,
    antes: d.price?.currency === "USD" ? d.price.initial / 100 : null,
    descuento: d.price?.discount_percent || 0,
  };
}

// Ediciones de un juego con su contenido y el precio suelto de cada parte (para el comparador)
async function steamEdiciones(paquetes) {
  const ediciones = [];
  for (const p of paquetes) {
    try { const d = await steamPaquete(p.packageid); if (d?.apps.length) ediciones.push({ ...d, nombre: d.nombre || p.texto.replace(/\s*-\s*[^-]*\d[^-]*$/, "") }); }
    catch (err) { log(`Paquete Steam ${p.packageid}: ${err.message}`); }
    await pausa(1000);
  }
  if (ediciones.length < 2 && !(ediciones[0]?.apps.length > 1)) return null; // una sola opción de compra: no hay nada que comparar
  const ids = [...new Set(ediciones.flatMap((e) => e.apps.map((a) => a.appid)))].slice(0, 60);
  const sueltos = {};
  try { for (const it of await steamItems(ids)) sueltos[it.appid] = { usd: it.usd, gratis: it.gratis }; }
  catch (err) { log(`Precios sueltos Steam: ${err.message}`); }
  return { ediciones, sueltos };
}

// Resumen de reseñas de usuarios de Steam (todas las compras, todos los idiomas)
async function steamResenas(appid) {
  const r = await pedir(`https://store.steampowered.com/appreviews/${appid}?json=1&language=all&purchase_type=all&num_per_page=0`);
  const q = r?.query_summary;
  if (!r?.success || !q?.total_reviews) return null;
  return { texto: q.review_score_desc || null, positivas: q.total_positive, total: q.total_reviews };
}

async function itadInfo({ appid, titulo, clave }, key) {
  const q = appid ? `appid=${appid}` : `title=${encodeURIComponent(titulo)}`;
  const l = await pedir(`${ITAD}/games/lookup/v1?key=${encodeURIComponent(key)}&${q}`);
  if (!l?.found || !l.game?.id) return null;
  // Buscando por título, solo se acepta si es exactamente el mismo juego (misma clave)
  if (!appid && claveJuego(l.game.title) !== clave) return null;
  const i = await pedir(`${ITAD}/games/info/v2?key=${encodeURIComponent(key)}&id=${l.game.id}`);
  if (!i) return null;
  return {
    itad: l.game.id,
    appid: i.appid || null,
    lanzamiento: /^\d{4}-\d{2}-\d{2}/.test(i.releaseDate || "") ? i.releaseDate.slice(0, 10) : null,
    desarrolladores: (i.developers || []).map((x) => x.name).filter(Boolean),
    editores: (i.publishers || []).map((x) => x.name).filter(Boolean),
    etiquetas: (i.tags || []).slice(0, 8),
    resenas: (i.reviews || []).filter((r) => r.score != null).map((r) => ({ fuente: r.source, puntaje: r.score, cantidad: r.count ?? null, url: r.url || null })),
  };
}

let fallosResenas = 0;

// IGDB (de Twitch): videos oficiales de YouTube de cada juego. Solo si están las credenciales.
let igdbToken = null, igdbApagado = false;
async function igdb(endpoint, cuerpo) {
  const id = process.env.IGDB_CLIENT_ID, secreto = process.env.IGDB_CLIENT_SECRET;
  if (!id || !secreto || igdbApagado) return null;
  if (!igdbToken) {
    const t = await pedir(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secreto)}&grant_type=client_credentials`, { method: "POST" });
    igdbToken = t.access_token;
  }
  await pausa(300); // IGDB permite 4 consultas por segundo
  return pedir(`https://api.igdb.com/v4/${endpoint}`, { method: "POST", headers: { "Client-ID": id, Authorization: `Bearer ${igdbToken}`, "Content-Type": "text/plain" }, body: cuerpo });
}
async function igdbVideos({ appid, titulo, clave }) {
  let juego = null;
  if (appid) {
    const ext = await igdb("external_games", `fields game; where uid = "${appid}" & external_game_source = 1; limit 1;`).catch(() => null);
    if (ext?.[0]?.game) juego = ext[0].game;
  }
  if (!juego) {
    const q = String(titulo).replace(/["\\]/g, " ").replace(/[™®©]/g, "").slice(0, 80);
    const res = await igdb("games", `search "${q}"; fields name; limit 5;`) || [];
    juego = res.find((g) => claveJuego(g.name) === clave)?.id || null; // solo si es exactamente el mismo juego
  }
  if (!juego) return null;
  const v = await igdb("game_videos", `fields name, video_id; where game = ${juego}; limit 8;`) || [];
  const [g] = await igdb("games", `fields summary, first_release_date, genres.name, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, screenshots.image_id; where id = ${juego};`) || [];
  const comp = (rol) => (g?.involved_companies || []).filter((c) => c[rol] && c.company?.name).map((c) => c.company.name);
  const info = g ? {
    resumenEn: g.summary || null,
    lanzamiento: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
    generosEn: (g.genres || []).map((x) => x.name).filter(Boolean),
    desarrolladores: comp("developer"), editores: comp("publisher"),
    capturas: (g.screenshots || []).filter((x) => /^\w+$/.test(x.image_id || "")).slice(0, 8).map((x) => ({
      chica: `https://images.igdb.com/igdb/image/upload/t_screenshot_med/${x.image_id}.jpg`,
      grande: `https://images.igdb.com/igdb/image/upload/t_1080p/${x.image_id}.jpg` })),
  } : null;
  const videos = v.filter((x) => /^[\w-]{11}$/.test(x.video_id || "")).map((x) => ({ id: x.video_id, nombre: x.name || null }))
    // primero tráileres y gameplay
    .sort((a, b) => /trailer|gameplay/i.test(b.nombre || "") - /trailer|gameplay/i.test(a.nombre || "")).slice(0, 4);
  return { igdb: juego, videos, info };
}

// ---------- Xbox: catálogo público de Microsoft Store (el mismo que usa xbox.com) ----------
const XBOX_CAR = { XblOnlineMultiPlayer: "Multijugador en línea", XblLocalMultiPlayer: "Multijugador local", XblOnlineCoop: "Cooperativo en línea",
  XblLocalCoop: "Cooperativo local", XblCrossPlatformMultiPlayer: "Juego cruzado entre plataformas", XblAchievements: "Logros de Xbox",
  XblCloudSaves: "Guardado en la nube", SinglePlayer: "Un jugador", "4k": "4K Ultra HD", Hdr: "HDR10", XboxLive: "Xbox Network",
  RayTracing: "Trazado de rayos", "60fps": "60 FPS", "120fps": "120 FPS", SmartDelivery: "Entrega inteligente (Smart Delivery)", CapabilityXboxEnhanced: "Mejorado para Xbox Series X|S" };
async function xboxProductos(ids) {
  const r = await pedir(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${ids.map(encodeURIComponent).join(",")}&market=AR&languages=es-AR,es-MX,en-US`);
  return r?.Products || [];
}
const xboxPrecio = (p) => {
  const a = (p.DisplaySkuAvailabilities || []).flatMap((d) => d.Availabilities || []).find((x) => x.Actions?.includes("Purchase") && x.OrderManagementData?.Price);
  const pr = a?.OrderManagementData?.Price;
  return pr && pr.CurrencyCode === "ARS" ? { ars: pr.ListPrice, antes: pr.MSRP > pr.ListPrice ? pr.MSRP : null } : null;
};
async function xboxDetalle(id) {
  const [p] = await xboxProductos([id]);
  if (!p) return null;
  const L = p.LocalizedProperties?.[0] || {}, M = p.MarketProperties?.[0] || {};
  const parrafos = String(L.ProductDescription || "").split(/\r?\n+/).map((x) => x.trim()).filter((x) => x.length > 1);
  const uso = (M.UsageData || []).find((u) => u.AggregateTimeSpan === "AllTime");
  const rel = p.MarketProperties?.[0]?.RelatedProducts || [];
  const addons = rel.filter((x) => /AddOn/i.test(x.RelationshipType)).map((x) => x.RelatedProductId).slice(0, 20);
  let dlcLista = null;
  if (addons.length) {
    try {
      dlcLista = (await xboxProductos(addons)).map((d) => ({ id: d.ProductId, nombre: d.LocalizedProperties?.[0]?.ProductTitle || null, ...(xboxPrecio(d) || {}) }))
        .filter((d) => d.nombre);
    } catch (err) { log(`DLC Xbox ${id}: ${err.message}`); }
  }
  return {
    tipo: /durable|consumable/i.test(p.ProductKind || "") ? "dlc" : "juego",
    juegoBase: (() => { const b = rel.find((x) => /Parent/i.test(x.RelationshipType)); return b ? { xbox: b.RelatedProductId, nombre: null } : null; })(),
    descripcion: (L.ShortDescription || parrafos[0] || "").trim() || null,
    acerca: parrafos.length > 1 ? parrafos.slice(0, 30).map((x) => ["p", x]) : null,
    desarrolladores: L.DeveloperName ? [L.DeveloperName] : [],
    editores: L.PublisherName ? [L.PublisherName] : [],
    lanzamiento: /^\d{4}-\d\d-\d\d/.test(M.OriginalReleaseDate || "") && !M.OriginalReleaseDate.startsWith("1753") ? M.OriginalReleaseDate.slice(0, 10) : null,
    generos: p.Properties?.Categories?.length ? p.Properties.Categories : p.Properties?.Category ? [p.Properties.Category] : [],
    caracteristicas: (p.Properties?.Attributes || []).map((a) => XBOX_CAR[a.Name]).filter(Boolean),
    capturas: (L.Images || []).filter((i) => i.ImagePurpose === "Screenshot" && i.Uri).slice(0, 8)
      .map((i) => { const u = i.Uri.startsWith("//") ? "https:" + i.Uri : i.Uri; return { chica: `${u}?w=600`, grande: `${u}?w=1600` }; }),
    resena: uso?.RatingCount ? { fuente: "Usuarios de Microsoft Store", puntaje: uso.AverageRating, cantidad: uso.RatingCount, escala: 5 } : null,
    dlcLista,
  };
}

async function consultar(grupo, key) {
  const steam = grupo.find((g) => g.tienda === "steam" && /^steam:\d+$/.test(g.id));
  let appid = steam ? steam.id.split(":")[1] : null;
  const f = { fuentes: [] };
  if (key) {
    try {
      const i = await itadInfo({ appid, titulo: grupo[0].titulo, clave: grupo.clave }, key);
      if (i) { Object.assign(f, i); f.fuentes.push("IsThereAnyDeal"); appid ||= i.appid; }
    } catch (err) { log(`Ficha ITAD "${grupo[0].titulo}": ${err.message}`); }
  }
  if (appid) {
    try {
      const s = await steamDetalle(appid);
      if (s && (!s.tipo || s.tipo === "game" || s.tipo === "dlc")) {
        f.tipo = s.tipo === "dlc" ? "dlc" : "juego";
        if (s.juegoBase) f.juegoBase = s.juegoBase;
        if (s.paquetes?.length) {
          const ed = await steamEdiciones(s.paquetes);
          if (ed) { f.ediciones = ed.ediciones; f.sueltos = ed.sueltos; }
        }
        if (s.dlcIds?.length) {
          f.dlcTotal = s.dlcIds.length;
          try { f.dlcLista = await steamItems(s.dlcIds.slice(0, 40)); } catch (err) { log(`DLC Steam ${appid}: ${err.message}`); }
        }
        f.appid = String(appid);
        f.descripcion = s.descripcion;
        f.generos = s.generos;
        if (!f.desarrolladores?.length) f.desarrolladores = s.desarrolladores;
        if (!f.editores?.length) f.editores = s.editores;
        f.lanzamientoTexto = s.lanzamientoTexto;
        f.metacritic = s.metacritic;
        for (const k of ["nombreSteam", "acerca", "caracteristicas", "idiomas", "requisitos", "capturas", "web", "trailers"]) if (s[k] && (!Array.isArray(s[k]) || s[k].length)) f[k] = s[k];
        f.fuentes.push("Steam");
      }
    } catch (err) { log(`Ficha Steam ${appid}: ${err.message}`); }
    await pausa(1500); // la tienda de Steam limita las consultas seguidas
  }
  // Xbox: completa lo que Steam no trajo (juegos solo de consola, DLC de Xbox y su lista de complementos)
  const xb = grupo.find((g) => g.tienda === "xbox");
  if (xb) {
    try {
      const x = await xboxDetalle(String(xb.id).split(":")[1]);
      f.xboxIntentado = true;
      if (x) {
        f.fuentes.push("Microsoft Store");
        const vacio = (k) => f[k] == null || (Array.isArray(f[k]) && !f[k].length);
        if (!f.fuentes.includes("Steam")) {
          for (const k of ["descripcion", "acerca", "generos", "capturas"]) if (vacio(k) && x[k] && (!Array.isArray(x[k]) || x[k].length)) f[k] = x[k];
          if (vacio("caracteristicas") && x.caracteristicas.length) { f.caracteristicas = x.caracteristicas; f.caracteristicasDe = "Xbox"; }
          if (!f.tipo) f.tipo = x.tipo;
          if (x.juegoBase && !f.juegoBase) f.juegoBase = x.juegoBase;
        }
        for (const k of ["desarrolladores", "editores"]) if (vacio(k) && x[k].length) f[k] = x[k];
        if (!f.lanzamiento && x.lanzamiento) f.lanzamiento = x.lanzamiento;
        if (x.resena) f.resenaXbox = x.resena;
        if (x.dlcLista?.length) f.dlcXbox = x.dlcLista;
        f.xbox = String(xb.id).split(":")[1];
      }
    } catch (err) { log(`Ficha Xbox ${xb.id}: ${err.message}`); }
    await pausa(400);
  }
  if (process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET && !igdbApagado) {
    try {
      const r = await igdbVideos({ appid, titulo: grupo[0].titulo, clave: grupo.clave });
      f.igdbIntentado = true;
      if (r) {
        f.igdb = r.igdb; if (r.videos.length) f.youtube = r.videos; f.fuentes.push("IGDB");
        // Datos de IGDB solo donde no hay otra fuente (sobre todo juegos de PlayStation que no están en Steam ni Xbox)
        const i = r.info || {};
        const vacio = (k) => f[k] == null || (Array.isArray(f[k]) && !f[k].length);
        for (const k of ["desarrolladores", "editores", "capturas", "lanzamiento"]) if (vacio(k) && i[k] && (!Array.isArray(i[k]) || i[k].length)) f[k] = i[k];
        if (vacio("generos") && i.generosEn?.length) f.generos = i.generosEn;
        if (!f.descripcion && i.resumenEn) f.resumenEn = i.resumenEn;
      }
    } catch (err) {
      log(`IGDB "${grupo[0].titulo}": ${err.message}`);
      if (/HTTP (400|401|403)/.test(err.message)) igdbApagado = true; // credenciales o consulta inválidas: no insistir
    }
  }
  return f;
}

const archivoDe = (clave) => `${CARPETA}/${clave.replace(/\s+/g, "-").slice(0, 90)}.json`;

// Todas las fichas guardadas, por clave (incluye la migración desde el archivo único anterior)
export function cargarFichas() {
  const out = {};
  if (fs.existsSync(VIEJO)) Object.assign(out, leerJSON(VIEJO, {}));
  if (fs.existsSync(CARPETA)) for (const n of fs.readdirSync(CARPETA)) {
    if (!n.endsWith(".json")) continue;
    const f = leerJSON(`${CARPETA}/${n}`, null);
    if (f?.clave) out[f.clave] = f;
  }
  return out;
}

// Completa data/fichas/ con los juegos de las ofertas vigentes. Nunca lanza errores.
export async function actualizarFichas(juegos) {
  const cache = cargarFichas();
  const key = process.env.ITAD_API_KEY;
  const grupos = new Map();
  for (const g of juegos) {
    if (g.extra?.proximamente) continue;
    const k = claveJuego(g.titulo);
    if (!k) continue;
    if (!grupos.has(k)) grupos.set(k, Object.assign([], { clave: k }));
    grupos.get(k).push(g);
  }
  const ahora = Date.now();
  const conIgdb = !!(process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET);
  // Versión 6 suma Xbox e IGDB: solo hace falta volver a consultar las fichas que no tienen datos de Steam
  const vencida = (f) => !f || (f.v || 1) < 5 || ((f.v || 1) < VERSION && !f.fuentes?.includes("Steam")) || (conIgdb && !f.igdbIntentado) || ahora - new Date(f.consultado).getTime() > (f.fuentes?.length ? VIGENCIA_MS : REINTENTO_MS);
  // Primero los que tienen oferta en Steam (traen más datos) y los que nunca se consultaron
  const pendientes = [...grupos.values()].filter((gr) => vencida(cache[gr.clave]))
    .sort((a, b) => (!!cache[a.clave] - !!cache[b.clave]) || (b.some((g) => g.tienda === "steam") - a.some((g) => g.tienda === "steam")))
    .slice(0, MAX_POR_CORRIDA);
  if (!key && !pendientes.some((gr) => gr.some((g) => g.tienda === "steam"))) return log("Fichas: sin ITAD_API_KEY y sin juegos de Steam pendientes.");
  let ok = 0;
  for (const gr of pendientes) {
    try {
      const f = await consultar(gr, key);
      // Si una fuente falló esta vez (por ejemplo, Steam cortó por exceso de consultas), se conservan sus datos anteriores
      const previo = cache[gr.clave];
      const perdio = previo?.fuentes?.some((x) => !f.fuentes.includes(x));
      cache[gr.clave] = { clave: gr.clave, ...(perdio ? previo : {}), ...f, v: VERSION,
        fuentes: perdio ? [...new Set([...previo.fuentes, ...f.fuentes])] : f.fuentes, consultado: new Date().toISOString() };
      guardarJSON(archivoDe(gr.clave), cache[gr.clave]);
      if (f.fuentes.length) ok++;
    } catch (err) { log(`Ficha "${gr[0].titulo}": ${err.message}`); }
    if (key) await pausa(250);
  }
  // Migración: el archivo único anterior se reparte en un archivo por juego
  if (fs.existsSync(VIEJO)) {
    for (const [k, f] of Object.entries(cache)) if (!fs.existsSync(archivoDe(k))) guardarJSON(archivoDe(k), { clave: k, ...f });
    fs.rmSync(VIEJO);
  }
  log(`Fichas: ${ok} de ${pendientes.length} consultadas con datos (${Object.keys(cache).length} en total).`);
}

