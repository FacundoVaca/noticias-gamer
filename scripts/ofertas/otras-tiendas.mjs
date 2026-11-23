// "Otras tiendas" en cada ficha de juego: precios de tiendas oficiales de claves (Fanatical, Humble, GreenManGaming,
// GOG...) y, aparte, enlaces a mercados de claves de revendedores (G2A, Kinguin, Eneba), con enlaces de afiliado.
//
// - Precios: API de IsThereAnyDeal (games/prices/v3, con ITAD_API_KEY), solo para las tiendas de config.json.
//   Se guardan en data/otras-tiendas.json. Sin clave no se consulta y la sección no muestra precios.
// - Enlaces: si la tienda tiene un ID de afiliado (config.json o variable de entorno AFI_<TIENDA>), el botón
//   lleva a la búsqueda del juego en esa tienda con nuestro ID. Si no, se usa el enlace que da IsThereAnyDeal
//   SIN CAMBIOS (sus condiciones prohíben modificar o quitar los códigos de sus enlaces).
// - Mercados de claves: IsThereAnyDeal no los cubre, así que van sin precio y solo se muestran cuando la tienda
//   tiene un ID de afiliado cargado (sin ID no aportan nada y suman riesgo de reputación).
import { leerJSON, guardarJSON, ruta, log, config } from "../lib/util.mjs";
import { cargarFichas, claveJuego } from "./fichas.mjs";

const ITAD = "https://api.isthereanydeal.com";
const ARCHIVO = ruta("data", "otras-tiendas.json");
const VIGENCIA_MS = 30 * 3600e3; // si una corrida falla, los precios se siguen mostrando hasta 30 h
const LOTE = 200;
const UA = "BolsilloGamer/1.0 (+https://juegos.bolsillo.online/contacto/)";
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function configAfiliados() {
  const a = config().afiliados || {};
  const conId = (lista) => Object.entries(lista || {}).map(([k, t]) => ({
    clave: k, ...t, id: String(process.env[`AFI_${k.toUpperCase()}`] || t.id || "").trim(),
  })).filter((t) => t.activa !== false);
  return { tiendas: conId(a.tiendas), mercados: conId(a.mercados), pais: a.pais || "AR" };
}

export function cargarOtras() {
  const d = leerJSON(ARCHIVO, { precios: {} });
  const limite = Date.now() - VIGENCIA_MS;
  return d.actualizado && new Date(d.actualizado).getTime() > limite ? d : { ...d, precios: {} };
}

// Página de búsqueda del juego en la tienda (es nuestra propia fuente del enlace, no la de IsThereAnyDeal)
export function urlBusqueda(t, titulo) {
  return t.buscar ? t.buscar.replace("{q}", encodeURIComponent(titulo)) : null;
}

// Enlace con nuestro ID de afiliado. Modos:
//  - "param":   agrega ?<param>=<id> a la URL de la tienda (Humble, G2A, Kinguin, Eneba).
//  - "prefijo": el ID es el enlace profundo que da la red de afiliados, terminado en "u=" o similar
//               (Fanatical y GreenManGaming en Impact, GOG en CJ); se le pega la URL codificada.
export function conAfiliado(t, url) {
  if (!t.id || !url) return null;
  if (t.modo === "prefijo") return /^https:\/\//.test(t.id) ? t.id + encodeURIComponent(url) : null;
  if (!t.param) return null;
  const u = new URL(url);
  u.searchParams.set(t.param, t.id);
  return u.toString();
}

async function pedir(url, opciones = {}) {
  const r = await fetch(url, { ...opciones, headers: { "User-Agent": UA, ...(opciones.headers || {}) }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url.split("?")[0]}`);
  return r.json();
}

// Consulta los precios de hoy en las otras tiendas para los juegos en oferta. Nunca lanza errores.
export async function actualizarOtrasTiendas(juegos) {
  try {
    const key = process.env.ITAD_API_KEY;
    const { tiendas, pais } = configAfiliados();
    const conItad = tiendas.filter((t) => t.itad);
    if (!key) return log("Otras tiendas: sin ITAD_API_KEY, no se consultan precios.");
    if (!conItad.length) return;
    // Ids de tienda en IsThereAnyDeal, buscados por nombre (así no dependen de números fijos)
    const shops = await pedir(`${ITAD}/service/shops/v1?country=${pais}&key=${encodeURIComponent(key)}`);
    const shopDe = new Map();
    for (const t of conItad) {
      const s = (shops || []).find((x) => norm(x.title) === norm(t.itad));
      if (s) shopDe.set(s.id, t.clave); else log(`Otras tiendas: "${t.itad}" no aparece en IsThereAnyDeal para ${pais}.`);
    }
    if (!shopDe.size) return;
    const fichas = cargarFichas();
    const ids = [...new Set(juegos.filter((g) => !g.extra?.proximamente).map((g) => fichas[claveJuego(g.titulo)]?.itad).filter(Boolean))];
    const precios = {};
    for (let i = 0; i < ids.length; i += LOTE) {
      const lote = ids.slice(i, i + LOTE);
      const r = await pedir(`${ITAD}/games/prices/v3?key=${encodeURIComponent(key)}&country=${pais}&shops=${[...shopDe.keys()].join(",")}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lote) });
      for (const g of r || []) {
        const lista = (g.deals || []).filter((d) => shopDe.has(d.shop?.id) && d.price?.amount != null && ["USD", "ARS"].includes(d.price.currency))
          .filter((d) => !d.expiry || new Date(d.expiry).getTime() > Date.now())
          .map((d) => ({ tienda: shopDe.get(d.shop.id), precio: d.price.amount, regular: d.regular?.amount ?? null, moneda: d.price.currency,
            descuento: d.cut || 0, url: /^https:\/\//.test(d.url || "") ? d.url : null, drm: (d.drm || []).map((x) => x.name).filter(Boolean),
            fin: d.expiry || null }));
        // Una fila por tienda: la más barata
        const mejor = new Map();
        for (const d of lista) if (!mejor.has(d.tienda) || d.precio < mejor.get(d.tienda).precio) mejor.set(d.tienda, d);
        if (mejor.size) precios[g.id] = [...mejor.values()].sort((a, b) => a.precio - b.precio);
      }
      await new Promise((ok) => setTimeout(ok, 300));
    }
    guardarJSON(ARCHIVO, { actualizado: new Date().toISOString(), fuente: "IsThereAnyDeal", precios });
    log(`Otras tiendas: precios de ${Object.keys(precios).length} de ${ids.length} juegos.`);
  } catch (err) { log("Otras tiendas: ERROR", err.message); }
}
