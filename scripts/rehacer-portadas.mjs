// Vuelve a elegir la portada de notas ya publicadas con el criterio actual (sin repetir fotos y acorde a la plataforma).
// Uso: node scripts/rehacer-portadas.mjs "slug-1,slug-2"
import fs from "node:fs";
import { ruta, leerJSON, guardarJSON, config, log } from "./lib/util.mjs";
import { crearPortada } from "./lib/imagenes.mjs";
import { construir } from "./build.mjs";

const cfg = config();
// La imagen generada con IA no tiene cupo gratis: acá se usan solo fotos (y la portada gráfica si no hay ninguna)
const cfgFotos = { ...cfg, imagenes: { ...(cfg.imagenes || {}), orden: (cfg.imagenes?.orden || ["pixabay", "pexels", "portada"]).filter((m) => m !== "gemini") } };
const slugs = process.argv.slice(2).join(",").split(/[\s,]+/).map((s) => s.replace(/^.*\/notas\//, "").replace(/\/$/, "")).filter(Boolean);
for (const slug of slugs) {
  const archivo = ruta("content", "notas", `${slug}.json`);
  if (!fs.existsSync(archivo)) { log(`No existe la nota ${slug}`); continue; }
  const nota = leerJSON(archivo);
  const antes = nota.imagen;
  const imagen = await crearPortada(nota, cfgFotos);
  if (!imagen) { log(`${slug}: no se encontró otra imagen, queda la anterior`); continue; }
  if (antes?.archivo && antes.archivo !== imagen.archivo) fs.rmSync(ruta("public", "img", antes.archivo), { force: true });
  guardarJSON(archivo, { ...nota, imagen });
  log(`${slug}: ${antes?.credito?.url || antes?.origen || "sin imagen"} -> ${imagen.credito?.url || imagen.origen}`);
}
construir();
