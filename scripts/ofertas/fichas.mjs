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
const VERSION = 3; // subir cuando se agregan datos nuevos, para volver a consultar todo de a poco
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
    // Tráileres oficiales que la editora sube a Steam (archivos de video de Steam, no de YouTube)
    trailers: (a.movies || []).map((m) => ({ nombre: m.name || null, poster: m.thumbnail || null,
      mp4: m.mp4?.max || m.mp4?.["480"] || null, webm: m.webm?.max || m.webm?.["480"] || null }))
      .filter((m) => /^https:\/\//.test(m.mp4 || m.webm || "") && /^https:\/\//.test(m.poster || "")).slice(0, 3),
  };
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
  const videos = v.filter((x) => /^[\w-]{11}$/.test(x.video_id || "")).map((x) => ({ id: x.video_id, nombre: x.name || null }))
    // primero tráileres y gameplay
    .sort((a, b) => /trailer|gameplay/i.test(b.nombre || "") - /trailer|gameplay/i.test(a.nombre || "")).slice(0, 4);
  return { igdb: juego, videos };
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
      if (s && (!s.tipo || s.tipo === "game")) {
        f.appid = String(appid);
        f.descripcion = s.descripcion;
        f.generos = s.generos;
        if (!f.desarrolladores?.length) f.desarrolladores = s.desarrolladores;
        if (!f.editores?.length) f.editores = s.editores;
        f.lanzamientoTexto = s.lanzamientoTexto;
        f.metacritic = s.metacritic;
        for (const k of ["nombreSteam", "acerca", "caracteristicas", "idiomas", "requisitos", "capturas", "web", "trailers"]) if (s[k] && (!Array.isArray(s[k]) || s[k].length)) f[k] = s[k];
        f.fuentes.push("Steam");
        // Si el resumen de reseñas falla 3 veces seguidas, no se insiste en esta corrida (las de IsThereAnyDeal ya traen el % de Steam)
        if (fallosResenas < 3) {
          try { f.resenasSteam = await steamResenas(appid); fallosResenas = 0; } catch (err) { fallosResenas++; log(`Reseñas Steam ${appid}: ${err.message}`); }
          await pausa(800);
        }
      }
    } catch (err) { log(`Ficha Steam ${appid}: ${err.message}`); }
    await pausa(1500); // la tienda de Steam limita las consultas seguidas
  }
  if (process.env.IGDB_CLIENT_ID && process.env.IGDB_CLIENT_SECRET && !igdbApagado) {
    try {
      const r = await igdbVideos({ appid, titulo: grupo[0].titulo, clave: grupo.clave });
      f.igdbIntentado = true;
      if (r) { f.igdb = r.igdb; if (r.videos.length) f.youtube = r.videos; f.fuentes.push("IGDB"); }
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
  const vencida = (f) => !f || (f.v || 1) < VERSION || (conIgdb && !f.igdbIntentado) || ahora - new Date(f.consultado).getTime() > (f.fuentes?.length ? VIGENCIA_MS : REINTENTO_MS);
  // Primero los que tienen oferta en Steam (traen más datos) y los que nunca se consultaron
  const pendientes = [...grupos.values()].filter((gr) => vencida(cache[gr.clave]))
    .sort((a, b) => (!!cache[a.clave] - !!cache[b.clave]) || (b.some((g) => g.tienda === "steam") - a.some((g) => g.tienda === "steam")))
    .slice(0, MAX_POR_CORRIDA);
  if (!key && !pendientes.some((gr) => gr.some((g) => g.tienda === "steam"))) return log("Fichas: sin ITAD_API_KEY y sin juegos de Steam pendientes.");
  let ok = 0;
  for (const gr of pendientes) {
    try {
      const f = await consultar(gr, key);
      cache[gr.clave] = { clave: gr.clave, v: VERSION, ...f, consultado: new Date().toISOString() };
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

