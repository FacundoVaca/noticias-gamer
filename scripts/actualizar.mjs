// Corre cada pocas horas (GitHub Actions): lee RSS, agrupa noticias, redacta con Gemini,
// crea portada, guarda la nota y regenera el sitio.
import fs from "node:fs";
import { leerFeeds, esRuido, textoDeArticulo } from "./lib/rss.mjs";
import { redactarNota } from "./lib/gemini.mjs";
import { crearPortada } from "./lib/imagenes.mjs";
import { config, leerJSON, guardarJSON, ruta, tokens, parecido, copiaLiteral, contarPalabras, slugificar, hoyAR, esperar, log } from "./lib/util.mjs";
import { construir } from "./build.mjs";

const cfg = config();
const P = cfg.publicacion;
const ARCH_ESTADO = ruta("data", "estado.json");
const estado = leerJSON(ARCH_ESTADO, { pool: [], usados: [], publicadasPorDia: {}, temasRecientes: [] });
const ahora = Date.now();
const horas = (iso) => (ahora - new Date(iso).getTime()) / 36e5;

// 1) Leer feeds y actualizar el "pool" de noticias recientes
const nuevos = (await leerFeeds(cfg.feeds)).filter((it) => !esRuido(it) && horas(it.fecha) <= P.horasVentana && horas(it.fecha) > -2);
const porId = new Map(estado.pool.filter((it) => horas(it.fecha) <= P.horasVentana).map((it) => [it.id, it]));
for (const it of nuevos) if (!porId.has(it.id)) porId.set(it.id, it);
const usados = new Set(estado.usados);
estado.pool = [...porId.values()].map(({ texto, ...it }) => it);
estado.temasRecientes = (estado.temasRecientes || []).filter((t) => horas(t.fecha) <= 96);
log(`Pool: ${estado.pool.length} notas recientes (${nuevos.length} leídas ahora)`);

// 2) Cupo del día
const hoy = hoyAR();
for (const d of Object.keys(estado.publicadasPorDia)) if (d < hoyAR(new Date(ahora - 10 * 864e5))) delete estado.publicadasPorDia[d];
const yaHoy = estado.publicadasPorDia[hoy] || 0;
let cupo = Math.min(P.maxPorCorrida, P.maxPorDia - yaHoy);
log(`Hoy van ${yaHoy}/${P.maxPorDia}. Cupo de esta corrida: ${Math.max(cupo, 0)}`);

// 3) Agrupar por tema (misma noticia en varios medios)
const libres = estado.pool.filter((it) => !usados.has(it.id)).sort((a, b) => b.fecha.localeCompare(a.fecha));
const grupos = [];
for (const it of libres) {
  const tk = tokens(it.titulo);
  let mejor = null, mejorCoef = 0;
  for (const g of grupos) {
    for (const m of g.items) {
      const { coef, comunes } = parecido(tk, m.tk);
      if (comunes >= 2 && coef >= 0.4 && coef > mejorCoef) { mejor = g; mejorCoef = coef; }
    }
  }
  if (mejor) mejor.items.push({ ...it, tk }); else grupos.push({ items: [{ ...it, tk }] });
}
const yaCubierto = (g) => estado.temasRecientes.some((t) => g.items.some((it) => {
  const { coef, comunes } = parecido(it.tk, new Set(t.tokens));
  return comunes >= 3 && coef >= 0.6;
}));
const candidatos = grupos.map((g) => {
  const porFuente = new Map();
  for (const it of g.items) if (!porFuente.has(it.fuente)) porFuente.set(it.fuente, it);
  g.unicos = [...porFuente.values()].slice(0, 4);
  g.fuentes = porFuente.size;
  g.oficial = g.items.some((it) => it.oficial);
  g.puntaje = g.fuentes * 10 + (g.oficial ? 4 : 0) - Math.min(...g.items.map((it) => horas(it.fecha))) / 6;
  return g;
}).filter((g) => (g.fuentes >= P.minFuentes || g.oficial || P.permitirUnaFuente) && !yaCubierto(g))
  .sort((a, b) => b.puntaje - a.puntaje);
