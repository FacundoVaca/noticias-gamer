// Uso: node scripts/aprobar.mjs "slug-1,slug-2"   |  "todas"   |  --rechazar "slug-3"
import fs from "node:fs";
import { ruta, leerJSON, guardarJSON } from "./lib/util.mjs";
import { cargarNotas, construir } from "./build.mjs";

const rechazar = process.argv.includes("--rechazar");
const arg = process.argv.slice(2).filter((a) => a !== "--rechazar").join(",");
const pedidos = arg.split(/[\s,]+/).map((s) => s.trim().replace(/^.*\/(?:revision|notas)\//, "").replace(/\/$/, "")).filter(Boolean);
const pendientes = cargarNotas().filter((n) => n.estado === "pendiente");
const elegidas = pedidos.includes("todas") ? pendientes : pendientes.filter((n) => pedidos.includes(n.slug));
if (!elegidas.length) { console.log("No encontré notas pendientes con esos nombres:", pedidos.join(", ")); process.exit(0); }
for (const n of elegidas) {
  const archivo = ruta("content", "notas", `${n.slug}.json`);
  if (rechazar) {
    fs.rmSync(archivo);
    if (n.imagen?.archivo) fs.rmSync(ruta("public", "img", n.imagen.archivo), { force: true });
    console.log("Rechazada:", n.slug);
  } else {
    const ahora = new Date().toISOString();
    guardarJSON(archivo, { ...leerJSON(archivo), estado: "publicada", fecha: ahora, actualizada: ahora });
    console.log("Publicada:", n.slug);
  }
}
construir();
