// Corre cada pocas horas (GitHub Actions): lee RSS, agrupa noticias, redacta con Gemini,
// crea portada, guarda la nota y regenera el sitio.
import fs from "node:fs";
import { leerFeeds, esRuido, textoDeArticulo, limpiarEnlace } from "./lib/rss.mjs";
import { redactarNota, revisarNovedades } from "./lib/gemini.mjs";
import { crearPortada } from "./lib/imagenes.mjs";
import { config, leerJSON, guardarJSON, ruta, tokens, parecido, copiaLiteral, contarPalabras, mayusculasOK, capitalizar, inferirCategoria, slugificar, hoyAR, esperar, log } from "./lib/util.mjs";
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

// Estructura de una nota: secuencia de bloques con las repeticiones juntas (p p p -> p)
const firmaDe = (cuerpo) => (cuerpo || []).map((b) => b.tipo).filter((t, i, a) => t !== a[i - 1]).join(" ");
// Las últimas notas publicadas, para que Gemini no repita su forma y para el control de estructura parecida
const recientes = fs.readdirSync(ruta("content", "notas")).filter((n) => n.endsWith(".json"))
  .map((n) => leerJSON(ruta("content", "notas", n), null)).filter((n) => n?.estado === "publicada")
  .sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 6);
const recientesTxt = recientes.map((n, i) => `${i + 1}) ${n.formato || "estandar"}, empieza con ${n.apertura || "el hecho principal"}; bloques: ${firmaDe(n.cuerpo)}; subtítulos: ${n.cuerpo.filter((b) => b.tipo === "h2").map((b) => `"${b.texto}"`).join(", ") || "ninguno"}`).join("\n");
const firmasRecientes = recientes.map((n) => firmaDe(n.cuerpo));
const GENERICOS = /^(qu[eé] se sabe|por qu[eé] importa|qu[eé] significa para los jugadores|contexto|conclusi[oó]n|antecedentes)$/i;

// Piezas opcionales: se dejan solo si sus datos están en las fuentes (si no, se quita la pieza, no la nota)
function limpiarPiezas(n, fuentes) {
  const texto = fuentes.map((f) => `${f.texto} ${f.resumen} ${f.titulo}`).join(" ");
  const plano = texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const textoNum = texto.replace(/(\d)[.,\s](?=\d)/g, "$1");
  const numeros = new Set(textoNum.match(/\d+/g) || []);
  const enFuentes = (v) => (String(v || "").replace(/(\d)[.,\s](?=\d)/g, "$1").match(/\d+/g) || []).every((x) => numeros.has(x));
  n.cuerpo = (n.cuerpo || []).filter((b) => {
    if (b.tipo === "dato") return b.valor?.trim() && enFuentes(b.valor);
    if (b.tipo === "hito") return b.fecha?.trim() && enFuentes(b.fecha);
    if (b.tipo === "cita") { const a = String(b.autor || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[\s,]+/).filter((w) => w.length > 3); return a.length && a.some((w) => plano.includes(w)); }
    if (b.tipo === "tabla") return (b.encabezados || []).length >= 2 && (b.filas || []).length >= 2 && b.filas.every((f) => (f.celdas || []).every(enFuentes));
    return true;
  });
  // Una sola cifra o un solo hito no forman un bloque: pasan a ser un párrafo
  n.cuerpo = n.cuerpo.map((b, i, a) => (b.tipo === "dato" || b.tipo === "hito") && a[i - 1]?.tipo !== b.tipo && a[i + 1]?.tipo !== b.tipo
    ? { tipo: "p", texto: b.tipo === "dato" ? `${b.valor}: ${b.texto}` : `${b.fecha}: ${b.texto}` } : b);
}

// Largo mínimo según el formato: una breve de último momento no necesita 550 palabras
const FORMATOS = ["breve", "estandar", "rumor", "guia", "analisis"];
const minimoDe = (n) => ({ breve: 200, rumor: 380, guia: 420, analisis: 750 }[n.formato] ?? P.minPalabras);

