// Páginas de ofertas en vivo: /ofertas/ (resumen) y /ofertas/<tienda>/ (listado completo con filtros)
import fs from "node:fs";
import { createHash } from "node:crypto";
import { leerJSON, ruta } from "../lib/util.mjs";
import { claveJuego, cargarFichas } from "./fichas.mjs";

// Una ficha de juego entra a Google solo si su historial sirve de verdad: suficientes días con precio
// registrado, un período razonable y al menos un cambio (si no, el gráfico sería una línea plana).
// Además tiene que tener datos propios del juego (descripción o desarrolladora y fecha de lanzamiento).
const CALIDAD = { registros: 14, periodo: 21, tramos: 2 };

export const TIENDAS_INFO = {
  steam: { nombre: "Steam", color: "#66c0f4", plat: "PC",
    intro: "Todas las rebajas vigentes de Steam con el precio regional de Argentina, pasado a pesos con impuestos. Ordenadas por los más vendidos; podés buscar, filtrar y ordenar por descuento o precio." },
  epic: { nombre: "Epic Games", color: "#e6e6e6", plat: "PC",
    intro: "Juegos gratis de la semana en Epic Games Store y los mejores descuentos vigentes, con el precio estimado en pesos con impuestos." },
  xbox: { nombre: "Xbox", color: "#7ee07e", plat: "Xbox y PC",
    intro: "Ofertas de la Microsoft Store de Argentina para Xbox Series X|S, Xbox One y PC. Los precios vienen en pesos desde la tienda y les sumamos los impuestos estimados." },
  playstation: { nombre: "PlayStation", color: "#6ab0ff", plat: "PS4 y PS5",
    intro: "Rebajas de PlayStation Store Argentina para PS4 y PS5, con el precio en dólares de la tienda pasado a pesos con impuestos. No incluye descuentos exclusivos de PS Plus." },
};

// Categoría de un DLC según su nombre en la tienda (las tiendas no lo informan de forma confiable)
export const CATS_DLC = [
  ["exp", "Expansiones", "Contenido nuevo grande: historias, zonas o campañas, o los pases que las incluyen."],
  ["jug", "DLC jugables", "Agregan algo para jugar: personajes, vehículos, misiones, mapas o modos."],
  ["pack", "Packs de contenido y mejoras de edición", ""],
  ["ost", "Bandas sonoras", "Solo música: no agregan nada al juego."],
  ["extra", "Cosméticos y otros extras", "Aspectos, libros de arte, fondos, monedas o ventajas: no agregan contenido jugable nuevo."],
];
export function categoriaDlc(nombre, usd = null) {
  const t = String(nombre || "").toLowerCase();
  if (/soundtrack|banda sonora|\bost\b|original score|\bmusic\b|música|musica/.test(t)) return "ost";
  if (/art ?book|libro de arte|artbook|wallpaper|fondo de pantalla|\bskins?\b|outfits?|costumes?|traje|cosm[eé]tic|avatar|emote|sticker|\bframes?\b|tema\b|\btheme\b|livery|decal|apariencia|currency|coins?\b|monedas|credits?\b|cr[eé]ditos|points?\b|puntos|tokens?\b|vip|membership|membres[ií]a|booster|potenciador|treasure map|supporter|digital deluxe content|bonus content|contenido extra|soundtrack/.test(t)) return "extra";
  if (/expansi[oó]n|expansion|season pass|pase de temporada|year pass|pase anual|expansion pass|story pack|campaign|campa[ñn]a|\bchapter\b|cap[ií]tulo|episode|episodio/.test(t)) return "exp";
  if (/upgrade|mejora|\bpack\b|paquete|bundle|lote|collection|colecci[oó]n|car pass|\bkit\b|welcome/.test(t)) return "pack";
  // Sin palabra clave: si cuesta como un juego chico (US$15 o más, precio normal) suele ser una expansión con nombre propio
  return usd != null && usd >= 15 ? "exp" : "jug";
}

export function cargarOfertas() {
  return leerJSON(ruta("data", "ofertas-juegos.json"), { juegos: [], estado: {}, dolar: null });
}

