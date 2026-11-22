// Ficha de cada videojuego: datos reales del juego (descripción, géneros, desarrolladora, editora, fecha de
// lanzamiento, reseñas) para que cada página tenga información propia y no solo precios.
// Fuentes: la API pública de la tienda de Steam (appdetails) e IsThereAnyDeal (con ITAD_API_KEY).
// Nada se inventa: si una fuente no trae un dato, la ficha no lo muestra.
// Se guarda en data/fichas.json; cada juego se consulta una vez y se refresca cada 30 días.
// Por corrida se consulta un máximo de juegos nuevos para no saturar las APIs. Si algo falla, el sitio sigue igual.
import { leerJSON, guardarJSON, ruta, log } from "../lib/util.mjs";

const ARCHIVO = ruta("data", "fichas.json");
const VIGENCIA_MS = 30 * 864e5;
const REINTENTO_MS = 3 * 864e5; // si no se encontró nada, se vuelve a probar a los 3 días
const MAX_POR_CORRIDA = 100;
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

async function steamDetalle(appid) {
  const d = await pedir(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=spanish&cc=ar`);
  const x = d?.[appid];
  if (!x?.success || !x.data) return null;
  const a = x.data;
  return {
    tipo: a.type || null,
    descripcion: sinHtml(a.short_description) || null,
    generos: (a.genres || []).map((g) => g.description).filter(Boolean),
    desarrolladores: a.developers || [],
    editores: a.publishers || [],
    lanzamientoTexto: a.release_date?.coming_soon ? null : a.release_date?.date || null,
    metacritic: a.metacritic?.score ? { puntaje: a.metacritic.score, url: a.metacritic.url || null } : null,
    recomendaciones: a.recommendations?.total || null,
  };
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
        f.recomendaciones = s.recomendaciones;
        f.fuentes.push("Steam");
      }
    } catch (err) { log(`Ficha Steam ${appid}: ${err.message}`); }
    await pausa(1500); // la tienda de Steam limita las consultas seguidas
  }
  return f;
}

// Completa data/fichas.json con los juegos de las ofertas vigentes. Nunca lanza errores.
export async function actualizarFichas(juegos) {
  const cache = leerJSON(ARCHIVO, {});
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
  const vencida = (f) => !f || ahora - new Date(f.consultado).getTime() > (f.fuentes?.length ? VIGENCIA_MS : REINTENTO_MS);
  // Primero los que tienen oferta en Steam (traen más datos) y los que nunca se consultaron
  const pendientes = [...grupos.values()].filter((gr) => vencida(cache[gr.clave]))
    .sort((a, b) => (!!cache[a.clave] - !!cache[b.clave]) || (b.some((g) => g.tienda === "steam") - a.some((g) => g.tienda === "steam")))
    .slice(0, MAX_POR_CORRIDA);
  if (!key && !pendientes.some((gr) => gr.some((g) => g.tienda === "steam"))) return log("Fichas: sin ITAD_API_KEY y sin juegos de Steam pendientes.");
  let ok = 0;
  for (const gr of pendientes) {
    try {
      const f = await consultar(gr, key);
      cache[gr.clave] = { ...f, consultado: new Date().toISOString() };
      if (f.fuentes.length) ok++;
    } catch (err) { log(`Ficha "${gr[0].titulo}": ${err.message}`); }
    if (key) await pausa(250);
  }
  guardarJSON(ARCHIVO, cache);
  log(`Fichas: ${ok} de ${pendientes.length} consultadas con datos (${Object.keys(cache).length} en total).`);
}

export function cargarFichas() {
  return leerJSON(ARCHIVO, {});
}
