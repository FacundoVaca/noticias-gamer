// Páginas extra del sitio: guías fijas de Soluciones, juegos gratis de la semana y calculadora de precios en pesos.
// Las llama build.mjs y devuelven las URLs para el sitemap.
import path from "node:path";
import { leerJSON, ruta } from "../lib/util.mjs";

const PLAT_TXT = { PC: "PC", PlayStation: "PlayStation", Xbox: "Xbox", Nintendo: "Nintendo" };

export function cargarSoluciones() {
  return leerJSON(ruta("content", "soluciones.json"), []);
}

// Notas automáticas que también van en Soluciones: las marcadas como problema y las que hablan de errores o cierres
export const esProblema = (n) => n.tipo === "problema" ||
  /\b(error|errores|crash|cuelgue|cuelgues|se cierra|se cuelga|no funciona|no inicia|no abre|caída de servidores|servidores caídos)\b/i.test(n.titulo);

export function generarSoluciones({ cfg, pagina, escribir, e, fechaLarga, anuncio, cuerpoHTML, tarjeta, problemas }) {
  const S = cfg.sitio;
  const guias = cargarSoluciones();
  const urls = [];
  for (const g of guias) {
    const url = `/soluciones/${g.slug}/`;
    const otras = guias.filter((o) => o !== g).sort((a, b) => (b.plataforma === g.plataforma) - (a.plataforma === g.plataforma)).slice(0, 3);
    const ld = [{
      "@context": "https://schema.org", "@type": "Article", headline: g.titulo, description: g.bajada,
      datePublished: g.actualizada, dateModified: g.actualizada, inLanguage: S.idioma, mainEntityOfPage: `${S.url}${url}`,
      author: { "@type": "Organization", name: `Redacción ${S.nombre}`, url: `${S.url}/acerca/` },
      publisher: { "@type": "Organization", name: S.nombre, logo: { "@type": "ImageObject", url: `${S.url}/assets/favicon.svg` } },
    }];
    if (g.preguntas?.length) ld.push({ "@context": "https://schema.org", "@type": "FAQPage",
      mainEntity: g.preguntas.map((q) => ({ "@type": "Question", name: q.p, acceptedAnswer: { "@type": "Answer", text: q.r } })) });
    const cuerpo = `<article class="nota">
<p class="migas"><a href="/">Inicio</a> › <a href="/soluciones/">Soluciones</a></p>
<h1>${e(g.titulo)}</h1><p class="bajada">${e(g.bajada)}</p>
<p class="meta"><span class="formato formato-guia">Guía</span> ${e(PLAT_TXT[g.plataforma] || g.plataforma)} · Actualizada: <time datetime="${g.actualizada}">${fechaLarga(g.actualizada)}</time></p>
<div class="texto">${cuerpoHTML(g.cuerpo)}</div>
${g.preguntas?.length ? `<section class="faq"><h2>Preguntas frecuentes</h2>${g.preguntas.map((q) => `<details><summary>${e(q.p)}</summary><p>${e(q.r)}</p></details>`).join("")}</section>` : ""}
<p class="mini">Guía escrita por ${e(S.nombre)} con pasos generales y seguros. Si tu consola o PC está en garantía, ante una falla de hardware consultá primero con el servicio técnico oficial. ¿Viste un error? <a href="/contacto/">Avisanos</a>.</p>
</article>${anuncio}
${otras.length ? `<section class="relacionadas"><h2>Otras soluciones</h2><ul class="sol-lista">${otras.map((o) => `<li><a href="/soluciones/${o.slug}/"><strong>${e(o.titulo)}</strong><span>${e(o.bajada)}</span></a></li>`).join("")}</ul></section>` : ""}`;
    escribir(path.join("soluciones", g.slug, "index.html"), pagina({ titulo: `${g.titulo} | ${S.nombre}`, desc: g.bajada, canon: url, cuerpo,
      og: `<meta property="og:type" content="article">`,
      extraHead: ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join("") }));
    urls.push([url, g.actualizada]);
  }

  // Portada de Soluciones: guías fijas por plataforma + notas de problemas reportados
  const porPlat = Object.keys(PLAT_TXT).map((p) => [p, guias.filter((g) => g.plataforma === p)]).filter(([, l]) => l.length);
  const cuerpo = `<h1 class="sec-tit">Soluciones a errores y fallas</h1>
<p class="sol-intro">Guías paso a paso para los problemas más comunes de PC y consolas, y las fallas que se reportan en los juegos nuevos.</p>
${porPlat.map(([p, l]) => `<h2 class="o-h2">${e(PLAT_TXT[p])}</h2><ul class="sol-lista">${l.map((g) => `<li><a href="/soluciones/${g.slug}/"><strong>${e(g.titulo)}</strong><span>${e(g.bajada)}</span></a></li>`).join("")}</ul>`).join("")}
${anuncio}
${problemas.length ? `<h2 class="o-h2">Problemas reportados en juegos</h2><div class="grilla">${problemas.slice(0, 24).map((n) => tarjeta(n)).join("")}</div>` : ""}`;
  escribir("soluciones/index.html", pagina({ titulo: `Soluciones a errores y fallas de juegos | ${S.nombre}`,
    desc: "Errores, cuelgues y caídas de juegos y consolas, con pasos para solucionarlos en PC, PlayStation, Xbox y Nintendo Switch.", canon: "/soluciones/", cuerpo }));
  return urls;
}

