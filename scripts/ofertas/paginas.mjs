// Páginas de ofertas en vivo: /ofertas/ (resumen) y /ofertas/<tienda>/ (listado completo con filtros)
import { leerJSON, ruta } from "../lib/util.mjs";

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

  const tarjeta = (g, i = 0) => {
    const T = TIENDAS_INFO[g.tienda];
    const img2 = g.extra?.img2 ? ` onerror="this.onerror=null;this.src='${e(g.extra.img2)}'"` : "";
    const precio = g.gratis ? `<span class="o-precio">Gratis</span>` : g.ars != null ? `<span class="o-precio">${fmt(g.ars)}</span>` : `<span class="o-precio">${fmtOrig(g.precio, g.moneda)}</span>`;
    const detalle = g.gratis ? (g.original ? `<span class="o-antes">${fmtOrig(g.original, g.moneda)}</span>` : "")
      : `${g.arsOrig != null && g.original > g.precio ? `<span class="o-antes">${fmt(g.arsOrig)}</span>` : ""}${g.ars != null ? `<span class="o-base">${fmtOrig(g.precio, g.moneda)} en la tienda</span>` : ""}`;
    const chips = (g.plataformas || []).map((p) => `<span class="o-plat">${e(p)}</span>`).join("");
    const minExt = g.minHist && !g.gratis ? g.minHist : null;
    const enMinimo = g.minimoReal || (minExt && g.precio <= minExt.precio);
    const badges = [enMinimo ? `<span class="o-min">Precio más bajo registrado</span>` : "", g.extra?.gamePass ? `<span class="o-gp">En Game Pass</span>` : ""].join("");
    const fin = g.extra?.proximamente ? `Gratis desde el ${finTxt(g.extra.desde)}` : g.fin_oferta ? `Hasta el ${finTxt(g.fin_oferta)}` : "";
    return `<article class="o-card" data-t="${e(g.titulo.toLowerCase())}" data-d="${g.descuento || 0}" data-p="${g.gratis ? 0 : Math.round(g.ars ?? g.precio)}" data-pl="${e((g.plataformas || []).join("|"))}">
<a href="${e(g.url)}" rel="nofollow noopener sponsored" target="_blank"><div class="o-img"><img src="${e(g.imagen || "/assets/portada.svg")}"${img2} alt="" loading="${i < 6 ? "eager" : "lazy"}" referrerpolicy="no-referrer">${g.descuento ? `<span class="o-desc">-${g.descuento}%</span>` : ""}</div>
<div class="o-txt"><h3>${e(g.titulo)}</h3><p class="o-chips"><span class="o-tienda" style="color:${T.color}">${T.nombre}</span>${chips}</p>
<p class="o-precios">${precio}${detalle}</p>${badges ? `<p class="o-badges">${badges}</p>` : ""}${minExt && !enMinimo ? `<p class="o-hist">Mínimo histórico: ${fmtOrig(minExt.precio, g.moneda)}${minExt.fecha ? ` (${new Intl.DateTimeFormat("es-AR", { month: "short", year: "numeric" }).format(new Date(minExt.fecha))})` : ""}</p>` : ""}${fin ? `<p class="o-fin">${fin}</p>` : ""}<span class="o-btn">Ver en ${T.nombre}</span></div></a></article>`;
  };

  const pct = (x) => Math.round((x || 0) * 100);
  const horaTxt = (iso) => iso ? new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "";
  const diaTxt = (iso) => iso ? new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long" }).format(new Date(iso)) : "";
  const actualizadoEl = (iso) => iso ? `<p class="o-upd"><span class="o-upd-dot" aria-hidden="true"></span><span>Precios actualizados el <time datetime="${iso}">${horaTxt(iso)}</time> h (hora de Argentina)</span></p>` : "";
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
    const controles = `<div class="o-ctrl" role="search"><input type="search" id="o-q" placeholder="Buscar en ${lista.length} ofertas de ${T.nombre}…" aria-label="Buscar juego">
<select id="o-ord" aria-label="Ordenar"><option value="">Más populares</option><option value="d">Mayor descuento</option><option value="p">Menor precio</option><option value="pd">Mayor precio</option><option value="t">Nombre (A-Z)</option></select>
<select id="o-dm" aria-label="Descuento mínimo"><option value="0">Cualquier descuento</option><option value="50">50% o más</option><option value="75">75% o más</option><option value="90">90% o más</option></select>
<span class="o-rango"><input type="number" id="o-pmin" inputmode="numeric" min="0" step="1000" placeholder="Precio mín. $" aria-label="Precio mínimo en pesos"><input type="number" id="o-pmax" inputmode="numeric" min="0" step="1000" placeholder="Precio máx. $" aria-label="Precio máximo en pesos"></span>
${plats.length > 1 ? `<select id="o-pl" aria-label="Plataforma"><option value="">Todas las plataformas</option>${plats.map((p) => `<option>${e(p)}</option>`).join("")}</select>` : ""}
<span id="o-n" class="o-n" aria-live="polite"></span></div>`;
    const cuerpo = `${navTiendas(k)}<h1 class="sec-tit">Ofertas de ${T.nombre} en pesos argentinos</h1><p class="o-intro">${e(T.intro)}</p>${actualizadoEl(datos.estado?.[k]?.fecha || datos.actualizado)}${caido(k)}
${proximos.length ? `<h2 class="o-h2">Próximamente gratis</h2><div class="o-grilla">${proximos.map(tarjeta).join("")}</div>` : ""}
${lista.length ? `${proximos.length ? `<h2 class="o-h2">Todas las ofertas</h2>` : ""}${controles}<div class="o-grilla" id="o-lista">${lista.map(tarjeta).join("")}</div><p class="vacio o-sin" id="o-sin" hidden>No hay ofertas con esos filtros. Probá con otro descuento o rango de precio.</p>` : `<p class="vacio">Todavía no hay ofertas cargadas de ${T.nombre}. Volvé en un rato.</p>`}
${notaPrecios}${k === "epic" ? `<p class="mini">Descuentos de Epic vía <a href="https://www.cheapshark.com" rel="noopener" target="_blank">CheapShark</a> (precios de referencia en dólares, pueden variar en Argentina).</p>` : ""}
${anuncio}${faqHtml(T)}
<script>(()=>{const L=document.getElementById("o-lista");if(!L)return;const C=[...L.children],q=document.getElementById("o-q"),o=document.getElementById("o-ord"),pl=document.getElementById("o-pl"),n=document.getElementById("o-n"),dm=document.getElementById("o-dm"),pmin=document.getElementById("o-pmin"),pmax=document.getElementById("o-pmax");
const f=()=>{const t=q.value.trim().toLowerCase(),p=pl?pl.value:"",s=o.value,d=+dm.value,mn=pmin.value===""?0:+pmin.value,mx=pmax.value===""?Infinity:+pmax.value;let v=C.filter(c=>(!t||c.dataset.t.includes(t))&&(!p||c.dataset.pl.split("|").includes(p))&&+c.dataset.d>=d&&+c.dataset.p>=mn&&+c.dataset.p<=mx);
const by={d:(a,b)=>b.dataset.d-a.dataset.d,p:(a,b)=>a.dataset.p-b.dataset.p,pd:(a,b)=>b.dataset.p-a.dataset.p,t:(a,b)=>a.dataset.t.localeCompare(b.dataset.t)}[s];
if(by)v=[...v].sort(by);else v=C.filter(c=>v.includes(c));C.forEach(c=>c.hidden=true);v.forEach(c=>{c.hidden=false;L.appendChild(c)});n.textContent=v.length===1?"1 oferta":v.length+" ofertas";document.getElementById("o-sin").hidden=v.length>0;};
[q,o,pl,dm,pmin,pmax].forEach(x=>x&&x.addEventListener("input",f));f();})();</script>`;
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
  const mejores = Object.keys(TIENDAS_INFO).flatMap((k) => porTienda(k).filter((g) => !g.gratis && g.descuento).slice(0, 40)
    .sort((a, b) => b.descuento - a.descuento).slice(0, 2)).sort((a, b) => b.descuento - a.descuento);
  const cuerpo = `${navTiendas(null)}<h1 class="sec-tit">Ofertas de juegos hoy: Steam, Epic, Xbox y PlayStation en pesos</h1>
<p class="o-intro">Juntamos ${total ? `${total.toLocaleString("es-AR")} ofertas vigentes` : "las ofertas vigentes"} de las cuatro tiendas grandes y les calculamos el precio en pesos con impuestos, para que compares sin hacer cuentas. Se actualiza solo varias veces por día.</p>${actualizadoEl(datos.actualizado)}
${mejores.length ? `<section class="o-sec o-top"><h2 class="o-h2">Mejores ofertas de hoy</h2><p class="o-sub">Los dos descuentos más grandes de cada tienda entre sus 40 juegos más populares.</p><div class="o-grilla">${mejores.map(tarjeta).join("")}</div></section>` : ""}
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

  return ["/ofertas/", ...Object.keys(TIENDAS_INFO).map((k) => `/ofertas/${k}/`)];
}
