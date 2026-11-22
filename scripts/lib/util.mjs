// Utilidades compartidas: texto, similitud, fechas, archivos.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const ruta = (...p) => path.join(RAIZ, ...p);

export function leerJSON(archivo, porDefecto) {
  try { return JSON.parse(fs.readFileSync(archivo, "utf8")); }
  catch { return porDefecto; }
}
export function guardarJSON(archivo, datos) {
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(archivo, JSON.stringify(datos, null, 2) + "\n");
}

export const config = () => leerJSON(ruta("config.json"));

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
export function decodificar(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m);
}
export function sinHtml(s = "") {
  return decodificar(decodificar(s)
    .replace(/<(script|style|noscript|svg|figure|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
export function escapar(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function slugificar(s, max = 80) {
  const base = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base.slice(0, max).replace(/-[^-]*$/, (m) => (base.length > max ? "" : m)) || "nota";
}

const VACIAS = new Set(("the a an and or of to in on for with at by from is are was were be been it its this that as new "
  + "how why what when who will can now just out up into over after before more first get gets got your you our their "
  + "game games gaming video update news trailer report reportedly says said announced reveals revealed release releases officially official announce announces confirms confirmed launches launch coming adds gets is out "
  + "el la los las un una unos unas y o de del al en con por para que se su sus es son ha han lo como mas más ya "
  + "juego juegos nuevo nueva noticia anuncia anunciado tráiler trailer oficial oficialmente confirma confirmado llega llegara").split(/\s+/));

export function tokens(s) {
  return new Set(s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((t) => t.length > 1 && !VACIAS.has(t)));
}
// Coeficiente de solapamiento entre dos títulos (0..1) y cantidad de palabras en común.
export function parecido(a, b) {
  const A = a instanceof Set ? a : tokens(a), B = b instanceof Set ? b : tokens(b);
  if (!A.size || !B.size) return { coef: 0, comunes: 0 };
  let comunes = 0;
  for (const t of A) if (B.has(t)) comunes++;
  return { coef: comunes / Math.min(A.size, B.size), comunes };
}

// Proporción de frases de 6 palabras del texto nuevo que aparecen literal en la fuente.
export function copiaLiteral(nuevo, fuente, n = 6) {
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
  const a = norm(nuevo), b = norm(fuente);
  if (a.length < n || b.length < n) return 0;
  const set = new Set();
  for (let i = 0; i + n <= b.length; i++) set.add(b.slice(i, i + n).join(" "));
  let hits = 0, total = 0;
  for (let i = 0; i + n <= a.length; i++) { total++; if (set.has(a.slice(i, i + n).join(" "))) hits++; }
  return total ? hits / total : 0;
}

// Si la IA dejó "general", deduce la plataforma por las menciones en el texto.
const PLATAFORMAS = {
  playstation: /\b(playstation|ps5|ps4|ps plus|psn|dualsense|sony)\b/gi,
  xbox: /\b(xbox|game pass|microsoft gaming)\b/gi,
  nintendo: /\b(nintendo|switch|zelda|mario|pok[eé]mon)\b/gi,
  pc: /\b(pc|steam|epic games store|gog|nvidia|amd|windows)\b/gi,
  movil: /\b(android|ios|iphone|m[oó]vil|celular|smartphone)\b/gi,
  esports: /\b(esports|e-sports|torneo|campeonato|major)\b/gi,
};
export function inferirCategoria(textos, actual = "general") {
  if (actual && actual !== "general") return actual;
  const t = textos.join(" ");
  let mejor = "general", max = 1;
  for (const [cat, re] of Object.entries(PLATAFORMAS)) {
    const n = (t.match(re) || []).length;
    if (n > max) { mejor = cat; max = n; }
  }
  return mejor;
}

export const contarPalabras = (s) => (s.match(/\S+/g) || []).length;

const TZ = "America/Argentina/Buenos_Aires";
export const hoyAR = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // AAAA-MM-DD
export function fechaLarga(iso) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}
export function fechaCorta(iso) {
  return new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "numeric", month: "short" }).format(new Date(iso));
}

export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// true si el texto usa mayúsculas normales (algunos modelos devuelven todo en minúscula)
export function mayusculasOK(textos) {
  const oraciones = textos.join(" ").split(/(?<=[.!?:])\s+|\n+/).map((o) => o.trim().replace(/^[¿¡"“«(\-–—\s]+/, "")).filter((o) => /^[a-záéíóúñü]/i.test(o));
  if (!oraciones.length) return true;
  const bien = oraciones.filter((o) => /^[A-ZÁÉÍÓÚÑÜ]/.test(o)).length;
  return bien / oraciones.length >= 0.7;
}
export const capitalizar = (s = "") => s.replace(/^([¿¡"“«(\s]*)([a-záéíóúñü])/, (_, a, b) => a + b.toUpperCase());