export function generarOfertas({ cfg, pagina, escribir, e, fechaLarga, anuncio }) {
  const datos = cargarOfertas();
  const imp = cfg.ofertas?.impuestos || { iva: 0.21, percepcion: 0.30 };
  const factor = 1 + (imp.iva || 0) + (imp.percepcion || 0);
  const oficial = datos.dolar?.oficial || (datos.dolar?.tarjeta ? datos.dolar.tarjeta / 1.3 : null);
  const ars = (v, moneda) => v == null ? null : moneda === "ARS" ? v * factor : oficial ? v * oficial * factor : null;
  const fmt = (n) => "$" + Math.round(n).toLocaleString("es-AR");
  const fmtUsd = (n) => "US$" + n.toFixed(2).replace(/\.00$/, "");
  const fmtOrig = (v, m) => m === "ARS" ? fmt(v) : fmtUsd(v);
  const actualizado = datos.actualizado ? fechaLarga(datos.actualizado) : null;
  const finTxt = (iso) => iso ? new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short" }).format(new Date(iso)) : "";

  const todos = datos.juegos.map((g) => ({ ...g, ars: ars(g.precio, g.moneda), arsOrig: ars(g.original, g.moneda),
    minimoReal: g.dias >= 3 && g.minimo != null && g.precio <= g.minimo }));
  const porTienda = (t) => todos.filter((g) => g.tienda === t && !g.extra?.proximamente);
  // Una ficha por videojuego en /ofertas/juego/<slug>/: junta las ofertas del mismo juego en distintas tiendas
  const slugDe = (t) => t.replace(/\s+/g, "-").slice(0, 70).replace(/-+$/, "");
  const fichasJuego = new Map(), usados = new Set();
  for (const g of todos) {
    if (g.extra?.proximamente) continue;
    const k = claveJuego(g.titulo);
    if (!k) continue;
    if (!fichasJuego.has(k)) {
      let base = slugDe(k), sl = base, n = 2;
      while (usados.has(sl)) sl = `${base}-${n++}`;
      usados.add(sl);
      fichasJuego.set(k, { clave: k, url: `/ofertas/juego/${sl}/`, ofertas: [] });
    }
    const f = fichasJuego.get(k);
    f.ofertas.push(g);
    g.pagina = f.url;
  }

  // Datos de la ficha que usan los filtros del listado (sistema operativo, idioma, tipo)
  const fichasInfo = cargarFichas();
  // Versión del script de filtros, para que el navegador no use una copia vieja
  const verFiltros = createHash("sha1").update(fs.readFileSync(ruta("static", "assets", "filtros.js"))).digest("hex").slice(0, 8);
  // Géneros en español (IGDB los trae en inglés) y modos de juego a partir de las características de Steam/Xbox y etiquetas
  const GEN = { adventure: "Aventura", simulator: "Simuladores", racing: "Carreras", strategy: "Estrategia", "role-playing (rpg)": "Rol", rpg: "Rol",
    shooter: "Disparos", fighting: "Lucha", sport: "Deportes", sports: "Deportes", platform: "Plataformas", puzzle: "Puzles", arcade: "Arcade",
    tactical: "Estrategia", "hack and slash/beat 'em up": "Acción", "card & board game": "Cartas y mesa", "free to play": "Gratis para jugar", indie: "Indie",
    // Géneros de la tienda de Xbox
    "action & adventure": "Acción y aventura", "family & kids": "Familia y niños", simulation: "Simuladores", "racing & flying": "Carreras y vuelo",
    "role playing": "Rol", "role-playing": "Rol", strategy: "Estrategia", platformer: "Plataformas", "puzzle & trivia": "Puzles y preguntas",
    "card & board": "Cartas y mesa", classics: "Clásicos", educational: "Educativos", music: "Música", "multi-play online": "Multijugador en línea",
    "other": "Otros", action: "Acción", "word": "Palabras", "kids & family": "Familia y niños", "tools": "Herramientas" };
  const generosDe = (fi) => [...new Set((fi.generos || []).map((x) => GEN[String(x).toLowerCase()] || x)
    .filter((x) => !/acceso anticipado|gratis para jugar|free to play/i.test(x)))];
  const modosDe = (fi) => {
    const t = [...(fi.caracteristicas || []), ...(fi.etiquetas || [])].join("|").toLowerCase();
    return [/un jugador|single.?player/.test(t) && "Un jugador", /cooperativo|co-?op/.test(t) && "Cooperativo",
      /multijugador|jcj|pvp|multiplayer/.test(t) && "Multijugador", /pantalla partida|split screen|cooperativo local|multijugador local|local co-?op/.test(t) && "Local o pantalla dividida"].filter(Boolean);
  };
  const atributos = (g) => {
    const fi = fichasInfo[claveJuego(g.titulo)] || {};
    const os = [...(fi.sistemas || []), ...(fi.steamDeck && fi.steamDeck !== "No compatible" ? ["Steam Deck"] : [])];
    const es = (fi.idiomas || []).filter((x) => /^español/i.test(x.nombre));
    const idi = !fi.idiomas?.length ? "" : es.length ? (es.some((x) => x.voces) ? "tv" : "t") : "n";
    const enMin = !g.gratis && (g.minimoReal || (g.minHist && g.precio <= g.minHist.precio * 1.01));
    return ` data-g="${e(generosDe(fi).join(";"))}" data-m="${e(modosDe(fi).join(";"))}" data-os="${e(os.join(";"))}" data-es="${idi}" data-k="${g.extra?.dlc || fi.tipo === "dlc" ? "dlc" : "juego"}"${enMin ? ' data-min="1"' : ""}${g.extra?.gamePass ? ' data-gp="1"' : ""}`;
  };
  const tarjeta = (g, i = 0) => {
    const T = TIENDAS_INFO[g.tienda];
    const img2 = g.extra?.img2 ? ` onerror="if(this.dataset.f){this.onerror=null;this.src='/assets/portada.svg'}else{this.dataset.f=1;this.src='${e(g.extra.img2)}'}"` : ` onerror="this.onerror=null;this.src='/assets/portada.svg'"`;
    const precio = g.gratis ? `<span class="o-precio">Gratis</span>` : g.ars != null ? `<span class="o-precio">${fmt(g.ars)}</span>` : `<span class="o-precio">${fmtOrig(g.precio, g.moneda)}</span>`;
    const detalle = g.gratis ? (g.original ? `<span class="o-antes">${fmtOrig(g.original, g.moneda)}</span>` : "")
      : `${g.arsOrig != null && g.original > g.precio ? `<span class="o-antes">${fmt(g.arsOrig)}</span>` : ""}${g.ars != null ? `<span class="o-base">${fmtOrig(g.precio, g.moneda)} en la tienda</span>` : ""}`;
    const chips = (g.plataformas || []).map((p) => `<span class="o-plat">${e(p)}</span>`).join("");
    const minExt = g.minHist && !g.gratis ? g.minHist : null;
    const enMinimo = g.minimoReal || (minExt && g.precio <= minExt.precio * 1.01); // 1% de margen por redondeo
    const badges = [enMinimo ? `<span class="o-min">Precio más bajo registrado</span>` : "", g.extra?.gamePass ? `<span class="o-gp">En Game Pass</span>` : ""].join("");
    const fin = g.extra?.proximamente ? `Gratis desde el ${finTxt(g.extra.desde)}` : g.fin_oferta ? `Hasta el ${finTxt(g.fin_oferta)}` : "";
    return `<article class="o-card" data-t="${e(g.titulo.toLowerCase())}" data-d="${g.descuento || 0}" data-p="${g.gratis ? 0 : Math.round(g.ars ?? g.precio)}" data-pl="${e((g.plataformas || []).join(";"))}"${atributos(g)}>
<a class="o-link" href="${e(g.pagina || g.url)}"${g.pagina ? "" : ' rel="nofollow noopener sponsored" target="_blank"'}><div class="o-img"><img src="${e(g.imagen || "/assets/portada.svg")}"${img2} alt="" loading="${i < 6 ? "eager" : "lazy"}" referrerpolicy="no-referrer">${g.descuento ? `<span class="o-desc">-${g.descuento}%</span>` : ""}</div>
<div class="o-txt"><h3>${e(g.titulo)}</h3><p class="o-chips">${g.extra?.dlc ? '<span class="o-dlc">DLC</span>' : ""}<span class="o-tienda" style="color:${T.color}">${T.nombre}</span>${chips}</p>
<p class="o-precios">${precio}${detalle}</p>${badges ? `<p class="o-badges">${badges}</p>` : ""}${minExt && !enMinimo ? `<p class="o-hist">Mínimo histórico: ${fmtOrig(minExt.precio, g.moneda)}${minExt.fecha ? ` (${new Intl.DateTimeFormat("es-AR", { month: "short", year: "numeric" }).format(new Date(minExt.fecha))})` : ""}</p>` : ""}${fin ? `<p class="o-fin">${fin}</p>` : ""}</div></a><a class="o-btn" href="${e(g.url)}" rel="nofollow noopener sponsored" target="_blank">Ver en ${T.nombre}</a></article>`;
  };

  const pct = (x) => Math.round((x || 0) * 100);
  const horaTxt = (iso) => iso ? new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "";
  const diaTxt = (iso) => iso ? new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long" }).format(new Date(iso)) : "";
  const actualizadoEl = (iso) => iso ? `<p class="o-upd"><span class="o-upd-dot" aria-hidden="true"></span><span>Precios actualizados el <time datetime="${iso}">${horaTxt(iso)}</time> h (hora de Argentina)</span></p>` : "";
  // Cada tienda se actualiza por separado (PlayStation, 2 veces por día): se muestra la hora de cada una
  const horaCorta = (iso) => new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const actualizadoTiendas = Object.keys(TIENDAS_INFO).some((k) => datos.estado?.[k]?.fecha)
    ? `<p class="o-upd o-upd-t"><span class="o-upd-dot" aria-hidden="true"></span><span>Última actualización de cada tienda (hora de Argentina): ${Object.entries(TIENDAS_INFO).filter(([k]) => datos.estado?.[k]?.fecha).map(([k, T]) => `<b>${T.nombre}</b> <time datetime="${datos.estado[k].fecha}">${horaCorta(datos.estado[k].fecha)}</time>`).join(" · ")}. Cada tienda se lee por separado; PlayStation, dos veces por día.</span></p>`
    : actualizadoEl(datos.actualizado);
  // Metodología con los valores reales que usa el cálculo
  const notaPrecios = `<aside class="o-metodo" aria-labelledby="o-metodo-tit"><h2 id="o-metodo-tit">Cómo calculamos el precio en pesos</h2>
<ol class="o-formula"><li><span>Precio de la tienda</span><small>En dólares, o en pesos sin impuestos en Xbox</small></li>
<li><span>× dólar oficial${oficial ? ` <b>${fmt(oficial)}</b>` : ""}</span><small>${datos.dolar?.fecha ? `Cotización del ${diaTxt(datos.dolar.fecha)}` : "Cotización oficial del día"}</small></li>
<li><span>+ IVA ${pct(imp.iva)}% + percepción ${pct(imp.percepcion)}%</span><small>Lo que suele cobrar la tarjeta argentina</small></li></ol>
${todos.some((g) => g.minHist) ? `<p class="mini">Mínimos históricos en la moneda de la tienda: ${[...new Set(todos.filter((g) => g.minHist).map((g) => g.minHist.fuente))].map((f) => f === "IsThereAnyDeal" ? '<a href="https://isthereanydeal.com" rel="noopener" target="_blank">IsThereAnyDeal</a>' : '<a href="https://www.cheapshark.com" rel="noopener" target="_blank">CheapShark</a>').join(" y ")}, más nuestro propio registro diario.</p>` : ""}
<p class="mini">Es una estimación: el precio final lo define tu banco y la tienda, así que verificalo antes de comprar.${actualizado ? ` Datos actualizados el ${actualizado.replace(/\.$/, "")}.` : ""}</p></aside>`;
  const faq = (T) => [
    ["¿Cómo calculan el precio en pesos?", `Tomamos el precio de ${T.nombre} para Argentina${T.nombre === "Xbox" ? " (que la tienda ya muestra en pesos)" : " (en dólares)"}, lo pasamos con el dólar oficial del día y le sumamos IVA ${Math.round((imp.iva || 0) * 100)}% y percepción ${Math.round((imp.percepcion || 0) * 100)}%, que es lo que suele aparecer en el resumen de la tarjeta. Es una estimación: tu banco puede usar otra cotización.`],
    ["¿Qué significa \"Mínimo registrado\"?", "Que el precio de hoy es el más bajo que vimos desde que empezamos a seguir ese juego (necesitamos al menos 3 días de historial para marcarlo)."],
    ["¿Cada cuánto se actualiza?", "Varias veces por día, de forma automática. Las ofertas pueden terminar antes o cambiar sin aviso."],
    ["¿Ustedes venden los juegos?", `No. ${cfg.sitio.nombre} solo recopila las ofertas públicas; el botón te lleva a la tienda oficial y la compra se hace ahí.`],
  ];
  const faqHtml = (T) => `<section class="faq"><h2>Preguntas frecuentes</h2>${faq(T).map(([p, r]) => `<details><summary>${e(p)}</summary><p>${e(r)}</p></details>`).join("")}</section>`;
  const faqLd = (T) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq(T).map(([p, r]) => ({ "@type": "Question", name: p, acceptedAnswer: { "@type": "Answer", text: r } })) }).replace(/</g, "\\u003c")}</script>`;
  const navTiendas = (activa) => `<nav class="o-tabs"><a href="/ofertas/"${!activa ? ' class="on"' : ""}>Resumen</a>${Object.entries(TIENDAS_INFO).map(([k, T]) => `<a href="/ofertas/${k}/"${activa === k ? ' class="on"' : ""}>${T.nombre} <small>${porTienda(k).length}</small></a>`).join("")}<a href="/ofertas/notas/">Notas</a></nav>`;
  const caido = (t) => datos.estado?.[t]?.ok === false ? `<p class="o-aviso">No pudimos actualizar ${TIENDAS_INFO[t].nombre} en la última pasada; mostramos los datos anteriores.</p>` : "";

  // Listado completo por tienda
  for (const [k, T] of Object.entries(TIENDAS_INFO)) {
    const lista = porTienda(k);
    const proximos = todos.filter((g) => g.tienda === k && g.extra?.proximamente);
    const plats = [...new Set(lista.flatMap((g) => g.plataformas || []))].sort();
    // Cuántas ofertas tienen cada dato: un filtro solo aparece si sirve para una parte razonable del listado
    const attrs = lista.map((g) => atributos(g));
    const cubre = (re) => attrs.filter((x) => re.test(x)).length;
    const conG = cubre(/data-g="[^"]+"/), conM = cubre(/data-m="[^"]+"/);
    const cuentaG = {};
    for (const g of lista) for (const x of generosDe(fichasInfo[claveJuego(g.titulo)] || {})) cuentaG[x] = (cuentaG[x] || 0) + 1;
    const GENS = Object.entries(cuentaG).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([x]) => x);
    const conOs = ["steam", "epic"].includes(k) ? cubre(/data-os="[^"]+"/) : 0, conMin = cubre(/data-min/), conEs = cubre(/data-es="[tvn]+"/), conDlc = cubre(/data-k="dlc"/), conGp = cubre(/data-gp/);
    const SO = ["Windows", "macOS", "Linux", "Steam Deck"].filter((x) => attrs.some((a) => a.includes(x)));
    const chk = (grupo, valor, texto) => `<label class="o-chk"><input type="checkbox" data-f="${grupo}" value="${e(valor)}"><span>${e(texto)}</span></label>`;
    const grupoF = (tit, cont, nota = "") => `<fieldset class="o-fg"><legend>${tit}</legend><div class="o-fg-op">${cont}</div>${nota ? `<p class="o-fg-nota">${nota}</p>` : ""}</fieldset>`;
    const panel = [
      grupoF("Descuento", `<select id="o-dm" aria-label="Descuento mínimo"><option value="0">Cualquiera</option><option value="50">50% o más</option><option value="75">75% o más</option><option value="90">90% o más</option></select>`),
      grupoF("Precio en pesos", `<span class="o-rango"><input type="number" id="o-pmin" inputmode="numeric" min="0" step="1000" placeholder="Mín. $" aria-label="Precio mínimo en pesos"><input type="number" id="o-pmax" inputmode="numeric" min="0" step="1000" placeholder="Máx. $" aria-label="Precio máximo en pesos"></span>`),
      GENS.length > 1 && conG >= lista.length * 0.2 ? grupoF("Género", GENS.map((x) => chk("g", x, x)).join(""), `Lo tienen ${conG} de ${lista.length} ofertas.`) : "",
      conM >= lista.length * 0.2 ? grupoF("Modo de juego", ["Un jugador", "Cooperativo", "Multijugador", "Local o pantalla dividida"].map((x) => chk("m", x, x)).join(""), `Según las características de la tienda. Lo tienen ${conM} de ${lista.length} ofertas.`) : "",
      plats.length > 1 ? grupoF("Plataforma", plats.map((p) => chk("pl", p, p)).join("")) : "",
      SO.length && conOs >= lista.length * 0.2 ? grupoF("Sistema operativo", SO.map((x) => chk("os", x, x === "Steam Deck" ? "Steam Deck (jugable o verificado)" : x)).join(""), `Según Steam. Lo tienen ${conOs} de ${lista.length} ofertas; las demás no aparecen con este filtro.`) : "",
      conEs >= lista.length * 0.2 ? grupoF("Idioma", `${chk("es", "t", "Con textos en español")}${chk("es", "v", "Con voces en español")}`, `Según Steam (versión de PC). Lo tienen ${conEs} de ${lista.length} ofertas.`) : "",
      conDlc && conDlc < lista.length ? grupoF("Tipo", `${chk("k", "juego", "Juegos")}${chk("k", "dlc", "DLC y expansiones")}`) : "",
      conMin || conGp ? grupoF("Otros", `${conMin ? chk("min", "1", "En su precio más bajo registrado") : ""}${conGp ? chk("gp", "1", "Incluido en Game Pass") : ""}`) : "",
    ].join("");
    const controles = `<div class="o-ctrl" role="search"><input type="search" id="o-q" placeholder="Buscar en ${lista.length} ofertas de ${T.nombre}…" aria-label="Buscar juego">
