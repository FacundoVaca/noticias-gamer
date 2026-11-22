// Junta las ofertas de Steam, Epic, Xbox y PlayStation, las guarda en Neon (historial de precios)
// y deja una foto de las ofertas vigentes en data/ofertas-juegos.json para armar el sitio.
// Uso: node scripts/ofertas/actualizar-ofertas.mjs [--tiendas steam,epic,xbox,playstation]
import { TIENDAS } from "./tiendas.mjs";
import { guardarJSON, leerJSON, ruta, log, config } from "../lib/util.mjs";
import { construir } from "../build.mjs";

const arg = process.argv.indexOf("--tiendas");
const elegidas = (arg > 0 ? process.argv[arg + 1] : Object.keys(TIENDAS).join(",")).split(",").map((s) => s.trim()).filter((t) => TIENDAS[t]);
const SNAP = ruta("data", "ofertas-juegos.json");
const HORAS_VIGENCIA = 30; // si una tienda falla, sus ofertas se siguen mostrando hasta 30 h

async function dolarTarjeta() {
  try {
    const r = await fetch("https://dolarapi.com/v1/dolares", { signal: AbortSignal.timeout(20000) });
    const lista = await r.json();
    const t = lista.find((d) => d.casa === "tarjeta"), o = lista.find((d) => d.casa === "oficial");
    if (t?.venta > 0) return { tarjeta: +t.venta, oficial: o?.venta ? +o.venta : null, fecha: t.fechaActualizacion || new Date().toISOString() };
  } catch (err) { log("DolarApi:", err.message); }
  return null;
}

async function conectar() {
  if (!process.env.DATABASE_URL) { log("Sin DATABASE_URL: se trabaja solo con el archivo local (sin historial)."); return null; }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL);
  return (texto, params = []) => sql.query(texto, params);
}

