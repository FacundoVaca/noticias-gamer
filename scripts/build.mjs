// Genera el sitio estático completo en public/ a partir de content/notas/*.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, leerJSON, ruta, escapar as e, fechaLarga, fechaCorta, contarPalabras } from "./lib/util.mjs";

const POR_PAGINA = 18;

export function cargarNotas() {
  const dir = ruta("content", "notas");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
    .map((f) => leerJSON(path.join(dir, f))).filter(Boolean)
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
}

export function construir() {
  const cfg = config();
  const S = cfg.sitio;
  const CAT = cfg.categorias;
  const PUB = ruta("public");
  const todas = cargarNotas();
  const notas = todas.filter((n) => n.estado === "publicada");
  const pendientes = todas.filter((n) => n.estado === "pendiente");

  // Limpia todo menos las imágenes
  fs.mkdirSync(PUB, { recursive: true });
  for (const f of fs.readdirSync(PUB)) if (f !== "img") fs.rmSync(path.join(PUB, f), { recursive: true, force: true });
  fs.cpSync(ruta("static"), PUB, { recursive: true });
  const escribir = (rel, html) => { const p = path.join(PUB, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, html); };

  const adsense = S.adsenseCliente ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${S.adsenseCliente}" crossorigin="anonymous"></script>` : "";
  const img = (n) => n.imagen?.archivo ? `/img/${n.imagen.archivo}` : "/assets/portada.svg";
  const urlNota = (n) => `/notas/${n.slug}/`;
  const navCats = Object.entries(CAT).filter(([k]) => k !== "general")
    .map(([k, v]) => `<a href="/categoria/${k}/">${e(v)}</a>`).join("")
    + `<a href="/ofertas/">Ofertas</a><a href="/soluciones/">Soluciones</a>`;

  const pagina = ({ titulo, desc, canon, cuerpo, og = "", ads = true, indexar = true, extraHead = "" }) => `<!doctype html>
<html lang="${S.idioma}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(titulo)}</title><meta name="description" content="${e(desc)}">
<link rel="canonical" href="${S.url}${canon}">${indexar ? "" : '<meta name="robots" content="noindex,nofollow">'}
<meta property="og:site_name" content="${e(S.nombre)}"><meta property="og:title" content="${e(titulo)}"><meta property="og:description" content="${e(desc)}"><meta property="og:url" content="${S.url}${canon}">${og}
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/assets/style.css">
<link rel="alternate" type="application/rss+xml" title="${e(S.nombre)}" href="/feed.xml">
${ads ? adsense : ""}${extraHead}
</head><body>
<header class="top"><div class="wrap"><a class="logo" href="/"><span class="logo-ico">▶</span>${e(S.nombre)}</a>
<nav class="cats">${navCats}</nav></div></header>
<main class="wrap">${cuerpo}</main>
<footer class="pie"><div class="wrap">
<p><strong>${e(S.nombre)}</strong>. ${e(S.descripcion)}</p>
<p><a href="/acerca/">Quiénes somos</a> · <a href="/politica-editorial/">Política editorial</a> · <a href="/privacidad/">Privacidad</a> · <a href="/contacto/">Contacto</a> · <a href="/feed.xml">RSS</a></p>
<p class="mini">© ${new Date().getFullYear()} ${e(S.nombre)}. Las marcas y nombres de juegos pertenecen a sus dueños.</p>
</div></footer></body></html>`;

  const tarjeta = (n, grande = false) => `<article class="card${grande ? " card-xl" : ""}"><a href="${urlNota(n)}">
<img src="${img(n)}" alt="" loading="${grande ? "eager" : "lazy"}" width="1200" height="675">
<div class="card-txt"><span class="chip c-${n.categoria}">${e(CAT[n.categoria] || "General")}</span>
<h${grande ? 2 : 3}>${e(n.titulo)}</h${grande ? 2 : 3}>${grande ? `<p>${e(n.bajada)}</p>` : ""}
<time datetime="${n.fecha}">${fechaCorta(n.fecha)}</time></div></a></article>`;

  const anuncio = `<div class="ad" aria-hidden="true"></div>`;

  const listado = (lista, base, tituloBase, desc, h1) => {
    const total = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    for (let p = 1; p <= total; p++) {
      const parte = lista.slice((p - 1) * POR_PAGINA, p * POR_PAGINA);
      const canon = p === 1 ? base : `${base}pagina/${p}/`;
      const [prim, ...resto] = parte;
      const cuerpo = `${h1 ? `<h1 class="sec-tit">${e(h1)}</h1>` : ""}
${!parte.length ? `<p class="vacio">Todavía no hay notas publicadas. Volvé en un rato.</p>` : ""}
${prim && p === 1 ? `<div class="destacada">${tarjeta(prim, true)}</div>${anuncio}` : ""}
<div class="grilla">${(p === 1 ? resto : parte).map((n) => tarjeta(n)).join("")}</div>
<nav class="pag">${p > 1 ? `<a href="${p === 2 ? base : `${base}pagina/${p - 1}/`}">← Más nuevas</a>` : ""}${p < total ? `<a href="${base}pagina/${p + 1}/">Más viejas →</a>` : ""}</nav>`;
      escribir(path.join(canon, "index.html"), pagina({ titulo: p === 1 ? tituloBase : `${tituloBase} - página ${p}`, desc, canon, cuerpo, ads: parte.length > 0 }));
    }
  };

  // Portada y categorías
  listado(notas, "/", `${S.nombre}: noticias de videojuegos`, S.descripcion);
  for (const [k, v] of Object.entries(CAT)) {
    listado(notas.filter((n) => n.categoria === k), `/categoria/${k}/`, `Noticias de ${v} | ${S.nombre}`, `Últimas noticias de ${v}: lanzamientos, anuncios y novedades explicadas en español.`, `Noticias de ${v}`);
  }

  listado(notas.filter((n) => n.tipo === "ofertas"), "/ofertas/", `Ofertas de videojuegos | ${S.nombre}`, "Rebajas y ofertas de juegos con precios y enlaces directos a cada tienda.", "Ofertas de videojuegos");
  listado(notas.filter((n) => n.tipo === "problema"), "/soluciones/", `Soluciones a errores y fallas de juegos | ${S.nombre}`, "Errores, cuelgues y caídas de juegos y consolas, con pasos para solucionarlos.", "Soluciones a errores y fallas");

  // Notas
  const cuerpoHTML = (bloques) => {
    let html = "", enLista = false, parrafos = 0;
    for (const b of bloques) {
      if (b.tipo === "li") { if (!enLista) { html += "<ul>"; enLista = true; } html += `<li>${e(b.texto)}</li>`; continue; }
      if (enLista) { html += "</ul>"; enLista = false; }
      if (b.tipo === "h2") html += `<h2>${e(b.texto)}</h2>`;
      else { html += `<p>${e(b.texto)}</p>`; if (++parrafos === 3) html += anuncio; }
    }
    return html + (enLista ? "</ul>" : "");
  };
  const tablaOfertas = (n) => {
    const conPlat = n.ofertas.some((o) => o.plataforma?.trim());
    const conAntes = n.ofertas.some((o) => o.precioAnterior?.trim());
    const precios = n.ofertas.map((o) => o.precio).join(" ");
    const moneda = /€|eur/i.test(precios) ? "Los precios están en euros, de la tienda de España o Europa. En Argentina el precio puede ser otro o no estar disponible."
      : /US\$|USD|\$/i.test(precios) ? "Los precios son los publicados por la tienda (en dólares si la fuente es de EE. UU.). En Argentina pueden variar por región e impuestos."
      : "En Argentina el precio puede variar por región e impuestos.";
    return `<section class="ofertas"><h2>Listado de ofertas</h2><div class="tabla-wrap"><table><thead><tr><th>Juego o producto</th>${conPlat ? "<th>Plataforma</th>" : ""}<th>Precio</th>${conAntes ? "<th>Antes</th>" : ""}<th></th></tr></thead><tbody>${n.ofertas.map((o) => `<tr><td>${e(o.producto)}</td>${conPlat ? `<td>${e(o.plataforma || "")}</td>` : ""}<td class="precio">${e(o.precio)}</td>${conAntes ? `<td class="antes">${e(o.precioAnterior || "")}</td>` : ""}<td><a class="btn-oferta" href="${e(o.url)}" rel="nofollow sponsored noopener" target="_blank">Ver${o.tienda ? " en " + e(o.tienda) : ""}</a></td></tr>`).join("")}</tbody></table></div><p class="mini">${moneda} Precios tomados de las fuentes al ${fechaLarga(n.fecha)}; pueden cambiar o terminar sin aviso, verificá el precio final en la tienda.</p></section>`;
  };
  const generarNota = (n, publica) => {
    const rel = notas.filter((o) => o.slug !== n.slug && (o.categoria === n.categoria || o.etiquetas?.some((t) => n.etiquetas?.includes(t)))).slice(0, 4);
    const ld = {
      "@context": "https://schema.org", "@type": "NewsArticle", headline: n.titulo, description: n.bajada,
      image: [`${S.url}${img(n)}`], datePublished: n.fecha, dateModified: n.actualizada || n.fecha,
      author: { "@type": "Organization", name: `Redacción ${S.nombre}`, url: `${S.url}/acerca/` },
      publisher: { "@type": "Organization", name: S.nombre, logo: { "@type": "ImageObject", url: `${S.url}/assets/favicon.svg` } },
      mainEntityOfPage: `${S.url}${urlNota(n)}`, articleSection: CAT[n.categoria], keywords: (n.etiquetas || []).join(", "),
      wordCount: contarPalabras(n.cuerpo.map((b) => b.texto).join(" ")),
    };
    const cuerpo = `<article class="nota">
<p class="migas"><a href="/">Inicio</a> › <a href="/categoria/${n.categoria}/">${e(CAT[n.categoria])}</a></p>
<h1>${e(n.titulo)}</h1><p class="bajada">${e(n.bajada)}</p>
<p class="meta">Por Redacción ${e(S.nombre)} · <time datetime="${n.fecha}">${fechaLarga(n.fecha)}</time>${n.actualizaciones?.length ? ` · Actualizada: <time datetime="${n.actualizada}">${fechaLarga(n.actualizada)}</time>` : ""}</p>
<figure class="portada"><img src="${img(n)}" alt="${e(n.titulo)}" width="1200" height="675">${n.imagen?.credito ? `<figcaption>${n.imagen.credito.url ? `<a href="${e(n.imagen.credito.url)}" rel="nofollow noopener" target="_blank">${e(n.imagen.credito.texto)}</a>` : e(n.imagen.credito.texto)}</figcaption>` : ""}</figure>
${n.clave?.length ? `<aside class="clave"><strong>Lo importante</strong><ul>${n.clave.map((c) => `<li>${e(c)}</li>`).join("")}</ul></aside>` : ""}
${n.actualizaciones?.length ? n.actualizaciones.map((a) => `<section class="upd"><p class="upd-tit">Actualización · <time datetime="${a.fecha}">${fechaLarga(a.fecha)}</time></p>${cuerpoHTML(a.bloques)}</section>`).join("") : ""}
<div class="texto">${cuerpoHTML(n.cuerpo)}</div>
${n.ofertas?.length ? tablaOfertas(n) : ""}
${n.preguntas?.length ? `<section class="faq"><h2>Preguntas frecuentes</h2>${n.preguntas.map((q) => `<details><summary>${e(q.p)}</summary><p>${e(q.r)}</p></details>`).join("")}</section>` : ""}
${n.etiquetas?.length ? `<p class="tags">${n.etiquetas.map((t) => `<span>${e(t)}</span>`).join("")}</p>` : ""}
<section class="fuentes"><h2>Fuentes</h2><ul>${n.fuentes.map((f) => `<li><a href="${e(f.url)}" rel="nofollow noopener" target="_blank">${e(f.medio)}: ${e(f.titulo)}</a></li>`).join("")}</ul>
<p class="mini">Esta nota fue elaborada por ${e(S.nombre)} a partir de la información publicada en los enlaces de arriba, con asistencia de inteligencia artificial y bajo nuestra <a href="/politica-editorial/">política editorial</a>. ¿Viste un error? <a href="/contacto/">Avisanos</a>.</p></section>
</article>${anuncio}
${rel.length ? `<section class="relacionadas"><h2>Seguí leyendo</h2><div class="grilla">${rel.map((o) => tarjeta(o)).join("")}</div></section>` : ""}`;
    const og = `<meta property="og:type" content="article"><meta property="og:image" content="${S.url}${img(n)}"><meta property="article:published_time" content="${n.fecha}">`;
    return pagina({ titulo: `${n.titulo} | ${S.nombre}`, desc: n.bajada, canon: publica ? urlNota(n) : `/revision/${n.slug}/`, cuerpo, og, ads: publica, indexar: publica,
      extraHead: publica ? [ld, n.preguntas?.length ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: n.preguntas.map((q) => ({ "@type": "Question", name: q.p, acceptedAnswer: { "@type": "Answer", text: q.r } })) } : null].filter(Boolean).map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join("") : "" });
  };
  for (const n of notas) escribir(path.join("notas", n.slug, "index.html"), generarNota(n, true));

  // Revisión (solo si hay pendientes; no indexable y sin anuncios)
  if (pendientes.length) {
    for (const n of pendientes) escribir(path.join("revision", n.slug, "index.html"), generarNota(n, false));
    escribir("revision/index.html", pagina({ titulo: "Notas pendientes de revisión", desc: "", canon: "/revision/", ads: false, indexar: false,
      cuerpo: `<h1 class="sec-tit">Pendientes de revisión (${pendientes.length})</h1><p>Para publicarlas: en GitHub → Actions → <strong>Aprobar notas</strong> → Run workflow, y escribí los nombres (o <code>todas</code>).</p>
<ul class="lista-rev">${pendientes.map((n) => `<li><a href="/revision/${n.slug}/">${e(n.titulo)}</a><br><code>${n.slug}</code></li>`).join("")}</ul>` }));
  }

  // Páginas institucionales (necesarias para AdSense)
  const inst = leerJSON(ruta("content", "paginas.json"), {});
  for (const [slug, p] of Object.entries(inst)) {
    const html = p.html.replaceAll("{{nombre}}", e(S.nombre)).replaceAll("{{email}}", e(S.emailContacto)).replaceAll("{{url}}", S.url);
    escribir(path.join(slug, "index.html"), pagina({ titulo: `${p.titulo} | ${S.nombre}`, desc: p.desc, canon: `/${slug}/`, cuerpo: `<article class="nota inst"><h1>${e(p.titulo)}</h1>${html}</article>` }));
  }
  escribir("404.html", pagina({ titulo: `Página no encontrada | ${S.nombre}`, desc: "", canon: "/404.html", ads: false, indexar: false, cuerpo: `<h1 class="sec-tit">No encontramos esa página</h1><p><a href="/">Volver a las últimas noticias</a></p>` }));

  // RSS, sitemap, robots, ads.txt
  const ultimas = notas.slice(0, 30);
  escribir("feed.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${e(S.nombre)}</title><link>${S.url}/</link><description>${e(S.descripcion)}</description><language>${S.idioma}</language>
<atom:link href="${S.url}/feed.xml" rel="self" type="application/rss+xml"/>
${ultimas.map((n) => `<item><title>${e(n.titulo)}</title><link>${S.url}${urlNota(n)}</link><guid>${S.url}${urlNota(n)}</guid><pubDate>${new Date(n.fecha).toUTCString()}</pubDate><category>${e(CAT[n.categoria])}</category><description>${e(n.bajada)}</description></item>`).join("\n")}
</channel></rss>`);
  const urls = [["/", notas[0]?.fecha], ["/ofertas/"], ["/soluciones/"], ...Object.keys(CAT).map((k) => [`/categoria/${k}/`]), ...Object.keys(inst).map((s) => [`/${s}/`]), ...notas.map((n) => [urlNota(n), n.actualizada || n.fecha])];
  escribir("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, f]) => `<url><loc>${S.url}${u}</loc>${f ? `<lastmod>${f.slice(0, 10)}</lastmod>` : ""}</url>`).join("\n")}
</urlset>`);
  const dosDias = Date.now() - 2 * 864e5;
  escribir("news-sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${notas.filter((n) => new Date(n.fecha) > dosDias).map((n) => `<url><loc>${S.url}${urlNota(n)}</loc><news:news><news:publication><news:name>${e(S.nombre)}</news:name><news:language>es</news:language></news:publication><news:publication_date>${n.fecha}</news:publication_date><news:title>${e(n.titulo)}</news:title></news:news></url>`).join("\n")}
</urlset>`);
  escribir("robots.txt", `User-agent: *\nDisallow: /revision/\nAllow: /\n\nSitemap: ${S.url}/sitemap.xml\nSitemap: ${S.url}/news-sitemap.xml\n`);
  if (S.adsenseCliente) escribir("ads.txt", `google.com, ${S.adsenseCliente.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`);
  console.log(`Sitio generado: ${notas.length} notas publicadas, ${pendientes.length} pendientes.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) construir();