<select id="o-ord" aria-label="Ordenar"><option value="">Más populares</option><option value="d">Mayor descuento</option><option value="p">Menor precio</option><option value="pd">Mayor precio</option><option value="t">Nombre (A-Z)</option></select>
<button type="button" class="o-fbtn" id="o-fbtn" aria-expanded="false" aria-controls="o-panel">Filtros <span id="o-fn" class="o-fn" hidden></span></button>
<span id="o-n" class="o-n" aria-live="polite"></span>
<div class="o-panel" id="o-panel" hidden>${panel}<div class="o-panel-pie"><button type="button" class="o-limpiar" id="o-limpiar">Limpiar filtros</button><button type="button" class="o-listo" id="o-listo">Ver resultados</button></div></div></div>
<p class="o-activos" id="o-activos" hidden></p>
`;
    const cuerpo = `${navTiendas(k)}<h1 class="sec-tit">Ofertas de ${T.nombre} en pesos argentinos</h1><p class="o-intro">${e(T.intro)}</p>${actualizadoEl(datos.estado?.[k]?.fecha || datos.actualizado)}${caido(k)}
${proximos.length ? `<h2 class="o-h2">Próximamente gratis</h2><div class="o-grilla">${proximos.map(tarjeta).join("")}</div>` : ""}
${lista.length ? `${proximos.length ? `<h2 class="o-h2">Todas las ofertas</h2>` : ""}${controles}<div class="o-grilla" id="o-lista">${lista.map(tarjeta).join("")}</div><p class="vacio o-sin" id="o-sin" hidden>No hay ofertas con esos filtros. Probá con otro descuento o rango de precio.</p>` : `<p class="vacio">Todavía no hay ofertas cargadas de ${T.nombre}. Volvé en un rato.</p>`}
${notaPrecios}${k === "epic" ? `<p class="mini">Descuentos de Epic vía <a href="https://www.cheapshark.com" rel="noopener" target="_blank">CheapShark</a> (precios de referencia en dólares, pueden variar en Argentina).</p>` : ""}
${anuncio}${faqHtml(T)}
<script src="/assets/filtros.js?v=${verFiltros}" defer></script>`;
    escribir(`ofertas/${k}/index.html`, pagina({ titulo: `Ofertas de ${T.nombre} hoy en pesos (${lista.length}) | ${cfg.sitio.nombre}`,
      desc: `${lista.length} ofertas de ${T.nombre} (${T.plat}) con precio en pesos argentinos con impuestos. Se actualiza varias veces por día.`,
      canon: `/ofertas/${k}/`, cuerpo, ads: lista.length > 0, extraHead: faqLd(T) }));
  }

  // Resumen
  const gratis = todos.filter((g) => g.gratis && !g.extra?.proximamente);
  const prox = todos.filter((g) => g.extra?.proximamente);
  const top = (k) => [...porTienda(k)].filter((g) => !g.gratis).slice(0, 40).sort((a, b) => b.descuento - a.descuento).slice(0, 8);
  const total = todos.filter((g) => !g.extra?.proximamente).length;
  // Mejores del día: los 2 descuentos más grandes entre los 40 juegos más populares de cada tienda
  // No alcanza con el % de descuento: suma puntos estar en su mínimo histórico, ser popular y que el ahorro sea grande en plata
  const enMinimo = (g) => !g.gratis && (g.minimoReal || (g.minHist && g.precio <= g.minHist.precio * 1.01));
  const puntaje = (g, i) => g.descuento + (enMinimo(g) ? 25 : 0) + Math.max(0, 20 - i / 2) + Math.min(15, ((g.arsOrig ?? 0) - (g.ars ?? 0)) / 4000);
  const mejores = Object.keys(TIENDAS_INFO).flatMap((k) => porTienda(k).filter((g) => !g.gratis && g.descuento).slice(0, 40)
    .map((g, i) => ({ g, p: puntaje(g, i) })).sort((a, b) => b.p - a.p).slice(0, 2)).sort((a, b) => b.p - a.p).map((x) => x.g);
  const cuerpo = `${navTiendas(null)}<h1 class="sec-tit">Ofertas de juegos hoy: Steam, Epic, Xbox y PlayStation en pesos</h1>
