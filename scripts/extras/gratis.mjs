// Lee los juegos gratis por tiempo limitado de otras tiendas (Steam, GOG, Prime, itch.io…) desde la API pública
// de GamerPower y los guarda en data/gratis.json. Epic sale del feed oficial que ya usan las ofertas.
// Si la API falla, deja el archivo anterior tal cual.
import { fileURLToPath } from "node:url";
import { guardarJSON, leerJSON, ruta } from "../lib/util.mjs";

const API = "https://www.gamerpower.com/api/giveaways?type=game&sort-by=date";
const ARCHIVO = ruta("data", "gratis.json");

const tiendaDe = (plataformas = "") => {
  const p = plataformas.toLowerCase();
  if (p.includes("steam")) return "Steam";
  if (p.includes("epic")) return "Epic Games";
  if (p.includes("gog")) return "GOG";
  if (p.includes("prime") || p.includes("amazon")) return "Prime Gaming";
  if (p.includes("itch")) return "itch.io";
  if (p.includes("indiegala")) return "IndieGala";
  if (p.includes("drm-free")) return "GOG";
  if (p.includes("ubisoft")) return "Ubisoft";
  if (p.includes("ea ") || p.includes("origin")) return "EA";
  if (p.includes("playstation") || p.includes("ps5") || p.includes("ps4")) return "PlayStation";
  if (p.includes("xbox")) return "Xbox";
  if (p.includes("nintendo") || p.includes("switch")) return "Nintendo";
  return null;
};

// "2026-11-30 23:59:00" (hora UTC según GamerPower) -> ISO; "N/A" -> null
const fecha = (s) => !s || /n\/a/i.test(s) ? null : new Date(String(s).replace(" ", "T") + "Z").toISOString();

export async function actualizarGratis() {
  const r = await fetch(API, { headers: { "user-agent": "BolsilloGamer/1.0" }, signal: AbortSignal.timeout(20000) });
  if (r.status === 201) return { juegos: [] }; // GamerPower responde 201 cuando no hay resultados
  if (!r.ok) throw new Error("GamerPower HTTP " + r.status);
  const lista = await r.json();
  if (!Array.isArray(lista)) throw new Error("respuesta inesperada");
  const juegos = [];
  for (const g of lista) {
    if (!g || g.status && !/active/i.test(g.status)) continue;
    const tienda = tiendaDe(g.platforms);
    if (!tienda || tienda === "Epic Games") continue;
    const hasta = fecha(g.end_date);
    if (hasta && new Date(hasta) < new Date()) continue;
    const titulo = String(g.title || "").replace(/\s*\((steam|gog|itch\.io|indiegala|prime gaming)[^)]*\)\s*/gi, " ").replace(/\s+giveaway$/i, "").replace(/\s+(steam\s+)?(key|keys)$/i, "").trim();
    if (!titulo || !/^https?:\/\//.test(g.open_giveaway_url || g.gamerpower_url || "")) continue;
    juegos.push({ titulo, tienda, imagen: g.thumbnail || g.image || "", url: g.open_giveaway_url || g.gamerpower_url,
      valor: g.worth && !/n\/a/i.test(g.worth) ? String(g.worth).replace("$", "US$") : "", hasta });
    if (juegos.length >= 30) break;
  }
  return { juegos };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { juegos } = await actualizarGratis();
    guardarJSON(ARCHIVO, { actualizado: new Date().toISOString(), fuente: "GamerPower", juegos });
    console.log(`Juegos gratis: ${juegos.length} de otras tiendas.`);
  } catch (err) {
    console.log("No se pudieron leer los juegos gratis:", err.message, "— queda el archivo anterior.");
    if (!leerJSON(ARCHIVO, null)) guardarJSON(ARCHIVO, { actualizado: null, juegos: [] });
  }
}
