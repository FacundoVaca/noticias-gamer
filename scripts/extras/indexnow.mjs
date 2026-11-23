// Avisa a Bing, Yandex y otros buscadores (protocolo IndexNow) qué páginas son nuevas o cambiaron.
// Lee public/sitemap.xml, compara con lo ya avisado en data/indexnow.json y manda solo lo nuevo.
// La clave es pública a propósito: el buscador la verifica en /<clave>.txt.
import fs from "node:fs";
import { config, guardarJSON, leerJSON, ruta } from "../lib/util.mjs";

const CLAVE = "7a31ebd2e0633ca7d418f3983bf25a25";
const ESTADO = ruta("data", "indexnow.json");

const sitio = config().sitio.url;
const xml = fs.readFileSync(ruta("public", "sitemap.xml"), "utf8");
const urls = [...xml.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => [m[1], m[2] || ""]);
const avisado = leerJSON(ESTADO, {});
const nuevas = urls.filter(([u, f]) => avisado[u] === undefined || (f && avisado[u] !== f));
if (!nuevas.length) { console.log("IndexNow: nada nuevo."); process.exit(0); }

const host = new URL(sitio).host;
const lote = nuevas.slice(0, 10000);
try {
  const r = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST", headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key: CLAVE, keyLocation: `${sitio}/${CLAVE}.txt`, urlList: lote.map(([u]) => u) }),
    signal: AbortSignal.timeout(30000),
  });
  if (r.status !== 200 && r.status !== 202) throw new Error("HTTP " + r.status + " " + (await r.text()).slice(0, 200));
  for (const [u, f] of lote) avisado[u] = f;
  guardarJSON(ESTADO, avisado);
  console.log(`IndexNow: avisadas ${lote.length} páginas.`);
} catch (err) {
  console.log("IndexNow falló (se reintenta en la próxima corrida):", err.message);
}