log(`Temas candidatos: ${candidatos.length} (de ${grupos.length} grupos)`);

// 4) Redactar
const marcarUsado = (g) => g.items.forEach((it) => usados.add(it.id));
let hechas = 0, intentos = 0;
for (const g of candidatos) {
  if (hechas >= cupo || intentos >= cupo + 3) break;
  intentos++;
  log(`Tema: "${g.unicos[0].titulo}" (${g.fuentes} fuentes)`);
  for (const it of g.unicos) {
    it.texto = await textoDeArticulo(it.link);
    if (it.texto.length < 300) it.texto = it.contenido || it.resumen;
  }
  const fuenteTotal = g.unicos.map((it) => it.texto + " " + it.resumen).join("\n");
  let nota, motivo = "";
  try {
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      const n = await redactarNota(g.unicos, cfg, motivo);
      if (!n.apta) { motivo = "no apta: " + (n.motivo || ""); nota = null; break; }
      const plano = [n.titulo, n.bajada, ...n.cuerpo.map((b) => b.texto)].join(" ");
      const palabras = contarPalabras(plano);
      const copia = copiaLiteral(plano, fuenteTotal);
      log(`  borrador: ${palabras} palabras, copia literal ${(copia * 100).toFixed(1)}%`);
      if (palabras < P.minPalabras) motivo = `La nota anterior quedó corta (${palabras} palabras). Escribí al menos ${P.minPalabras + 80} palabras con más contexto.`;
      else if (copia > P.maxCopiaLiteral) motivo = "La versión anterior copiaba frases textuales de las fuentes. Reescribí todo con tus propias palabras y otra estructura.";
      else { nota = n; break; }
      nota = null;
      await esperar(6000);
    }
  } catch (e) {
    log(`  Error de IA: ${e.message}`);
    if (e.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(e.message)) { log("Cuota de Gemini agotada por hoy; se sigue en la próxima corrida."); break; }
    continue;
  }
  marcarUsado(g);
  if (!nota) { log(`  Descartada (${motivo || "no pasó los controles"})`); continue; }

  let slug = slugificar(nota.titulo);
  while (fs.existsSync(ruta("content", "notas", `${slug}.json`))) slug += "-2";
  nota.slug = slug;
  if (!cfg.categorias[nota.categoria]) nota.categoria = "general";
  const imagen = await crearPortada(nota, cfg);
  const fecha = new Date().toISOString();
  const guardada = {
    slug, estado: P.modoRevision ? "pendiente" : "publicada", fecha, actualizada: fecha,
    titulo: nota.titulo.trim(), bajada: nota.bajada.trim(), categoria: nota.categoria,
    etiquetas: (nota.etiquetas || []).slice(0, 6), clave: (nota.clave || []).slice(0, 5),
    cuerpo: nota.cuerpo.filter((b) => b.texto?.trim()),
    imagen, modelo: nota.modelo,
    fuentes: g.unicos.map((it) => ({ medio: it.fuente, titulo: it.titulo, url: it.link })),
  };
  guardarJSON(ruta("content", "notas", `${slug}.json`), guardada);
  estado.temasRecientes.push({ fecha, tokens: [...new Set(g.items.flatMap((it) => [...it.tk]))] });
  estado.publicadasPorDia[hoy] = (estado.publicadasPorDia[hoy] || 0) + 1;
  hechas++;
  log(`  ✔ ${guardada.estado}: ${slug} (imagen: ${imagen?.origen || "ninguna"})`);
  await esperar(6000);
}

estado.usados = [...usados].filter((id) => estado.pool.some((it) => it.id === id));
guardarJSON(ARCH_ESTADO, estado);
log(`Listo: ${hechas} notas nuevas.`);
construir();