<p class="o-intro">Juntamos ${total ? `${total.toLocaleString("es-AR")} ofertas vigentes` : "las ofertas vigentes"} de las cuatro tiendas grandes y les calculamos el precio en pesos con impuestos, para que compares sin hacer cuentas. Se actualiza solo varias veces por día.</p>${actualizadoTiendas}
${mejores.length ? `<section class="o-sec o-top"><h2 class="o-h2">Mejores ofertas de hoy</h2><p class="o-sub">Dos por tienda entre sus 40 juegos más populares. No elegimos solo por el porcentaje: también pesa que esté en su precio más bajo registrado, qué tan popular es y cuánta plata ahorrás.</p><div class="o-grilla">${mejores.map(tarjeta).join("")}</div></section>` : ""}
${gratis.length ? `<h2 class="o-h2">Gratis ahora</h2><div class="o-grilla">${gratis.map(tarjeta).join("")}</div>` : ""}
${prox.length ? `<h2 class="o-h2">Próximamente gratis</h2><div class="o-grilla">${prox.map(tarjeta).join("")}</div>` : ""}
${anuncio}
${Object.entries(TIENDAS_INFO).map(([k, T]) => top(k).length ? `<section class="o-sec"><div class="o-sec-tit"><h2 class="o-h2">Destacadas de ${T.nombre}</h2><a href="/ofertas/${k}/">Ver las ${porTienda(k).length} →</a></div>${caido(k)}<div class="o-grilla">${top(k).map(tarjeta).join("")}</div></section>` : "").join("")}
${!total ? `<p class="vacio">Estamos cargando las primeras ofertas. Volvé en un rato.</p>` : ""}
${notaPrecios}
<p><a href="/ofertas/notas/">Notas sobre ofertas y rebajas →</a></p>
${faqHtml({ nombre: "cada tienda" })}`;
  escribir("ofertas/index.html", pagina({ titulo: `Ofertas de juegos hoy en pesos: Steam, Epic, Xbox y PlayStation | ${cfg.sitio.nombre}`,
    desc: "Todas las ofertas de juegos de Steam, Epic Games, Xbox y PlayStation con precio en pesos argentinos con impuestos. Juegos gratis y mínimos históricos.",
    canon: "/ofertas/", cuerpo, ads: total > 0, extraHead: faqLd({ nombre: "cada tienda" }) }));

  const indexables = paginasJuegos();
  return ["/ofertas/", ...Object.keys(TIENDAS_INFO).map((k) => `/ofertas/${k}/`), ...indexables];

  function paginasJuegos() {
    const historial = leerJSON(ruta("data", "historial.json"), {});
    const fichas = fichasInfo;
    // Cotización para el precio estimado en pesos: la página lo calcula en el navegador, así el HTML
    // de cada juego solo cambia cuando cambia su precio (y no todos los días con el dólar)
    escribir("ofertas/cotizacion.json", JSON.stringify({ oficial, iva: imp.iva || 0, percepcion: imp.percepcion || 0, fecha: datos.dolar?.fecha || null }));
    const mesAnio = (iso) => new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(new Date(iso));
    const diaLargo = (d) => new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }).format(new Date(d + "T12:00:00Z"));
    const hoy = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // fecha en Argentina
    const dnum = (d) => Math.round(Date.parse(d + "T12:00:00Z") / 864e5);
    const lista = (xs) => xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}` : xs[0] || "";
    const ORDEN = ["steam", "epic", "xbox", "playstation"];

    // Qué tan útil es el historial de una oferta (solo se usa para decidir si se indexa; no se muestra)
    const evaluar = (tramos) => {
      const validos = tramos.filter((t) => t[2] > 0);
      if (!validos.length || validos.length !== tramos.length) return { util: false };
      const registros = validos.reduce((s, [d, h]) => s + dnum(h || hoy) - dnum(d) + 1, 0);
      const periodo = dnum(hoy) - dnum(validos[0][0]) + 1;
      return { util: registros >= CALIDAD.registros && periodo >= CALIDAD.periodo && validos.length >= CALIDAD.tramos };
    };
    // Días que lleva nuestro propio registro de una oferta (desde el primer día que la vimos hasta hoy)
    const diasRegistro = (tramos) => tramos.length ? dnum(hoy) - dnum(tramos[0][0]) + 1 : 0;
    const diasTxt = (n) => n === 1 ? "1 día" : `${n} días`;
    const GRAFICO_DIAS = 14; // antes de esto un gráfico propio no dice nada (sería una línea casi plana)
    // Resumen en texto del historial, visible sin JavaScript (para lectores y buscadores)
    const resumen = (tramos, g, T) => {
      const min = tramos.reduce((a, t) => t[2] < a[2] ? t : a), max = tramos.reduce((a, t) => t[2] > a[2] ? t : a);
      const cambios = tramos.slice(1).filter((t, i) => t[2] !== tramos[i][2]).length;
      let txt = `Seguimos el precio de ${e(g.titulo)} en ${T.nombre} desde el ${diaLargo(tramos[0][0])} (${diasTxt(diasRegistro(tramos))} de registro). `;
      txt += min[2] === max[2] ? `En todos los días con oferta que registramos costó ${fmtOrig(min[2], g.moneda)}.`
        : `El precio más bajo que registramos fue ${fmtOrig(min[2], g.moneda)} (desde el ${diaLargo(min[0])}) y el más alto, ${fmtOrig(max[2], g.moneda)}.`;
      if (cambios) txt += ` Cambió de precio ${cambios === 1 ? "una vez" : `${cambios} veces`}.`;
      return txt;
    };

    const out = [];
    let nIdx = 0;
    const inicioRegistro = Object.values(historial).reduce((m, t) => t[0]?.[0] && t[0][0] < m ? t[0][0] : m, hoy);
    // Relaciones confirmadas por Steam: ficha de cada appid y DLC en oferta de cada juego base
    const porAppid = new Map(), dlcDe = new Map();
    for (const f of fichasJuego.values()) {
      const i = fichas[f.clave];
      if (i?.appid) porAppid.set(String(i.appid), f);
      for (const g of f.ofertas) if (g.tienda === "xbox") porAppid.set(`x:${String(g.id).split(":")[1]}`, f);
    }
    for (const f of fichasJuego.values()) {
      const jb = fichas[f.clave]?.juegoBase;
      const b = jb?.appid ? String(jb.appid) : jb?.xbox ? `x:${jb.xbox}` : null;
      if (fichas[f.clave]?.tipo === "dlc" && b) (dlcDe.get(b) || dlcDe.set(b, []).get(b)).push(f);
    }
    for (const f of fichasJuego.values()) {
      const ofertas = f.ofertas.slice().sort((a, b) => ORDEN.indexOf(a.tienda) - ORDEN.indexOf(b.tienda));
      const info = fichas[f.clave] || {};
      const principal = ofertas.find((g) => g.tienda === "steam") || ofertas.slice().sort((a, b) => a.titulo.length - b.titulo.length)[0];
      const nombre = principal.titulo;
      const imagen = principal.imagen || ofertas.find((g) => g.imagen)?.imagen || null;
      const tiendas = [...new Set(ofertas.map((g) => TIENDAS_INFO[g.tienda].nombre))];
      const plataformas = [...new Set(ofertas.flatMap((g) => g.plataformas || []))];
      const esDlc = info.tipo === "dlc" || ofertas.every((g) => g.extra?.dlc);
      const claveBase = info.juegoBase?.appid ? String(info.juegoBase.appid) : info.juegoBase?.xbox ? `x:${info.juegoBase.xbox}` : null;
      const fichaBase = claveBase ? porAppid.get(claveBase) || null : null;
      const base = esDlc && claveBase ? { ...info.juegoBase, nombre: info.juegoBase.nombre || fichaBase?.ofertas[0]?.titulo || null, ficha: fichaBase,
        enlace: info.juegoBase.appid ? `https://store.steampowered.com/app/${info.juegoBase.appid}/` : `https://www.xbox.com/es-AR/games/store/juego/${info.juegoBase.xbox}` } : null;
      const infoBase = base?.ficha ? fichas[base.ficha.clave] || {} : {};
      // Un DLC solo cuenta con datos propios si su descripción no es la misma del juego base
      const tieneInfo = !(esDlc && info.descripcion && info.descripcion === infoBase.descripcion) && !!(info.descripcion || (info.desarrolladores?.length && (info.lanzamiento || info.lanzamientoTexto)));
      const histUtil = ofertas.some((g) => evaluar(historial[g.id] || []).util);
      const indexar = tieneInfo && histUtil;
      if (indexar) { out.push(f.url); nIdx++; }

      // Precio de hoy en cada tienda (el valor en pesos lo agrega juego.js con la cotización del día)
      const filasOferta = ofertas.map((g) => {
        const T = TIENDAS_INFO[g.tienda];
        const minExt = g.minHist && !g.gratis ? g.minHist : null;
        const minPropio = g.dias >= 3 && g.minimo != null ? g.minimo : null;
        const enMinimo = !g.gratis && ((minPropio != null && g.precio <= minPropio) || (minExt && g.precio <= minExt.precio * 1.01));
        return `<li class="j-of" data-precio="${g.gratis ? 0 : g.precio}" data-original="${g.original || 0}" data-moneda="${g.moneda}">
<div class="j-of-tienda"><span class="o-tienda" style="color:${T.color}">${T.nombre}</span>${(g.plataformas || []).map((p) => `<span class="o-plat">${e(p)}</span>`).join("")}${ofertas.filter((o) => o.tienda === g.tienda).length > 1 ? `<span class="j-of-ed">${e(g.titulo)}</span>` : ""}</div>
<div class="j-of-precio"><span class="j-ars-val">${g.gratis ? "Gratis" : fmtOrig(g.precio, g.moneda)}</span>${g.descuento ? `<span class="o-desc">-${g.descuento}%</span>` : ""}${!g.gratis && g.original > g.precio ? `<s>${fmtOrig(g.original, g.moneda)}</s>` : ""}<span class="j-ars-nota">${g.gratis ? "por tiempo limitado" : g.moneda === "ARS" ? "precio de la tienda, sin impuestos" : "precio de la tienda"}</span></div>
<ul class="j-datos">${g.fin_oferta ? `<li>Oferta hasta el ${finTxt(g.fin_oferta)}</li>` : ""}${enMinimo ? `<li><span class="o-min">Precio más bajo registrado</span></li>` : ""}${minExt ? `<li>Mínimo histórico: <b>${fmtOrig(minExt.precio, g.moneda)}</b>${minExt.fecha ? ` en ${mesAnio(minExt.fecha)}` : ""} (según el historial de ${e(minExt.fuente)})</li>` : ""}${minPropio != null && !enMinimo ? `<li>Mínimo que registramos: <b>${fmtOrig(minPropio, g.moneda)}</b> (en ${diasTxt(diasRegistro(historial[g.id] || []))} de seguimiento)</li>` : ""}${g.extra?.gamePass ? "<li>Incluido en Game Pass</li>" : ""}</ul>
<a class="j-btn" href="${e(g.url)}" rel="nofollow noopener sponsored" target="_blank">Ver en ${T.nombre}</a></li>`;
      }).join("\n");

      // Datos del juego, solo los que trae alguna fuente
      // Mismo estudio con dos nombres (por ejemplo, "Hazelight" y "Hazelight Studios"): se deja uno solo, el más completo
      const empresas = (xs) => {
        const clave = (n) => String(n).toLowerCase().replace(/[.,]/g, " ").replace(/\b(studios?|games|entertainment|interactive|inc|ltd|llc|gmbh|ab|co|corp|corporation|s ?a|s ?l|limited|software|publishing)\b/g, "").replace(/[^a-z0-9]+/g, "");
        const out = new Map();
        for (const n of xs || []) { const k = clave(n) || n; if (!out.has(k) || n.length > out.get(k).length) out.set(k, n); }
        return [...out.values()];
      };
      info.desarrolladores = empresas(info.desarrolladores); info.editores = empresas(info.editores);
      const datosJuego = [
        info.desarrolladores?.length ? ["Desarrolladora", lista(info.desarrolladores.map(e))] : null,
        info.editores?.length ? ["Editora", lista(info.editores.map(e))] : null,
        info.lanzamiento ? ["Lanzamiento", diaLargo(info.lanzamiento)] : info.lanzamientoTexto ? ["Lanzamiento", e(info.lanzamientoTexto)] : null,
        info.generos?.length ? ["Géneros", lista(generosDe(info).map(e))] : null,
        plataformas.length ? ["Plataformas en oferta", lista(plataformas.map(e))] : null,
        info.sistemas?.length ? ["Sistemas operativos (PC)", lista(info.sistemas.map(e))] : null,
        info.steamDeck ? ["Steam Deck", e(info.steamDeck)] : null,
        info.controles ? ["Mando", e(info.controles.replace(/ con mando$/, ""))] : null,
        info.edad ? ["Edad mínima (Steam)", `${info.edad} años`] : null,
      ].filter(Boolean);
      const steamR = info.resenasSteam;
      // Reseñas: una tarjeta por fuente, con su escala y qué mide cada una (no son comparables entre sí)
      const miles = (n) => Number(n).toLocaleString("es-AR");
      const coma = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
      const RES = {
        steam: (r) => ["Usuarios de Steam", `${r.puntaje}%`, "de reseñas positivas", `Porcentaje de compradores que lo recomiendan${r.cantidad ? `, sobre ${miles(r.cantidad)} reseñas` : ""}.`],
        metascore: (r) => ["Prensa (Metacritic)", `${r.puntaje}`, "/100", `Promedio ponderado de críticas de medios${r.cantidad ? ` (${miles(r.cantidad)} críticas)` : ""}.`],
        "metacritic user score": (r) => ["Usuarios de Metacritic", coma(r.puntaje / 10), "/10", `Promedio de votos del público en Metacritic${r.cantidad ? ` (${miles(r.cantidad)} votos)` : ""}.`],
        opencritic: (r) => ["Prensa (OpenCritic)", `${r.puntaje}`, "/100", `Promedio de críticas de medios${r.cantidad ? ` (${miles(r.cantidad)} críticas)` : ""}.`],
      };
      const resenasL = [
        info.resenaXbox ? ["Usuarios de Microsoft Store", coma(info.resenaXbox.puntaje), "/5", `Promedio de estrellas de compradores en Xbox (${miles(info.resenaXbox.cantidad)} valoraciones).`, null] : null,
        steamR && !(info.resenas || []).some((r) => /^steam$/i.test(r.fuente)) ? ["Usuarios de Steam", `${Math.round(steamR.positivas / steamR.total * 100)}%`, "de reseñas positivas", `Porcentaje de compradores que lo recomiendan, sobre ${miles(steamR.total)} reseñas.`, null] : null,
        ...(info.resenas || []).filter((r) => r.puntaje != null && RES[String(r.fuente).toLowerCase()])
          .map((r) => [...RES[String(r.fuente).toLowerCase()](r), /^https:\/\//.test(r.url || "") ? r.url : null]),
      ].filter(Boolean);
      const resenas = resenasL.length ? [`<div class="j-res-grid">${resenasL.map(([f, v, esc, nota, url]) => `<div class="j-res"><span class="j-res-f">${url ? `<a href="${e(url)}" rel="nofollow noopener" target="_blank">${e(f)}</a>` : e(f)}</span><span class="j-res-v">${e(v)}<small>${e(esc)}</small></span><span class="j-res-n">${e(nota)}</span></div>`).join("")}</div>`] : [];
      const fuentes = (info.fuentes || []).map((x) => x === "Steam" ? "la tienda de Steam" : x);
      // Los datos de Steam (idiomas, características, requisitos) son de la versión de PC: si el juego no está en oferta en Steam, se aclara
      const deSteamPC = !ofertas.some((g) => g.tienda === "steam") ? " (versión de PC en Steam)" : "";
      const hayPC = ofertas.some((g) => (g.plataformas || []).some((p) => /pc|windows/i.test(p)) || g.tienda === "steam" || g.tienda === "epic");
      const acercaLargo = (info.acerca || []).length > 1 ? info.acerca : null;
      const htmlBloques = (bs) => {
        let h = "", enLista = false;
        for (const [t, x] of bs) {
          if (t === "li" && !enLista) { h += "<ul>"; enLista = true; }
          if (t !== "li" && enLista) { h += "</ul>"; enLista = false; }
          h += t === "h" ? `<h3>${e(x)}</h3>` : t === "li" ? `<li>${e(x)}</li>` : `<p>${e(x)}</p>`;
        }
        return h + (enLista ? "</ul>" : "");
      };
      const idiomasOrd = (info.idiomas || []).slice().sort((a, b) => /^español/i.test(b.nombre) - /^español/i.test(a.nombre));
      const conSubs = idiomasOrd.some((x) => x.subtitulos != null);
      // Lo que ya está en el resumen de arriba (modos de juego) no se repite en la lista técnica
      const caracLista = (info.caracteristicas || []).filter((c) => !/^(un jugador|multijugador|cooperativo|coop\.|jcj|pantalla partida)/i.test(c) && !/^#|_/.test(c));
      const si = (v) => v ? '<span class="ok" aria-label="Sí">✓</span>' : '<span class="no" aria-label="No">✗</span>';
      // Lo primero que quiere saber alguien de Argentina: si está en español y cómo
      const esp = idiomasOrd.filter((x) => /^español/i.test(x.nombre));
      const resumenEs = !idiomasOrd.length ? "" : !esp.length ? `<p class="j-es j-es-no"><b>No tiene textos en español</b> según Steam.</p>`
        : `<p class="j-es">${esp.map((x) => `<b>${e(x.nombre)}:</b> ${lista(["textos", x.voces && "voces", x.subtitulos && "subtítulos"].filter(Boolean))}${x.voces ? "" : " (sin voces en español)"}`).join(" · ")}</p>`;
      const capturas = (info.capturas || []).filter((c) => /^https:\/\//.test(c.chica) && /^https:\/\//.test(c.grande));
      const req = hayPC && info.requisitos ? info.requisitos : null;
      const reqLista = (items) => `<ul>${items.map(([k, v]) => `<li>${k ? `<b>${e(k)}:</b> ` : ""}${e(String(v).replace(/\bor (better|higher|newer|greater|above)\b/gi, "o superior").replace(/\s+or\s+/gi, " o ").replace(/\s+and\s+/gi, " y "))}</li>`).join("")}</ul>`;
      const acerca = info.descripcion || info.resumenEn || datosJuego.length > 1 ? `<section class="j-acerca" aria-labelledby="j-acerca-tit">
<h2 id="j-acerca-tit">Sobre ${e(nombre)}</h2>
${info.descripcion ? `<p class="j-lead">${e(info.descripcion)}</p>` : info.resumenEn ? `<p class="j-lead" lang="en">${e(info.resumenEn)}</p><p class="mini">Resumen en inglés de IGDB: todavía no tenemos una descripción en español de una tienda.</p>` : ""}
${datosJuego.length ? `<dl class="j-ficha">${datosJuego.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>` : ""}
${resenas.length ? `<h3 class="j-res-tit">Reseñas y puntajes</h3>${resenas[0]}` : ""}
${info.avisoContenido ? `<p class="j-aviso"><b>Aviso de contenido de la editora:</b> ${e(info.avisoContenido)}</p>` : ""}
${info.etiquetas?.length ? `<p class="o-chips">${info.etiquetas.map((t) => `<span class="o-plat">${e(t)}</span>`).join("")}</p>` : ""}
${acercaLargo ? `<details class="j-mas"><summary>Leer la descripción completa</summary><div class="j-texto">${htmlBloques(acercaLargo)}</div></details>` : ""}
</section>` : "";
      const galeria = capturas.length ? `<section class="j-capturas" aria-labelledby="j-cap-tit">
<h2 id="j-cap-tit">Capturas de pantalla</h2>
<div class="j-galeria">${capturas.map((c, n) => `<a href="${e(c.grande)}" target="_blank" rel="noopener"><img src="${e(c.chica)}" alt="Captura de ${e(nombre)} (${n + 1})" width="600" height="338" loading="lazy" referrerpolicy="no-referrer"></a>`).join("")}</div>
</section>` : "";
      const caract = caracLista.length || idiomasOrd.length ? `<section class="j-car">
${caracLista.length ? `<div><h2 id="j-car-tit">Detalles técnicos${info.caracteristicasDe === "Xbox" ? " (Xbox)" : deSteamPC}</h2><ul class="j-lista">${caracLista.map((c) => `<li>${e(c)}</li>`).join("")}</ul></div>` : ""}
${idiomasOrd.length ? `<div><h2 id="j-idi-tit">Idiomas${deSteamPC}</h2>${resumenEs}<div class="j-idi-wrap"><table class="j-idi"><thead><tr><th>Idioma</th><th>Textos</th><th>Voces</th>${conSubs ? "<th>Subtítulos</th>" : ""}</tr></thead><tbody>${idiomasOrd.map((x) => `<tr${/^español/i.test(x.nombre) ? ' class="es"' : ""}><td>${e(x.nombre)}</td><td>${si(true)}</td><td>${si(x.voces)}</td>${conSubs ? `<td>${x.subtitulos == null ? '<span class="nd" title="Sin dato">–</span>' : si(x.subtitulos)}</td>` : ""}</tr>`).join("")}</tbody></table></div><p class="mini">Según la tienda de Steam. "Textos" es la interfaz y los menús; "Voces" indica audio completo en ese idioma.</p></div>` : ""}
</section>` : "";
      const requis = req && (req.minimo || req.recomendado) ? `<section class="j-req" aria-labelledby="j-req-tit">
<h2 id="j-req-tit">Requisitos del sistema para PC</h2>
<div class="j-req-cols">${req.minimo ? `<div><h3>Mínimos</h3>${reqLista(req.minimo)}</div>` : ""}${req.recomendado ? `<div><h3>Recomendados</h3>${reqLista(req.recomendado)}</div>` : ""}</div>
</section>` : "";
      // Videos: YouTube (IGDB) con carga al tocar; si no hay, los tráileres oficiales que la editora subió a Steam
      const yt = (info.youtube || []).filter((v) => /^[\w-]{11}$/.test(v.id));
      const trailers = yt.length ? [] : (info.trailers || []).filter((t) => /^https:\/\//.test(t.mp4 || t.webm || "") && /^https:\/\//.test(t.poster || ""));
      const videos = yt.length || trailers.length ? `<section class="j-videos" aria-labelledby="j-vid-tit">
<h2 id="j-vid-tit">Videos</h2>
<div class="j-vid-grid">${yt.map((v) => `<figure><button class="j-yt" type="button" data-id="${v.id}" aria-label="Reproducir ${e(v.nombre || "video")} de ${e(nombre)}"><img src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg" alt="" width="480" height="360" loading="lazy"><span class="j-play" aria-hidden="true"></span></button>${v.nombre ? `<figcaption>${e(v.nombre)}</figcaption>` : ""}</figure>`).join("")}${trailers.map((t) => `<figure><video controls preload="none" playsinline poster="${e(t.poster)}">${t.webm ? `<source src="${e(t.webm)}" type="video/webm">` : ""}${t.mp4 ? `<source src="${e(t.mp4)}" type="video/mp4">` : ""}</video>${t.nombre ? `<figcaption>${e(t.nombre)}</figcaption>` : ""}</figure>`).join("")}</div>
<p class="mini">${yt.length ? "Videos de YouTube listados en IGDB. Se cargan recién cuando tocás reproducir." : "Tráileres oficiales publicados en la tienda de Steam."}</p>
</section>` : "";
      // DLC y expansiones del juego: primero los que tienen ficha (en oferta), después el resto de la lista de Steam
      // Formato anterior guardaba el texto de Steam ("$11.99", siempre en dólares en Argentina)
      const precioDlc = (d) => d.usd ?? (d.precio && /\d/.test(d.precio) ? +d.precio.replace(/[^\d.,]/g, "").replace(",", ".") : null);
      const conFicha = !esDlc ? [...new Set([...(info.appid ? dlcDe.get(String(info.appid)) || [] : []),
        ...f.ofertas.filter((g) => g.tienda === "xbox").flatMap((g) => dlcDe.get(`x:${String(g.id).split(":")[1]}`) || [])])] : [];
      const xboxEnFicha = new Set(conFicha.flatMap((d) => d.ofertas.filter((g) => g.tienda === "xbox").map((g) => String(g.id).split(":")[1])));
      const otrosXbox = !esDlc ? (info.dlcXbox || []).filter((d) => !xboxEnFicha.has(d.id)) : [];
      const yaListados = new Set(conFicha.map((d) => String(fichas[d.clave]?.appid)));
      const otros = !esDlc ? (info.dlcLista || []).filter((d) => !yaListados.has(d.appid)) : [];
      // Cada complemento en su categoría, para no confundir una banda sonora o un cosmético con una expansión
      const itemsDlc = [
        ...conFicha.map((d) => { const o = d.ofertas[0]; return { nombre: o.titulo, usd: o.moneda === "USD" ? o.original || o.precio : null, html: `<li><a href="${d.url}">${e(o.titulo)}</a><span class="j-dlc-p"><span class="j-dlc-t">${d.ofertas.map((x) => TIENDAS_INFO[x.tienda].nombre).filter((v, i, a) => a.indexOf(v) === i).join(", ")}</span>${o.gratis ? "Gratis" : fmtOrig(o.precio, o.moneda)}${o.descuento ? ` <span class="o-desc">-${o.descuento}%</span>` : ""}</span></li>` }; }),
        ...otros.map((d) => ({ nombre: d.nombre, usd: d.descuento && precioDlc(d) != null ? precioDlc(d) / (1 - d.descuento / 100) : precioDlc(d), html: `<li><a href="https://store.steampowered.com/app/${e(d.appid)}/" rel="nofollow noopener" target="_blank">${e(d.nombre)}</a><span class="j-dlc-p"><span class="j-dlc-t">Steam</span>${d.gratis ? "Gratis" : precioDlc(d) != null ? `${fmtUsd(precioDlc(d))}${d.descuento ? ` <span class="o-desc">-${d.descuento}%</span>` : ""}` : "Sin precio por separado"}</span></li>` })),
        ...otrosXbox.map((d) => ({ nombre: d.nombre, html: `<li><a href="https://www.xbox.com/es-AR/games/store/dlc/${e(d.id)}" rel="nofollow noopener" target="_blank">${e(d.nombre)}</a><span class="j-dlc-p"><span class="j-dlc-t">Xbox, sin impuestos</span>${d.ars === 0 ? "Gratis" : d.ars != null ? `${fmt(d.ars)}${d.antes ? ` <s>${fmt(d.antes)}</s>` : ""}` : ""}</span></li>` })),
      ];
      const grupos = CATS_DLC.map(([k, tit, nota]) => [tit, nota, itemsDlc.filter((x) => categoriaDlc(x.nombre, x.usd) === k)]).filter(([, , xs]) => xs.length);
      const dlcSec = itemsDlc.length ? `<section class="j-dlc" aria-labelledby="j-dlc-tit">
<h2 id="j-dlc-tit">DLC, expansiones y extras</h2>
<p class="mini">Cada uno se compra aparte y requiere ${e(nombre)}. Sus precios no están incluidos en el del juego. Los agrupamos según su nombre en la tienda.</p>
${grupos.map(([tit, nota, xs]) => `<h3 class="j-dlc-cat">${tit} <small>${xs.length}</small></h3>${nota ? `<p class="mini">${nota}</p>` : ""}${xs.length > 8 ? `<details class="j-dlc-mas"><summary>Ver los ${xs.length}</summary>` : ""}<ul class="j-dlc-lista">${xs.map((x) => x.html).join("")}</ul>${xs.length > 8 ? "</details>" : ""}`).join("\n")}
${otros.length ? `<p class="mini">Los que no tienen ficha propia llevan a Steam, con su precio de hoy en Steam.${info.dlcTotal > (info.dlcLista || []).length ? ` Hay ${info.dlcTotal} en total: <a href="https://store.steampowered.com/dlc/${e(info.appid)}/" rel="nofollow noopener" target="_blank">ver todos en Steam</a>.` : ""}</p>` : ""}
</section>` : "";
      // Ediciones de Steam con su contenido exacto y la comparación contra comprar cada parte suelta
      const eds = !esDlc ? (info.ediciones || []).filter((x) => x.apps?.length) : [];
      const sueltos = info.sueltos || {};
      const comparar = (ed) => {
        if (ed.apps.length < 2 || ed.usd == null) return "";
        const partes = ed.apps.map((a) => sueltos[a.appid]);
        if (partes.some((p) => !p || (p.usd == null && !p.gratis))) return `<p class="j-cmp j-cmp-no">Incluye contenido que no se vende por separado en Steam, así que no se puede comparar con comprarlo suelto.</p>`;
        const suma = partes.reduce((t, p) => t + (p.gratis ? 0 : p.usd), 0);
        const dif = suma - ed.usd;
        if (Math.abs(dif) < 0.01) return `<p class="j-cmp">Cuesta lo mismo que comprar todo por separado (${fmtUsd(suma)}).</p>`;
        return dif > 0
          ? `<p class="j-cmp j-cmp-si">Por separado costaría <b>${fmtUsd(suma)}</b>: con la edición ahorrás <b>${fmtUsd(dif)}</b> (${Math.round(dif / suma * 100)}%).</p>`
          : `<p class="j-cmp j-cmp-no">Por separado costaría <b>${fmtUsd(suma)}</b>: la edición sale <b>${fmtUsd(-dif)}</b> más cara que comprar todo suelto.</p>`;
      };
      const unaSola = eds.length === 1;
      // A veces Steam lista todas las ediciones con solo el juego base (el extra viene adentro del juego): ahí no hay
      // contenido para mostrar, así que se compara el precio contra la más barata y se avisa que Steam no lo detalla
      const firma = (ed) => ed.apps.map((a) => a.appid).sort().join(",");
      const sinDetalle = eds.length > 1 && eds.every((ed) => firma(ed) === firma(eds[0]));
      const baseEd = sinDetalle ? eds.filter((ed) => ed.usd != null).sort((a, b) => a.usd - b.usd)[0] : null;
      const mejoras = (info.dlcLista || []).filter((d) => /upgrade|mejora/i.test(d.nombre));
      const edSec = eds.length ? `<section class="j-ed" id="ediciones" aria-labelledby="j-ed-tit">
<h2 id="j-ed-tit">${unaSola ? "Qué incluye la compra en Steam" : sinDetalle ? "Ediciones en Steam" : "Ediciones en Steam y qué incluye cada una"}</h2>
${unaSola ? `<p class="mini">En Steam se vende en una sola edición${eds[0].apps.length > 1 ? `, que trae ${eds[0].apps.length} productos` : ""}.${info.dlcTotal ? " Los DLC y expansiones se compran aparte (más abajo)." : ""}</p>` : ""}
<div class="j-ed-grid">${eds.map((ed) => `<div class="j-ed-card"><h3>${e(ed.nombre)}</h3>
${ed.usd != null ? `<p class="j-ed-precio"><b>${ed.usd === 0 ? "Gratis" : fmtUsd(ed.usd)}</b>${ed.descuento ? ` <span class="o-desc">-${ed.descuento}%</span> <s>${fmtUsd(ed.antes)}</s>` : ""}</p>` : ""}
${sinDetalle ? (baseEd && ed !== baseEd && ed.usd != null ? `<p class="j-cmp">Cuesta <b>${fmtUsd(ed.usd - baseEd.usd)}</b> más que ${e(baseEd.nombre)}.</p>` : ed === baseEd ? `<p class="j-cmp">La opción más barata.</p>` : "")
  + (() => { const m = mejoras.find((d) => (ed.nombre.match(/deluxe|premium|ultimate|gold|complete|definitive|collector|special/i) || [""])[0] && d.nombre.toLowerCase().includes(ed.nombre.match(/deluxe|premium|ultimate|gold|complete|definitive|collector|special/i)[0].toLowerCase())); return m && precioDlc(m) != null ? `<p class="mini">Si ya tenés la estándar: <a href="https://store.steampowered.com/app/${e(m.appid)}/" rel="nofollow noopener" target="_blank">${e(m.nombre)}</a> cuesta ${fmtUsd(precioDlc(m))}.</p>` : ""; })()
  : `<ul>${ed.apps.map((a) => `<li>${e(a.nombre)}${String(a.appid) === String(info.appid) ? ' <span class="j-base">juego base</span>' : ""}${sueltos[a.appid]?.usd != null && ed.apps.length > 1 ? ` <span class="j-suelto">${fmtUsd(sueltos[a.appid].usd)} suelto</span>` : ""}</li>`).join("")}</ul>
${comparar(ed)}`}</div>`).join("")}</div>
${sinDetalle ? `<p class="mini">Steam no detalla qué agrega cada edición: el contenido extra viene incluido dentro del juego. Antes de elegir, mirá la lista en la <a href="https://store.steampowered.com/app/${e(info.appid)}/" rel="nofollow noopener" target="_blank">página del juego en Steam</a>.</p>` : ""}
<p class="mini">Contenido y precios de hoy en la tienda de Steam para Argentina (en dólares).${unaSola || sinDetalle ? "" : " Solo comparamos cuando cada parte de la edición se vende suelta en la misma tienda."}</p>
</section>` : "";
      const pieFuentes = fuentes.length ? `<p class="mini j-fuentes">Datos del juego: ${lista(fuentes)}. Los textos y capturas son de la tienda y de su editora.</p>` : "";

      // Historial de cada tienda: resumen en texto + gráfico + tabla
      // Si todas las tiendas tienen pocos días, un solo aviso arriba (en vez de repetirlo en cada tienda)
      const todasNuevas = ofertas.every((g) => diasRegistro(historial[g.id] || []) < GRAFICO_DIAS);
      const minsExt = ofertas.filter((g) => g.minHist && !g.gratis).map((g) => `${TIENDAS_INFO[g.tienda].nombre}: ${fmtOrig(g.minHist.precio, g.moneda)}${g.minHist.fecha ? ` (${mesAnio(g.minHist.fecha)}, según ${e(g.minHist.fuente)})` : ` (según ${e(g.minHist.fuente)})`}`);
      const avisoNuevo = todasNuevas ? `<p class="j-nuevo"><b>Historial nuevo: llevamos ${diasTxt(Math.max(1, ...ofertas.map((g) => diasRegistro(historial[g.id] || []))))} registrando ${ofertas.length > 1 ? "estos precios" : "este precio"}.</b> El gráfico aparece cuando juntemos al menos ${GRAFICO_DIAS} días.${minsExt.length ? ` Como referencia de largo plazo, el mínimo histórico externo es ${lista(minsExt)}.` : ""}</p>` : "";
      const hist = ofertas.map((g) => {
        const T = TIENDAS_INFO[g.tienda], tramos = historial[g.id] || [];
        const tit = `Historial de precio en ${T.nombre}${ofertas.filter((o) => o.tienda === g.tienda).length > 1 ? ` (${e(g.titulo)})` : ""}`;
        if (!tramos.length) return `<div class="j-hist-t"><h3>${tit}</h3><p class="j-nuevo"><b>Recién empezamos a seguir este precio.</b> Todavía no tenemos ningún día registrado en ${T.nombre}.</p></div>`;
        const filas = tramos.slice().reverse().map(([d, h, p]) => `<tr><td>${diaLargo(d)}</td><td>${h ? diaLargo(h) : "Sigue hoy"}</td><td class="num">${fmtOrig(p, g.moneda)}</td></tr>`).join("");
        const n = diasRegistro(tramos);
        const minExt = g.minHist && !g.gratis ? g.minHist : null;
        // Con pocos días no se dibuja el gráfico: se dice claramente que el registro propio recién empieza
        const nuevo = todasNuevas ? " " : n < GRAFICO_DIAS ? `<p class="j-nuevo"><b>Historial nuevo: llevamos ${diasTxt(n)} registrando este precio</b> (desde el ${diaLargo(tramos[0][0])}). El gráfico aparece cuando juntemos al menos ${GRAFICO_DIAS} días.${minExt ? ` Para una referencia de más largo plazo, el mínimo histórico de ${e(minExt.fuente)} es ${fmtOrig(minExt.precio, g.moneda)}${minExt.fecha ? ` (${mesAnio(minExt.fecha)})` : ""}.` : ""}</p>` : "";
        return `<div class="j-hist-t"><h3>${tit}</h3><p>${resumen(tramos, g, T)}</p>
${nuevo.trim() ? nuevo : nuevo ? "" : `<div class="j-chart" data-tramos='${e(JSON.stringify(tramos))}' data-moneda="${g.moneda}" data-original="${g.original || 0}"></div>`}
${tramos.length > 1 ? `<details class="j-tabla"><summary>Ver los datos en una tabla</summary><table><thead><tr><th>Desde</th><th>Hasta</th><th class="num">Precio</th></tr></thead><tbody>${filas}</tbody></table></details>` : ""}</div>`;
      }).join("\n");

      // Resumen rápido cerca del título (modo de juego, español, Steam Deck); el detalle técnico completo queda más abajo
      const modos = modosDe(info);
      const resumenRapido = [
        ...modos.map((m) => `<li>${e(m)}</li>`),
        esp.length ? `<li class="ok">${esp.some((x) => x.voces) ? "Voces en español" : "Textos en español"}</li>` : idiomasOrd.length ? `<li class="no">Sin español</li>` : "",
        info.steamDeck && info.steamDeck !== "No compatible" ? `<li>Steam Deck: ${e(info.steamDeck.toLowerCase())}</li>` : "",
      ].filter(Boolean);
      const resumenHtml = resumenRapido.length ? `<ul class="j-rapido" aria-label="Resumen">${resumenRapido.join("")}</ul>` : "";
      // Índice de la ficha: solo las secciones que tienen datos
      const indice = [[acerca, "j-acerca-tit", "Sobre el juego"], [videos, "j-vid-tit", "Videos"], [galeria, "j-cap-tit", "Capturas"],
        [idiomasOrd.length, "j-idi-tit", "Idiomas"], [requis, "j-req-tit", "Requisitos"], [edSec, "j-ed-tit", unaSola ? "Qué incluye" : "Ediciones"],
        [dlcSec, "j-dlc-tit", "DLC"], [true, "j-hist-tit", "Historial de precios"]].filter(([x]) => x);
      const indiceHtml = indice.length > 2 ? `<nav class="j-indice" aria-label="Secciones de la ficha">${indice.map(([, id, t]) => `<a href="#${id}">${t}</a>`).join("")}</nav>` : "";
      const cuerpo = `<nav class="migas" aria-label="Ubicación"><a href="/ofertas/">Ofertas</a> › ${ofertas.length === 1 ? `<a href="/ofertas/${ofertas[0].tienda}/">${TIENDAS_INFO[ofertas[0].tienda].nombre}</a> › ` : ""}<span>${e(nombre)}</span></nav>
<article class="juego">
<div class="j-top">
<div class="j-img"><img src="${e(imagen || "/assets/portada.svg")}" onerror="this.onerror=null;this.src='/assets/portada.svg'" alt="${e(nombre)}" referrerpolicy="no-referrer" width="460" height="215"></div>
<div class="j-info">
${esDlc ? `<p class="j-tipo">${{ ost: "Banda sonora (no agrega contenido jugable)", extra: "Extra cosmético o adicional (DLC)", exp: "Expansión (DLC)", pack: "Pack de contenido (DLC)", jug: "Contenido descargable jugable (DLC)" }[categoriaDlc(nombre, ofertas[0].moneda === "USD" ? ofertas[0].original || ofertas[0].precio : null)]}</p>` : ""}<h1>${e(nombre)}</h1>
${base ? `<p class="j-requiere"><b>Requiere el juego base:</b> ${base.ficha ? `<a href="${base.ficha.url}">${e(base.nombre || "ver juego")}</a>` : `<a href="${e(base.enlace)}" rel="nofollow noopener" target="_blank">${e(base.nombre || "ver el juego en la tienda")}</a>`}. Este precio es solo del DLC.</p>` : esDlc ? `<p class="j-requiere">Es un contenido descargable: necesitás el juego base para usarlo. Este precio es solo del DLC.</p>` : ""}
${resumenHtml}<p class="j-sub">${ofertas.length > 1 ? `En oferta en ${lista(tiendas)}. Compará el precio de cada tienda en pesos con impuestos.` : `En oferta en ${tiendas[0]}.`}</p>
<ul class="j-ofertas">
${filasOferta}
</ul>
</div>
</div>
${indiceHtml}
${indexar ? anuncio : ""}
${acerca}
${videos}
${galeria}
${caract}
${requis}
${edSec}
${dlcSec}
${pieFuentes}
<section class="j-hist" aria-labelledby="j-hist-tit">
<h2 id="j-hist-tit">Historial de precios</h2>
<p class="mini">Es nuestro propio registro: anotamos el precio de cada tienda todos los días que el juego está en oferta (los días sin oferta quedan en blanco). Empezamos a registrar el ${diaLargo(inicioRegistro)}, así que todavía cubre ${diasTxt(dnum(hoy) - dnum(inicioRegistro) + 1)} como máximo. Los mínimos históricos de años anteriores vienen de IsThereAnyDeal y CheapShark, y se indica en cada caso.</p>
${avisoNuevo}
${hist}
</section>
<aside class="o-metodo"><h2>Cómo calculamos el precio en pesos</h2><p class="mini">Tomamos el precio de la tienda, lo pasamos con el dólar oficial del día (salvo Xbox, que ya está en pesos) y le sumamos IVA ${pct(imp.iva)}% y percepción ${pct(imp.percepcion)}%. Es una estimación: el precio final lo define tu banco.</p></aside>
<p>${[...new Set(ofertas.map((g) => g.tienda))].map((t) => `<a href="/ofertas/${t}/">Ver todas las ofertas de ${TIENDAS_INFO[t].nombre}</a>`).join(" · ")}</p>
</article>
<script src="/assets/juego.js" defer></script>`;

      // Datos estructurados: solo lo que se muestra en la página y viene de una fuente
      const conPrecio = ofertas.filter((g) => !g.gratis && g.precio > 0);
      const ld = {
        "@context": "https://schema.org", "@type": "VideoGame", name: nombre, url: cfg.sitio.url + f.url,
        ...(imagen ? { image: [imagen, ...capturas.slice(0, 4).map((c) => c.grande)] } : {}),
        ...(idiomasOrd.length ? { inLanguage: idiomasOrd.map((x) => x.nombre) } : {}),
        ...(info.descripcion ? { description: info.descripcion } : {}),
        ...(plataformas.length ? { gamePlatform: plataformas } : {}),
        ...(info.generos?.length ? { genre: generosDe(info) } : {}),
        ...(info.desarrolladores?.length ? { author: info.desarrolladores.map((n) => ({ "@type": "Organization", name: n })) } : {}),
        ...(info.editores?.length ? { publisher: info.editores.map((n) => ({ "@type": "Organization", name: n })) } : {}),
        ...(info.lanzamiento ? { datePublished: info.lanzamiento } : {}),
        ...(base?.ficha ? { isPartOf: { "@type": "VideoGame", name: base.nombre || undefined, url: cfg.sitio.url + base.ficha.url } } : {}),
        ...(conFicha.length ? { hasPart: conFicha.map((d) => ({ "@type": "VideoGame", name: d.ofertas[0].titulo, url: cfg.sitio.url + d.url })) } : {}),
        ...(conPrecio.length ? { offers: conPrecio.map((g) => ({ "@type": "Offer", price: g.precio, priceCurrency: g.moneda, url: g.url,
          availability: "https://schema.org/InStock", seller: { "@type": "Organization", name: TIENDAS_INFO[g.tienda].nombre },
          ...(g.fin_oferta ? { priceValidUntil: g.fin_oferta.slice(0, 10) } : {}) })) } : {}),
      };
      const migasLd = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ofertas", item: cfg.sitio.url + "/ofertas/" },
        { "@type": "ListItem", position: 2, name: nombre, item: cfg.sitio.url + f.url }] };
      const ldTxt = indexar ? [ld, migasLd].map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join("") : "";

      const masBarata = conPrecio.length ? conPrecio.reduce((a, g) => (g.moneda === "USD" && a.moneda === "USD" && g.precio < a.precio) ? g : a) : null;
      const desc = [
        `${nombre}${esDlc ? `, contenido descargable${base?.nombre ? ` de ${base.nombre}` : ""},` : ""} en oferta en ${lista(tiendas)}${masBarata && conPrecio.every((g) => g.moneda === masBarata.moneda) ? `: desde ${fmtOrig(masBarata.precio, masBarata.moneda)}${masBarata.descuento ? ` (-${masBarata.descuento}%)` : ""}` : ""}.`,
        info.generos?.length ? `${lista(generosDe(info).slice(0, 2))}${info.desarrolladores?.length ? ` de ${info.desarrolladores[0]}` : ""}.` : "",
        "Historial de precios, mínimo histórico y precio estimado en pesos con impuestos.",
      ].filter(Boolean).join(" ");
      escribir(f.url.slice(1) + "index.html", pagina({
        titulo: `${nombre}${esDlc && base?.nombre ? ` (DLC de ${base.nombre})` : esDlc ? " (DLC)" : ""}: precio en Argentina e historial${ofertas.length > 1 ? "" : ` en ${tiendas[0]}`} | ${cfg.sitio.nombre}`,
        desc, canon: f.url, cuerpo, indexar, seguir: true, ads: indexar, extraHead: ldTxt,
        og: imagen ? `<meta property="og:image" content="${e(imagen)}">` : "" }));
    }
    console.log(`Fichas de juegos: ${fichasJuego.size} (${nIdx} indexables).`);
    return out;
  }
}
