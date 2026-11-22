// Corre cada pocas horas (GitHub Actions): lee RSS, agrupa noticias, redacta con Gemini,
// crea portada, guarda la nota y regenera el sitio.
import fs from "node:fs";
import { leerFeeds, esRuido, textoDeArticulo } from "./lib/rss.mjs";
import { redactarNota, revisarNovedades } from "./lib/gemini.mjs";
import { crearPortada } from "./lib/imagenes.mjs";
import { config, leerJSON, guardarJSON, ruta, tokens, parecido, copiaLiteral, contarPalabras, mayusculasOK, capitalizar, slugificar, hoyAR, esperar, log } from "./lib/util.mjs";
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
// Si el tema ya fue publicado devuelve ese tema (con el slug de la nota), si no null
const temaExistente = (g) => estado.temasRecientes.find((t) => g.items.some((it) => {
  const { coef, comunes } = parecido(it.tk, new Set(t.tokens));
  return comunes >= 3 && coef >= 0.6;
})) || null;
const enriquecidos = grupos.map((g) => {
  const porFuente = new Map();
  for (const it of g.items) if (!porFuente.has(it.fuente)) porFuente.set(it.fuente, it);
  g.unicos = [...porFuente.values()].slice(0, 4);
  g.fuentes = porFuente.size;
  g.oficial = g.items.some((it) => it.oficial);
  g.puntaje = g.fuentes * 10 + (g.oficial ? 4 : 0) - Math.min(...g.items.map((it) => horas(it.fecha))) / 6;
  g.tema = temaExistente(g);
  return g;
});
const candidatos = enriquecidos.filter((g) => !g.tema && (g.fuentes >= P.minFuentes || g.oficial || P.permitirUnaFuente))
  .sort((a, b) => b.puntaje - a.puntaje);
// Noticias que ya publicamos pero aparecieron notas nuevas sobre el mismo tema
const seguimientos = enriquecidos.filter((g) => g.tema?.slug).sort((a, b) => b.puntaje - a.puntaje);
log(`Temas nuevos: ${candidatos.length}. Posibles actualizaciones: ${seguimientos.length}. Repetidos sin notas nuevas: se omiten.`);

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
      if (!mayusculasOK([n.titulo, n.bajada, ...n.cuerpo.map((b) => b.texto)])) motivo = "La versión anterior estaba escrita toda en minúsculas. Usá mayúsculas normales al inicio de cada oración y en los nombres propios.";
      else if (palabras < P.minPalabras) motivo = `La nota anterior quedó corta (${palabras} palabras). Escribí al menos ${P.minPalabras + 80} palabras con más contexto.`;
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
    titulo: capitalizar(nota.titulo.trim()), bajada: capitalizar(nota.bajada.trim()), categoria: nota.categoria,
    etiquetas: (nota.etiquetas || []).slice(0, 6), clave: (nota.clave || []).slice(0, 5).map(capitalizar),
    cuerpo: nota.cuerpo.filter((b) => b.texto?.trim()).map((b) => ({ ...b, texto: capitalizar(b.texto.trim()) })),
    imagen, modelo: nota.modelo,
    fuentes: g.unicos.map((it) => ({ medio: it.fuente, titulo: it.titulo, url: it.link })),
  };
  guardarJSON(ruta("content", "notas", `${slug}.json`), guardada);
  estado.temasRecientes.push({ fecha, slug, tokens: [...new Set([...tokens(guardada.titulo), ...g.items.flatMap((it) => [...it.tk])])] });
  estado.publicadasPorDia[hoy] = (estado.publicadasPorDia[hoy] || 0) + 1;
  hechas++;
  log(`  ✔ ${guardada.estado}: ${slug} (imagen: ${imagen?.origen || "ninguna"})`);
  await esperar(6000);
}

// 5) Actualizar notas ya publicadas cuando hay información nueva del mismo tema
let actualizadas = 0;
for (const g of seguimientos) {
  if (actualizadas >= (P.maxActualizacionesPorCorrida ?? 1)) break;
  const archivo = ruta("content", "notas", `${g.tema.slug}.json`);
  const nota = leerJSON(archivo, null);
  if (!nota) { marcarUsado(g); continue; }
  const conocidas = new Set(nota.fuentes.map((f) => f.url));
  const nuevasFuentes = g.unicos.filter((it) => !conocidas.has(it.link));
  if (!nuevasFuentes.length || horas(nota.actualizada || nota.fecha) < (P.horasEntreActualizaciones ?? 3)) continue;
  log(`Seguimiento de "${nota.titulo}" con ${nuevasFuentes.length} fuentes nuevas`);
  for (const it of nuevasFuentes) {
    it.texto = await textoDeArticulo(it.link);
    if (it.texto.length < 300) it.texto = it.contenido || it.resumen;
  }
  let res;
  try { res = await revisarNovedades(nota, nuevasFuentes, cfg); }
  catch (e) {
    log(`  Error de IA: ${e.message}`);
    if (e.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(e.message)) break;
    continue;
  }
  marcarUsado(g);
  const texto = (res.bloques || []).map((b) => b.texto).join(" ");
  if (res.hayNovedad && !mayusculasOK([texto])) { log("  Actualización descartada: sin mayúsculas"); continue; }
  res.bloques = (res.bloques || []).map((b) => ({ ...b, texto: capitalizar(b.texto || "") }));
  if (!res.hayNovedad || contarPalabras(texto) < 25) { log("  Sin datos nuevos: no se toca la nota"); continue; }
  if (copiaLiteral(texto, nuevasFuentes.map((it) => it.texto).join("\n")) > P.maxCopiaLiteral) { log("  Actualización descartada por copia literal"); continue; }
  const fecha = new Date().toISOString();
  nota.actualizaciones = [{ fecha, resumen: res.resumen, bloques: res.bloques.filter((b) => b.texto?.trim()) }, ...(nota.actualizaciones || [])];
  if (res.bajada?.trim()) nota.bajada = res.bajada.trim();
  if (res.clave?.length) nota.clave = res.clave.slice(0, 5);
  nota.fuentes.push(...nuevasFuentes.map((it) => ({ medio: it.fuente, titulo: it.titulo, url: it.link })));
  nota.actualizada = fecha;
  guardarJSON(archivo, nota);
  g.tema.tokens = [...new Set([...g.tema.tokens, ...g.items.flatMap((it) => [...it.tk])])];
  actualizadas++;
  log(`  ✔ actualizada: ${nota.slug}`);
  await esperar(6000);
}

estado.usados = [...usados].filter((id) => estado.pool.some((it) => it.id === id));
guardarJSON(ARCH_ESTADO, estado);
log(`Listo: ${hechas} notas nuevas, ${actualizadas} actualizadas.`);
construir();