// Controles por tipo de nota. Devuelve un motivo para reescribir, o "" si está bien.
// En ofertas deja solo los productos cuyo enlace y precio aparecen de verdad en las fuentes.
function revisarTipo(n, fuentes) {
  if (!FORMATOS.includes(n.formato)) n.formato = n.tipo === "problema" ? "guia" : "estandar";
  if (n.formato === "rumor" && !(n.rumor?.sinConfirmar || []).some((x) => x?.trim()))
    return 'Es un rumor: completá el campo "rumor" con lo que falta confirmar, lo confirmado y qué tan confiable es el origen.';
  if (n.tipo === "problema") {
    const i = n.cuerpo.findIndex((b) => b.tipo === "h2" && /soluci|arregl/i.test(b.texto));
    const pasos = i < 0 ? 0 : n.cuerpo.slice(i + 1).filter((b) => b.tipo === "li").length;
    if (pasos < 3) return 'Es una nota sobre un problema: agregá un subtítulo "Cómo solucionarlo" con 4 a 8 pasos en lista (li).';
  }
  if (n.tipo === "ofertas") {
    const enlaces = new Set(fuentes.flatMap((f) => (f.enlaces || []).map((l) => l.url)));
    const texto = fuentes.map((f) => `${f.texto} ${f.resumen} ${(f.enlaces || []).map((l) => l.texto).join(" ")}`).join(" ").replace(/(\d)[.,](?=\d)/g, "$1");
    const digitos = (p) => (p || "").replace(/[^\d]/g, "");
    const validas = (n.ofertas || []).filter((o) => {
      const url = limpiarEnlace(o.url || "");
      const d = digitos(o.precio);
      if (!url || !enlaces.has(url) || !d) return false;
      if (!(/\b(gratis|free)\b/i.test(o.precio) || texto.includes(d))) return false;
      o.url = url;
      return true;
    });
    log(`  ofertas: ${validas.length} válidas de ${(n.ofertas || []).length}`);
    n.ofertas = validas;
    if (validas.length < 3) {
      if (!enlaces.size) return "";
      return "Es una nota de ofertas: completá el campo ofertas con todos los productos que tengan precio en las fuentes, copiando el precio y la url EXACTA de la lista de enlaces.";
    }
  }
  return "";
}

