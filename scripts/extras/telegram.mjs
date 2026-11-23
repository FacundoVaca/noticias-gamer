// Publica en un canal de Telegram los juegos gratis nuevos y, una vez por día, las mejores ofertas en su precio más bajo.
// Necesita los secretos TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID (por ejemplo "@bolsillogamer"). Sin ellos no hace nada.
// Guarda lo ya enviado en data/telegram.json para no repetir.
import { config, guardarJSON, leerJSON, ruta } from "../lib/util.mjs";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const ESTADO = ruta("data", "telegram.json");
const HORA_RESUMEN = 12; // hora de Argentina a partir de la cual sale el resumen diario

if (!TOKEN || !CHAT) {
  console.log("Telegram: faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID; no se envía nada.");
  process.exit(0);
}

const cfg = config();
const SITIO = cfg.sitio.url;
const esc = (s = "") => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const fechaAr = (iso) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long" }).format(new Date(iso));
const hoyAr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
const horaAr = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", hourCycle: "h23" }).format(new Date()));

async function enviar(texto) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text: texto, parse_mode: "HTML", disable_web_page_preview: false }),
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error(`Telegram: ${d.description || r.status}`);
}

const estado = leerJSON(ESTADO, { enviados: [], resumen: null });
const enviados = new Set(estado.enviados);
const ofertas = leerJSON(ruta("data", "ofertas-juegos.json"), { juegos: [] });
const otros = leerJSON(ruta("data", "gratis.json"), { juegos: [] });

// 1) Juegos gratis nuevos (los que ya se pueden reclamar)
const ahora = Date.now();
const gratis = [
  ...ofertas.juegos.filter((g) => g.gratis && g.tienda === "epic" && !g.extra?.proximamente)
    .map((g) => ({ clave: `epic:${g.titulo}:${g.fin_oferta || ""}`, titulo: g.titulo, tienda: "Epic Games", url: g.url, hasta: g.fin_oferta })),
  ...(otros.juegos || []).map((g) => ({ clave: `${g.tienda}:${g.titulo}:${g.hasta || ""}`, ...g })),
].filter((g) => !g.hasta || new Date(g.hasta).getTime() > ahora);

let n = 0;
for (const g of gratis) {
  if (enviados.has(g.clave)) continue;
  await enviar(`🎁 <b>Gratis en ${esc(g.tienda)}:</b> ${esc(g.titulo)}${g.hasta ? `\nHasta el ${fechaAr(g.hasta)}.` : ""}\n\n<a href="${esc(g.url)}">Conseguirlo</a> · Todos los gratis: ${SITIO}/juegos-gratis/`);
  enviados.add(g.clave);
  if (++n >= 5) break; // como mucho 5 por corrida para no llenar el canal
}

// 2) Resumen diario: ofertas en su precio más bajo registrado, con precio en pesos
const hoy = hoyAr();
if (estado.resumen !== hoy && horaAr() >= HORA_RESUMEN) {
  const imp = cfg.ofertas?.impuestos || { iva: 0.21, percepcion: 0.3 };
  const factor = 1 + imp.iva + imp.percepcion;
  const oficial = ofertas.dolar?.oficial;
  const pesos = (g) => g.moneda === "ARS" ? g.precio * factor : oficial ? g.precio * oficial * factor : null;
  const T = { steam: "Steam", epic: "Epic", xbox: "Xbox", playstation: "PlayStation" };
  const top = ofertas.juegos
    .filter((g) => !g.gratis && !g.extra?.proximamente && g.descuento >= 50 &&
      ((g.dias >= 3 && g.minimo != null && g.precio <= g.minimo) || (g.minHist && g.precio <= g.minHist.precio * 1.01)))
    .sort((a, b) => (a.extra?.orden ?? 999) - (b.extra?.orden ?? 999) || b.descuento - a.descuento)
    .slice(0, 6);
  if (top.length) {
    const lineas = top.map((g) => { const p = pesos(g); return `• <b>${esc(g.titulo)}</b> (${T[g.tienda] || g.tienda}) -${g.descuento}%${p ? ` · $${Math.round(p).toLocaleString("es-AR")}` : ""}`; });
    await enviar(`🔥 <b>Ofertas de hoy en su precio más bajo</b>\n\n${lineas.join("\n")}\n\nPrecio estimado en pesos con impuestos. Todas las ofertas: ${SITIO}/ofertas/`);
  }
  estado.resumen = hoy;
}

guardarJSON(ESTADO, { enviados: [...enviados].slice(-300), resumen: estado.resumen });
console.log(`Telegram: ${n} juegos gratis enviados${estado.resumen === hoy ? ", resumen del día listo" : ""}.`);
