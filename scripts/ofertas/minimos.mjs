// Mínimos históricos de fuentes públicas, para arrancar con historial mientras se junta el propio:
// - Steam: API de IsThereAnyDeal (necesita el secreto ITAD_API_KEY; sin clave no se consulta).
// - Epic (ofertas que vienen de CheapShark): "cheapestPriceEver" de la API de CheapShark, sin clave.
// Se guardan en data/minimos.json y se refrescan cada 7 días por juego. Si algo falla, el sitio sigue igual.
import { leerJSON, guardarJSON, ruta, log } from "../lib/util.mjs";

const ARCHIVO = ruta("data", "minimos.json");
const VIGENCIA_MS = 7 * 864e5;
const ITAD = "https://api.isthereanydeal.com";
const ITAD_STEAM = 61; // id de Steam en IsThereAnyDeal

const pedir = async (url, opciones = {}) => {
  const r = await fetch(url, { ...opciones, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url.split("?")[0]}`);
  return r.json();
};
const idTienda = (g) => String(g.id).split(":").slice(1).join(":");
const trozos = (lista, n) => Array.from({ length: Math.ceil(lista.length / n) }, (_, i) => lista.slice(i * n, i * n + n));

async function steamITAD(juegos, clave) {
  const out = {};
  const ids = juegos.map((g) => `app/${idTienda(g)}`);
  for (const lote of trozos(ids, 200)) {
    // Steam appid -> id de juego en IsThereAnyDeal
    const mapa = await pedir(`${ITAD}/lookup/id/shop/${ITAD_STEAM}/v1?key=${encodeURIComponent(clave)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lote) });
    const pares = Object.entries(mapa || {}).filter(([, uuid]) => uuid);
    if (!pares.length) continue;
    const lows = await pedir(`${ITAD}/games/storelow/v2?key=${encodeURIComponent(clave)}&country=AR&shops=${ITAD_STEAM}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pares.map(([, uuid]) => uuid)) });
    const porUuid = new Map((lows || []).map((x) => [x.id, (x.lows || []).find((l) => l.shop?.id === ITAD_STEAM)]));
    for (const [shopId, uuid] of pares) {
      const l = porUuid.get(uuid);
      if (l?.price?.amount != null) out[`steam:${shopId.replace(/^app\//, "")}`] = {
        precio: +l.price.amount, moneda: l.price.currency, fecha: l.timestamp || null, fuente: "IsThereAnyDeal" };
    }
  }
  return out;
}

async function epicCheapShark(juegos) {
  const out = {};
  const ids = juegos.map((g) => idTienda(g).replace(/^cs/, ""));
  for (const lote of trozos(ids, 25)) {
    const datos = await pedir(`https://www.cheapshark.com/api/1.0/games?ids=${lote.join(",")}`);
    for (const [id, d] of Object.entries(datos || {})) {
      const c = d?.cheapestPriceEver;
      if (c?.price != null) out[`epic:cs${id}`] = {
        precio: +c.price, moneda: "USD", fecha: c.date ? new Date(c.date * 1000).toISOString() : null, fuente: "CheapShark" };
    }
    await new Promise((r) => setTimeout(r, 400)); // CheapShark pide no saturar su API
  }
  return out;
}

// Agrega g.minHist a cada juego con un mínimo conocido en la misma moneda. Nunca lanza errores.
export async function agregarMinimos(juegos) {
  const cache = leerJSON(ARCHIVO, {});
  const viejo = (id) => !cache[id] || Date.now() - new Date(cache[id].consultado).getTime() > VIGENCIA_MS;
  const ahora = new Date().toISOString();
  const pendientes = (filtro) => juegos.filter((g) => filtro(g) && viejo(g.id) && !g.gratis);
  const fuentes = [];
  const clave = process.env.ITAD_API_KEY;
  if (clave) fuentes.push(["Steam (IsThereAnyDeal)", () => steamITAD(pendientes((g) => g.tienda === "steam" && /^\d+$/.test(idTienda(g))), clave)]);
  else log("Mínimos: sin ITAD_API_KEY, no se consultan los de Steam.");
  fuentes.push(["Epic (CheapShark)", () => epicCheapShark(pendientes((g) => g.tienda === "epic" && /^cs\d+$/.test(idTienda(g))))]);
  for (const [nombre, fn] of fuentes) {
    try {
      const nuevos = await fn();
      for (const [id, m] of Object.entries(nuevos)) cache[id] = { ...m, consultado: ahora };
      log(`Mínimos ${nombre}: ${Object.keys(nuevos).length} actualizados.`);
    } catch (err) { log(`Mínimos ${nombre}: ERROR ${err.message}`); }
  }
  guardarJSON(ARCHIVO, cache);
  for (const g of juegos) {
    const m = cache[g.id];
    if (m && m.moneda === g.moneda && m.precio > 0) g.minHist = { precio: m.precio, fecha: m.fecha, fuente: m.fuente };
  }
  return juegos;
}