// 4) Redactar
const marcarUsado = (g) => g.items.forEach((it) => usados.add(it.id));
let hechas = 0, intentos = 0;
for (const g of candidatos) {
  if (hechas >= cupo || intentos >= cupo + 3) break;
  intentos++;
  log(`Tema: "${g.unicos[0].titulo}" (${g.fuentes} fuentes)`);
  for (const it of g.unicos) {
    const pag = await textoDeArticulo(it.link);
    it.texto = pag.texto.length < 300 ? [pag.texto, it.contenido || it.resumen].filter(Boolean).join("\n") : pag.texto;
    it.enlaces = pag.enlaces;
  }
  const fuenteTotal = g.unicos.map((it) => it.texto + " " + it.resumen).join("\n");
  let nota, motivo = "", pendiente = null;
  try {
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      const n = await redactarNota(g.unicos, cfg, motivo, recientesTxt);
      if (!n.apta) { motivo = "no apta: " + (n.motivo || ""); nota = null; break; }
      limpiarPiezas(n, g.unicos);
      // Las citas pueden ser textuales (traducidas): no cuentan para el control de copia
      const plano = [n.titulo, n.bajada, ...n.cuerpo.filter((b) => b.tipo !== "cita").map((b) => b.texto)].join(" ");
      const palabras = contarPalabras(plano);
      const copia = copiaLiteral(plano, fuenteTotal);
      log(`  borrador: ${palabras} palabras, copia literal ${(copia * 100).toFixed(1)}%`);
      const tipoMotivo = revisarTipo(n, g.unicos);
      if (tipoMotivo) motivo = tipoMotivo;
      else if (!mayusculasOK([n.titulo, n.bajada, ...n.cuerpo.map((b) => b.texto)])) motivo = "La versión anterior estaba escrita toda en minúsculas. Usá mayúsculas normales al inicio de cada oración y en los nombres propios.";
      else if (palabras < minimoDe(n)) motivo = `La nota anterior quedó corta (${palabras} palabras) para el formato ${n.formato || "estandar"}. Escribí al menos ${minimoDe(n) + 60} palabras con más contexto.`;
      else if (copia > P.maxCopiaLiteral) motivo = "La versión anterior copiaba frases textuales de las fuentes. Reescribí todo con tus propias palabras y otra estructura.";
      // Control tolerante: solo frena una estructura idéntica a una nota reciente, y solo en el primer intento
      else if (vuelta === 0 && firmaDe(n.cuerpo).split(" ").length >= 5 && (firmasRecientes.includes(firmaDe(n.cuerpo)) || n.cuerpo.filter((b) => b.tipo === "h2").filter((b) => GENERICOS.test(b.texto.trim())).length >= 2)) {
        motivo = "La estructura quedó igual a la de notas recientes del sitio o con subtítulos genéricos. Reorganizá la nota con otra secuencia de bloques, subtítulos propios de esta noticia y otra forma de empezar; podés usar alguna pieza opcional si hay material.";
        log(`  estructura repetida: ${firmaDe(n.cuerpo)}`);
        pendiente = n;
      }
      else { nota = n; break; }
      nota = null;
      await esperar(6000);
    }
  } catch (e) {
    log(`  Error de IA: ${e.message}`);
    if (e.status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(e.message)) { log("Cuota de Gemini agotada por hoy; se sigue en la próxima corrida."); break; }
    continue;
  }
  // Si la reescritura por estructura no pasó, se publica la primera versión (ya había pasado los demás controles)
  if (!nota && pendiente) { nota = pendiente; log("  se usa la primera versión"); }
  marcarUsado(g);
  if (!nota) { log(`  Descartada (${motivo || "no pasó los controles"})`); continue; }

  let slug = slugificar(nota.titulo);
  while (fs.existsSync(ruta("content", "notas", `${slug}.json`))) slug += "-2";
  nota.slug = slug;
  if (!cfg.categorias[nota.categoria]) nota.categoria = "general";
  nota.categoria = inferirCategoria([nota.titulo, nota.bajada, ...(nota.etiquetas || []), ...nota.cuerpo.map((b) => b.texto), ...(nota.tipo === "ofertas" ? (nota.ofertas || []).map((o) => `${o.plataforma || ""} ${o.tienda || ""}`) : [])], nota.categoria);
  const imagen = await crearPortada(nota, cfg);
  const fecha = new Date().toISOString();
  const guardada = {
    slug, estado: P.modoRevision ? "pendiente" : "publicada", fecha, actualizada: fecha,
    titulo: capitalizar(nota.titulo.trim()), bajada: capitalizar(nota.bajada.trim()), categoria: nota.categoria,
    etiquetas: (nota.etiquetas || []).slice(0, 6), clave: (nota.clave || []).slice(0, 5).map(capitalizar),
    cuerpo: nota.cuerpo.filter((b) => b.texto?.trim()).map((b) => {
      const x = { tipo: b.tipo, texto: capitalizar(b.texto.trim()) };
      if (b.tipo === "hito") x.fecha = capitalizar(b.fecha.trim());
      if (b.tipo === "dato") x.valor = b.valor.trim();
      if (b.tipo === "cita") x.autor = b.autor.trim();
      if (b.tipo === "tabla") { x.encabezados = b.encabezados.map((c) => c.trim()); x.filas = b.filas.map((f) => f.celdas.map((c) => String(c).trim())); }
      return x;
    }),
    apertura: nota.apertura || undefined,
    tipo: nota.tipo || "noticia",
    formato: nota.formato || "estandar",
    rumor: nota.formato === "rumor" && nota.rumor ? {
      confirmado: (nota.rumor.confirmado || []).filter((x) => x?.trim()).map((x) => capitalizar(x.trim())),
      sinConfirmar: (nota.rumor.sinConfirmar || []).filter((x) => x?.trim()).map((x) => capitalizar(x.trim())),
      confiabilidad: ["alta", "media", "baja"].includes(nota.rumor.confiabilidad) ? nota.rumor.confiabilidad : null,
      motivo: nota.rumor.motivoConfiabilidad?.trim() ? capitalizar(nota.rumor.motivoConfiabilidad.trim()) : null,
    } : undefined,
    ofertas: nota.tipo === "ofertas" ? nota.ofertas : undefined,
    preguntas: (nota.preguntas || []).filter((q) => q.p?.trim() && q.r?.trim()).slice(0, 3).map((q) => ({ p: capitalizar(q.p.trim()), r: capitalizar(q.r.trim()) })),
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
    const pag = await textoDeArticulo(it.link);
    it.texto = pag.texto.length < 300 ? [pag.texto, it.contenido || it.resumen].filter(Boolean).join("\n") : pag.texto;
    it.enlaces = pag.enlaces;
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
