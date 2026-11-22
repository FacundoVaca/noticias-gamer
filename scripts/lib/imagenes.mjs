// Portadas: generada con Gemini, foto libre de Pexels o Pixabay, o portada gráfica propia.
// Nunca se usan imágenes de los medios de origen.
import fs from "node:fs";
import path from "node:path";
import { generarImagen } from "./gemini.mjs";
import { traer } from "./rss.mjs";
import { escapar, log, ruta } from "./util.mjs";

let sharp = null;
try { sharp = (await import("sharp")).default; } catch { log("sharp no instalado: las imágenes se guardan sin optimizar"); }

const COLORES = {
  pc: ["#0f2027", "#2c5364"], playstation: ["#00184a", "#0070d1"], xbox: ["#0b2e13", "#107c10"],
  nintendo: ["#3a0008", "#e60012"], movil: ["#2d0b4e", "#8e2de2"], industria: ["#1f1c2c", "#928dab"],
  esports: ["#200122", "#6f0000"], general: ["#141e30", "#243b55"],
};

function envolver(texto, porLinea = 30, maxLineas = 4) {
  const lineas = [];
  let actual = "";
  for (const w of texto.split(/\s+/)) {
    if ((actual + " " + w).trim().length > porLinea) { lineas.push(actual.trim()); actual = w; }
    else actual += " " + w;
  }
  if (actual.trim()) lineas.push(actual.trim());
  if (lineas.length > maxLineas) { lineas.length = maxLineas; lineas[maxLineas - 1] = lineas[maxLineas - 1].replace(/\s*\S*$/, "") + "…"; }
  return lineas;
}

export function portadaSVG(titulo, categoria, nombreCat, sitio, w = 1200, h = 675) {
  const [c1, c2] = COLORES[categoria] || COLORES.general;
  const lineas = envolver(titulo);
  const fs_ = lineas.length > 3 ? 58 : 66;
  const y0 = h / 2 - ((lineas.length - 1) * fs_ * 1.15) / 2 + 10;
  const formas = Array.from({ length: 14 }, (_, i) => {
    const x = (i * 97 + titulo.length * 13) % w, y = (i * 61 + titulo.length * 7) % h, r = 20 + ((i * 37) % 90);
    return `<rect x="${x}" y="${y}" width="${r}" height="${r}" rx="${r / 5}" transform="rotate(${(i * 23) % 90} ${x} ${y})" fill="#fff" opacity="${(0.03 + (i % 4) * 0.015).toFixed(3)}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>${formas}
<text x="70" y="90" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" font-weight="700" fill="#fff" opacity=".85" letter-spacing="3">${escapar(nombreCat.toUpperCase())}</text>
${lineas.map((l, i) => `<text x="70" y="${(y0 + i * fs_ * 1.15).toFixed(0)}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${fs_}" font-weight="800" fill="#fff">${escapar(l)}</text>`).join("\n")}
<text x="70" y="${h - 50}" font-family="DejaVu Sans, Arial, sans-serif" font-size="28" font-weight="700" fill="#fff" opacity=".9">${escapar(sitio)}</text>
</svg>`;
}

async function buscarPexels(consulta) {
  const clave = process.env.PEXELS_API_KEY;
  if (!clave || !consulta) return null;
  const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(consulta)}&per_page=10&orientation=landscape`, { headers: { authorization: clave } });
  if (!r.ok) throw new Error(`Pexels HTTP ${r.status}`);
  const fotos = (await r.json()).photos || [];
  if (!fotos.length) return null;
  const f = fotos[Math.floor(Math.random() * Math.min(5, fotos.length))];
  return {
    buffer: await traer(f.src.large2x || f.src.large, { tipo: "buffer" }),
    credito: { texto: `Foto: ${f.photographer} en Pexels`, url: f.url },
  };
}

// Búsquedas de respaldo por categoría y palabras que tiene que tener una foto para considerarse "gamer"
const BUSQUEDAS = {
  pc: ["pc gaming setup", "gaming keyboard"], playstation: ["game controller", "gaming console"], xbox: ["game controller", "gaming console"],
  nintendo: ["handheld game console", "game controller"], movil: ["mobile gaming", "smartphone game"], esports: ["esports", "gaming tournament"],
  industria: ["video game", "game controller"], general: ["video game", "game controller"],
};
const GAMER = /\b(game|games|gaming|gamer|gamepad|controller|joystick|console|playstation|xbox|nintendo|esports|e-sports|video ?game|arcade|pc|computer|keyboard|monitor|headset|handheld)\b/i;

async function buscarPixabay(consulta, categoria = "general") {
  const clave = process.env.PIXABAY_API_KEY;
  if (!clave) return null;
  const consultas = [...new Set([consulta, ...(BUSQUEDAS[categoria] || BUSQUEDAS.general)].filter(Boolean).map((c) => c.toLowerCase().trim()))];
  let f = null;
  for (const c of consultas) {
    const q = new URLSearchParams({ key: clave, q: c.slice(0, 100), image_type: "photo", orientation: "horizontal", safesearch: "true", per_page: "20", min_width: "1200", order: "popular" });
    const r = await fetch(`https://pixabay.com/api/?${q}`);
    if (!r.ok) throw new Error(`Pixabay HTTP ${r.status}`);
    // Solo fotos cuyas etiquetas sean de videojuegos (evita fotos que no tienen nada que ver)
    const fotos = ((await r.json()).hits || []).filter((h) => GAMER.test(h.tags || ""));
    if (fotos.length) { f = fotos[Math.floor(Math.random() * Math.min(6, fotos.length))]; break; }
  }
  if (!f) return null;
  // Pixabay no permite enlazar sus imágenes en forma permanente: se descargan y se sirven desde el sitio.
  return {
    buffer: await traer(f.largeImageURL || f.webformatURL, { tipo: "buffer" }),
    credito: { texto: `Imagen de ${f.user} en Pixabay`, url: f.pageURL },
  };
}