// ---------- Juegos gratis ----------
const fechaCortaAr = (iso) => {
  const d = new Date(iso);
  return isNaN(d) ? "" : new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "long" }).format(d);
};

export function generarGratis({ cfg, pagina, escribir, e, fechaLarga, anuncio }) {
  const S = cfg.sitio;
  const ofertas = leerJSON(ruta("data", "ofertas-juegos.json"), { juegos: [] });
  const extra = leerJSON(ruta("data", "gratis.json"), { juegos: [] });
  const ahora = Date.now();
  // Epic sale de los datos de ofertas (feed oficial); el resto de tiendas, de GamerPower (data/gratis.json)
  const epic = ofertas.juegos.filter((g) => g.gratis && g.tienda === "epic");
  const items = [
    ...epic.map((g) => ({ titulo: g.titulo, tienda: "Epic Games", imagen: g.imagen, url: g.url, valor: g.original ? `US$${g.original}` : "",
      hasta: g.fin_oferta, desde: g.extra?.desde, proximo: !!g.extra?.proximamente })),
    ...(extra.juegos || []).filter((g) => !/epic/i.test(g.tienda)).map((g) => ({ ...g, proximo: false })),
  ].filter((g) => !g.hasta || new Date(g.hasta).getTime() > ahora);
  const vistos = new Set();
  const unicos = items.filter((g) => { const k = (g.titulo + g.tienda).toLowerCase(); if (vistos.has(k)) return false; vistos.add(k); return true; });
  const ya = unicos.filter((g) => !g.proximo), prox = unicos.filter((g) => g.proximo);
  const card = (g) => `<article class="o-card"><a class="o-link" href="${e(g.url)}" rel="nofollow noopener" target="_blank"><div class="o-img"><img src="${e(g.imagen || "/assets/portada.svg")}" alt="" loading="lazy" referrerpolicy="no-referrer"><span class="o-desc">Gratis</span></div>
<div class="o-txt"><h3>${e(g.titulo)}</h3><p class="o-chips"><span class="o-tienda">${e(g.tienda)}</span></p>
${g.valor ? `<p class="o-precios"><span class="o-precio">Gratis</span><span class="o-antes">${e(g.valor)}</span></p>` : ""}
<p class="o-fin">${g.proximo && g.desde ? `Gratis desde el ${fechaCortaAr(g.desde)}` : g.hasta ? `Hasta el ${fechaCortaAr(g.hasta)}` : "Por tiempo limitado"}</p></div></a>
<a class="o-btn" href="${e(g.url)}" rel="nofollow noopener" target="_blank">Conseguirlo en ${e(g.tienda)}</a></article>`;
  const preguntas = [
    ["¿Los juegos gratis se quedan para siempre?", "Sí, en la mayoría de los casos. Si lo agregás a tu cuenta mientras está gratis (en Epic Games, Steam, GOG y otras), queda en tu biblioteca aunque después vuelva a costar plata."],
    ["¿Cuándo cambian los juegos gratis de Epic?", "Epic Games regala uno o más juegos por semana. El cambio es los jueves a las 13 h de Argentina."],
    ["¿Necesito tarjeta para conseguirlos?", "No. Solo necesitás una cuenta gratuita en la tienda. Algunas, como Prime Gaming, piden tener la suscripción."],
  ];
  const cuerpo = `<h1 class="sec-tit">Juegos gratis esta semana</h1>
<p class="sol-intro">Juegos que podés quedarte gratis por tiempo limitado en Epic Games, Steam, GOG, itch.io, IndieGala y otras tiendas. Actualizado varias veces por día${extra.actualizado ? `, la última el ${fechaLarga(extra.actualizado)}` : ""}.</p>
${ya.length ? `<div class="o-grilla">${ya.map(card).join("")}</div>` : `<p class="vacio">En este momento no encontramos juegos gratis. Volvé en un rato: suelen aparecer los jueves.</p>`}
${anuncio}
${prox.length ? `<h2 class="o-h2">Próximamente gratis</h2><div class="o-grilla">${prox.map(card).join("")}</div>` : ""}
<p class="mini">Algunos datos de tiendas distintas de Epic vienen de <a href="https://www.gamerpower.com" rel="nofollow noopener" target="_blank">GamerPower</a>. Verificá siempre las condiciones en la tienda. También mirá las <a href="/ofertas/">ofertas con precio en pesos</a>.</p>
<section class="faq"><h2>Preguntas frecuentes</h2>${preguntas.map(([p, r]) => `<details><summary>${e(p)}</summary><p>${e(r)}</p></details>`).join("")}</section>`;
  const ld = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: preguntas.map(([p, r]) => ({ "@type": "Question", name: p, acceptedAnswer: { "@type": "Answer", text: r } })) };
  escribir("juegos-gratis/index.html", pagina({ titulo: `Juegos gratis esta semana: Epic, Steam y más | ${S.nombre}`,
    desc: "Los juegos gratis de esta semana en Epic Games, Steam, GOG, itch.io, IndieGala y otras tiendas, con la fecha hasta cuándo podés conseguirlos.", canon: "/juegos-gratis/", cuerpo,
    extraHead: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` }));
  return [["/juegos-gratis/", extra.actualizado || ofertas.actualizado]];
}

// ---------- Calculadora de precios en pesos ----------
export function generarCalculadora({ cfg, pagina, escribir, e, fechaLarga, anuncio }) {
  const S = cfg.sitio;
  const datos = leerJSON(ruta("data", "ofertas-juegos.json"), {});
  const imp = cfg.ofertas?.impuestos || { iva: 0.21, percepcion: 0.30 };
  const oficial = datos.dolar?.oficial || (datos.dolar?.tarjeta ? datos.dolar.tarjeta / (1 + imp.iva + imp.percepcion) : null);
  const factor = 1 + (imp.iva || 0) + (imp.percepcion || 0);
  const pct = (x) => Math.round((x || 0) * 100);
  const $ = (n) => "$" + Math.round(n).toLocaleString("es-AR");
  const ejemplos = [4.99, 9.99, 19.99, 29.99, 49.99, 69.99];
  const tabla = oficial ? `<div class="tabla-wrap"><table class="tabla-nota"><caption>Precios comunes de juegos y suscripciones, en pesos</caption><thead><tr><th>En la tienda</th><th>Con tarjeta (con impuestos)</th><th>Con dólares propios</th></tr></thead><tbody>${ejemplos.map((u) => `<tr><td>US$${u.toFixed(2)}</td><td>${$(u * oficial * factor)}</td><td>${$(u * oficial)}*</td></tr>`).join("")}</tbody></table></div>
<p class="mini">* Si pagás el resumen con dólares que ya tenés, en general no se cobran el IVA ni la percepción sobre ese pago. La columna usa el dólar oficial como referencia; el costo real es lo que te costaron esos dólares.</p>` : "";
  const cuerpo = `<article class="nota inst">
<h1>¿Cuánto sale en pesos? Calculadora para juegos y suscripciones</h1>
<p class="bajada">Escribí el precio en dólares de un juego, una suscripción (Game Pass, PS Plus) o un pase de batalla y te decimos cuánto vas a pagar con tarjeta argentina.</p>
<form class="calc" id="calc" onsubmit="return false">
<label for="calc-usd">Precio en dólares (US$)</label><input id="calc-usd" inputmode="decimal" value="19,99">
<label for="calc-dolar">Dólar oficial ($)</label><input id="calc-dolar" inputmode="decimal" value="${oficial ? Math.round(oficial) : ""}">
<p class="calc-res" id="calc-res" aria-live="polite">—</p>
</form>
<p class="mini">Cálculo: precio × dólar oficial × (1 + IVA ${pct(imp.iva)}% + percepción ${pct(imp.percepcion)}%). ${datos.dolar?.fecha ? `Dólar oficial tomado el ${fechaLarga(datos.dolar.fecha)}.` : ""} Para ver la cotización de hoy, entrá a <a href="https://bolsillo.online/dolar/">bolsillo.online</a>.</p>
${anuncio}
${tabla}
<h2>Cómo pagar menos</h2>
<ul><li>Esperá una oferta: en las <a href="/ofertas/">ofertas del día</a> ya ves el precio final en pesos y si está en su mínimo histórico.</li>
<li>Si tenés dólares en el banco, pagá el resumen de la tarjeta con ellos: en general no se cobran los impuestos sobre ese pago.</li>
<li>Revisá los <a href="/juegos-gratis/">juegos gratis de la semana</a> antes de comprar.</li></ul>
<script>(()=>{const n=v=>{v=String(v).trim().replace(/\\s/g,"");if(v.includes(","))v=v.replace(/\\./g,"").replace(",",".");return parseFloat(v)},f=x=>"$"+Math.round(x).toLocaleString("es-AR"),
u=document.getElementById("calc-usd"),d=document.getElementById("calc-dolar"),r=document.getElementById("calc-res"),k=${factor};
const c=()=>{const a=n(u.value),b=n(d.value);r.innerHTML=isNaN(a)||isNaN(b)?"—":"Con tarjeta: <strong>"+f(a*b*k)+"</strong><small>Sin impuestos (con dólares propios): "+f(a*b)+"</small>"};
u.addEventListener("input",c);d.addEventListener("input",c);c()})();</script>
</article>`;
  escribir("calculadora-pesos/index.html", pagina({ titulo: `Cuánto sale en pesos un juego o suscripción en dólares | ${S.nombre}`,
    desc: "Calculadora para pasar a pesos el precio en dólares de juegos, Game Pass, PS Plus y pases de batalla, con IVA y percepción de la tarjeta.", canon: "/calculadora-pesos/", cuerpo }));
  return [["/calculadora-pesos/", datos.actualizado]];
}
