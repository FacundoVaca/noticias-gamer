// Lector de RSS y Atom sin dependencias.
import fs from "node:fs";
import crypto from "node:crypto";
import { decodificar, sinHtml, log } from "./util.mjs";

export const UA = "Mozilla/5.0 (compatible; BolsilloGamerBot/1.0; +https://juegos.bolsillo.online/acerca/)";

export async function traer(url, { timeout = 20000, tipo = "text" } = {}) {
  if (url.startsWith("file://")) {
    const p = decodeURIComponent(new URL(url).pathname);
    return tipo === "buffer" ? fs.readFileSync(p) : fs.readFileSync(p, "utf8");
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, signal: ctrl.signal, redirect: "follow" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return tipo === "buffer" ? Buffer.from(await r.arrayBuffer()) : await r.text();
  } finally { clearTimeout(t); }
}

const tag = (xml, nombre) => {
  const m = xml.match(new RegExp(`<${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${nombre}>`, "i"));
  return m ? m[1].trim() : "";
};

export function parsearFeed(xml, fuente) {
  const items = [];
  const bloques = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of bloques) {
    const titulo = sinHtml(tag(b, "title"));
    let link = decodificar(tag(b, "link")).trim();
    if (!link || link.startsWith("<")) {
      const m = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || b.match(/<link[^>]*href=["']([^"']+)["']/i);
      link = m ? decodificar(m[1]) : "";
    }
    if (!titulo || !/^https?:\/\//.test(link)) continue;
    const fechaTxt = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const fecha = new Date(fechaTxt);
    const resumen = sinHtml(tag(b, "description") || tag(b, "summary")).slice(0, 1200);
    const contenido = sinHtml(tag(b, "content:encoded") || tag(b, "content")).slice(0, 6000);
    const cats = [...b.matchAll(/<category(?:\s[^>]*?term=["']([^"']+)["'][^>]*)?>([\s\S]*?)<\/category>/gi)].map((m) => sinHtml(m[1] || m[2])).filter(Boolean)
      .concat([...b.matchAll(/<category[^>]*term=["']([^"']+)["'][^>]*\/>/gi)].map((m) => decodificar(m[1])));
    items.push({
      id: crypto.createHash("sha1").update(link.replace(/[?#].*$/, "")).digest("hex").slice(0, 16),
      fuente: fuente.nombre,
      idioma: fuente.idioma || "en",
      oficial: !!fuente.oficial,
      titulo,
      link,
      fecha: isNaN(fecha) ? new Date().toISOString() : fecha.toISOString(),
      resumen,
      contenido,
      categorias: [...new Set(cats)].slice(0, 8),
    });
  }
  return items;
}

// Filtra lo que no es noticia: ofertas, guías, reseñas largas, patrocinados, etc.
const RUIDO = /\b(wordle|quiz|sponsored|giveaway|guide|walkthrough|where to find|locations?|codes?\b|review:|tested:|gu[ií]a|c[oó]mo conseguir|c[oó]digos|patrocinado|sorteo)\b/i;
export const esRuido = (it) => RUIDO.test(it.titulo) || it.categorias.some((c) => /sponsored|guides?|patrocinado/i.test(c));

export async function leerFeeds(feeds) {
  const todos = [];
  await Promise.all(feeds.map(async (f) => {
    try {
      const items = parsearFeed(await traer(f.url), f);
      log(`RSS ${f.nombre}: ${items.length} notas`);
      todos.push(...items);
    } catch (e) { log(`RSS ${f.nombre}: error (${e.message})`); }
  }));
  return todos;
}

// Limpia enlaces de afiliados/redirecciones y parámetros de seguimiento.
export function limpiarEnlace(url) {
  try {
    let u = new URL(url);
    for (const k of ["url", "u", "murl", "dest", "destination", "target"]) {
      const v = u.searchParams.get(k);
      if (v && /^https?:\/\//.test(v)) { u = new URL(v); break; }
    }
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|tag$|ref$|ref_|affid|aff_|clickid|subid|irclickid|cjevent|ascsubtag|xcust|sharedid)/i.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch { return null; }
}

// Extrae el texto principal y los enlaces de una página de noticia (solo como insumo para la IA).
export async function textoDeArticulo(url, max = 6000) {
  try {
    const html = await traer(url, { timeout: 15000 });
    const zona = (html.match(/<article[\s\S]*?<\/article>/i) || [html])[0];
    const bloques = [...zona.matchAll(/<(p|li|h2|h3|td)[\s>][\s\S]*?<\/\1>/gi)]
      .map((m) => ({ tag: m[1].toLowerCase(), t: sinHtml(m[0]) }))
      .filter(({ tag, t }) => t.length > (tag === "p" ? 25 : 3) && !/cookie|newsletter|subscribe|suscr[ií]b|sign up/i.test(t))
      .map(({ t }) => t);
    const enlaces = [];
    const vistos = new Set();
    for (const m of zona.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const texto = sinHtml(m[2]).slice(0, 120);
      const limpio = limpiarEnlace(decodificar(m[1]));
      if (!texto || !limpio || vistos.has(limpio) || !/^https?:/.test(limpio)) continue;
      vistos.add(limpio);
      enlaces.push({ texto, url: limpio });
      if (enlaces.length >= 80) break;
    }
    return { texto: [...new Set(bloques)].join("\n").slice(0, max), enlaces };
  } catch { return { texto: "", enlaces: [] }; }
}