const COLS = "id, tienda, id_tienda, titulo, slug, url, imagen, plataformas, precio, original, moneda, descuento, gratis, fin_oferta, extra";
const slugDe = (g) => `${g.titulo}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || g.id_tienda;

async function guardar(db, juegos) {
  const filas = juegos.map((g, i) => ({ ...g, slug: slugDe(g), extra: { ...Object.fromEntries(Object.entries(g.extra || {}).filter(([, v]) => v !== undefined)), orden: i } }));
  for (let i = 0; i < filas.length; i += 500) {
    const lote = JSON.stringify(filas.slice(i, i + 500));
    await db(`INSERT INTO juegos (${COLS}, visto)
      SELECT r.id, r.tienda, r.id_tienda, r.titulo, r.slug, r.url, r.imagen, coalesce(r.plataformas, '{}'), r.precio, r.original, coalesce(r.moneda, 'USD'), r.descuento, coalesce(r.gratis, false), r.fin_oferta, coalesce(r.extra, '{}'), now()
      FROM json_to_recordset($1::json) AS r(id text, tienda text, id_tienda text, titulo text, slug text, url text, imagen text, plataformas text[], precio numeric, original numeric, moneda text, descuento int, gratis boolean, fin_oferta timestamptz, extra jsonb)
      ON CONFLICT (id) DO UPDATE SET titulo = excluded.titulo, url = excluded.url, imagen = coalesce(excluded.imagen, juegos.imagen), plataformas = excluded.plataformas,
        precio = excluded.precio, original = excluded.original, moneda = excluded.moneda, descuento = excluded.descuento, gratis = excluded.gratis,
        fin_oferta = excluded.fin_oferta, extra = juegos.extra || excluded.extra, visto = now()`, [lote]);
    await db(`INSERT INTO precios (juego_id, dia, precio, original, descuento, moneda)
      SELECT r.id, (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, r.precio, r.original, r.descuento, coalesce(r.moneda, 'USD')
      FROM json_to_recordset($1::json) AS r(id text, precio numeric, original numeric, descuento int, moneda text, extra jsonb) WHERE r.precio IS NOT NULL AND NOT coalesce((r.extra->>'proximamente')::boolean, false)
      ON CONFLICT (juego_id, dia) DO UPDATE SET precio = least(precios.precio, excluded.precio), original = excluded.original, descuento = greatest(precios.descuento, excluded.descuento)`, [lote]);
  }
}

async function foto(db) {
  return db(`SELECT j.id, j.tienda, j.titulo, j.slug, j.url, j.imagen, j.plataformas, j.precio::float AS precio, j.original::float AS original, j.moneda, j.descuento, j.gratis,
      j.fin_oferta, j.extra, j.visto, h.minimo::float AS minimo, h.dias, h.desde
    FROM juegos j LEFT JOIN LATERAL (SELECT min(p.precio) AS minimo, count(*)::int AS dias, min(p.dia) AS desde FROM precios p WHERE p.juego_id = j.id AND p.moneda = j.moneda) h ON true
    WHERE j.visto > now() - interval '${HORAS_VIGENCIA} hours'
      AND j.visto >= coalesce((SELECT max(c.inicio) FROM corridas c WHERE c.tienda = j.tienda AND c.ok) - interval '1 minute', '-infinity')
      AND (j.descuento > 0 OR j.gratis)
      AND (j.fin_oferta IS NULL OR j.fin_oferta > now() OR (j.extra->>'proximamente')::boolean)
    ORDER BY j.tienda, (j.extra->>'orden')::int NULLS LAST, j.descuento DESC`);
}

async function main() {
  const db = await conectar();
  const previo = leerJSON(SNAP, { juegos: [] });
  const dolar = (await dolarTarjeta()) || previo.dolar || null;
  if (db && dolar) await db(`INSERT INTO cotizaciones (dia, tarjeta, oficial) VALUES ((now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date, $1, $2)
    ON CONFLICT (dia) DO UPDATE SET tarjeta = excluded.tarjeta, oficial = excluded.oficial`, [dolar.tarjeta, dolar.oficial]);

  const estado = { ...(previo.estado || {}) };
  const sinBase = new Map((previo.juegos || []).map((g) => [g.id, g]));
  for (const t of elegidas) {
    const inicio = Date.now();
    try {
      const juegos = process.env.OFERTAS_MOCK ? (leerJSON(process.env.OFERTAS_MOCK, {})[t] || []) : await TIENDAS[t]({ paginas: t === "playstation" ? config().ofertas?.psPaginas : undefined });
      log(`${t}: ${juegos.length} ofertas`);
      if (db) await guardar(db, juegos);
      else { for (const [id, g] of sinBase) if (g.tienda === t) sinBase.delete(id); juegos.forEach((g, i) => sinBase.set(g.id, { ...g, slug: slugDe(g), extra: { ...g.extra, orden: i }, visto: new Date().toISOString() })); }
      estado[t] = { ok: true, cantidad: juegos.length, fecha: new Date().toISOString() };
      if (db) await db("INSERT INTO corridas (tienda, inicio, cantidad, ok) VALUES ($1, $2, $3, true)", [t, new Date(inicio).toISOString(), juegos.length]);
    } catch (err) {
      log(`${t}: ERROR ${err.message}`);
      estado[t] = { ...(estado[t] || {}), ok: false, error: String(err.message).slice(0, 300), intento: new Date().toISOString() };
      if (db) await db("INSERT INTO corridas (tienda, ok, error) VALUES ($1, false, $2)", [t, String(err.message).slice(0, 500)]).catch(() => {});
    }
    log(`${t}: ${((Date.now() - inicio) / 1000).toFixed(0)} s`);
  }

  let juegos;
  if (db) {
    juegos = await foto(db);
    // Limpieza para no llenar la base: juegos que no aparecen hace 180 días y su historial
    await db("DELETE FROM juegos WHERE visto < now() - interval '180 days'");
  } else {
    const limite = Date.now() - HORAS_VIGENCIA * 3600e3;
    juegos = [...sinBase.values()].filter((g) => new Date(g.visto).getTime() > limite);
  }
  guardarJSON(SNAP, { actualizado: new Date().toISOString(), dolar, estado, juegos });
  log(`Foto guardada: ${juegos.length} ofertas vigentes.`);
  construir();
  if (elegidas.length && elegidas.every((t) => estado[t]?.ok === false)) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