// Guarda public/img/<slug>.(webp|jpg|png|svg) y devuelve { archivo, origen, credito }
let geminiImagenSinCupo = false;

export async function crearPortada(nota, cfg) {
  const { ancho: W = 1200, alto: H = 675, orden = ["gemini", "pexels", "portada"] } = cfg.imagenes || {};
  const dir = ruta("public", "img");
  fs.mkdirSync(dir, { recursive: true });
  const guardar = async (buf, origen, credito = null) => {
    if (sharp) {
      const archivo = `${nota.slug}.webp`;
      await sharp(buf).resize(W, H, { fit: "cover", position: "attention" }).webp({ quality: 78 }).toFile(path.join(dir, archivo));
      return { archivo, origen, credito };
    }
    const ext = buf.slice(0, 4).toString("hex") === "89504e47" ? "png" : buf.slice(0, 4).toString() === "<svg" ? "svg" : "jpg";
    fs.writeFileSync(path.join(dir, `${nota.slug}.${ext}`), buf);
    return { archivo: `${nota.slug}.${ext}`, origen, credito };
  };
  for (const metodo of orden) {
    try {
      if (metodo === "gemini") {
        if (geminiImagenSinCupo) continue;
        const buf = await generarImagen(nota.promptImagen, cfg);
        if (buf) return await guardar(buf, "ia", { texto: "Ilustración generada con IA" });
      } else if (metodo === "pexels") {
        const foto = await buscarPexels(nota.busquedaImagen);
        if (foto) return await guardar(foto.buffer, "pexels", foto.credito);
      } else if (metodo === "pixabay") {
        const foto = await buscarPixabay(nota.busquedaImagen, nota.categoria);
        if (foto) return await guardar(foto.buffer, "pixabay", foto.credito);
      } else if (metodo === "portada") {
        const svg = portadaSVG(nota.titulo, nota.categoria, cfg.categorias[nota.categoria] || "Noticias", cfg.sitio.nombre, W, H);
        return await guardar(Buffer.from(svg), "portada");
      }
    } catch (e) {
      if (metodo === "gemini" && (e.status === 429 || e.status === 404)) geminiImagenSinCupo = true;
      log(`Imagen (${metodo}) falló: ${e.message.slice(0, 160)}`);
    }
  }
  return null;
}
