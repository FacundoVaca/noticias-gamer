<?xml version="1.0" encoding="UTF-8"?>
<!-- Diseño del feed RSS cuando se abre en el navegador. Los lectores de RSS lo ignoran y leen el XML normal. -->
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
<xsl:output method="html" encoding="UTF-8" indent="yes"/>
<xsl:template match="/rss/channel">
<html lang="es-AR">
<head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex"/>
<title>Feed RSS de <xsl:value-of select="title"/></title>
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml"/>
<style>
:root{--bg:#10111b;--panel:#1b1d2b;--ink:#f1f2f7;--muted:#b8b9c9;--line:#2f3247;--violet:#a78bfa;--lime:#a3e635;--link:#c4b5fd}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.6 Onest,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:28px 20px 60px}a{color:var(--link);text-underline-offset:.18em}
.aviso{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--lime);border-radius:12px;padding:16px 18px;margin:0 0 28px}
.aviso strong{display:block;margin-bottom:4px}.aviso p{margin:0;color:var(--muted)}
.aviso code{background:#0b0c14;padding:2px 6px;border-radius:6px;color:var(--ink);word-break:break-all}
h1{font-size:2rem;line-height:1.15;margin:0 0 6px}.sub{color:var(--muted);margin:0 0 26px}
ul{list-style:none;padding:0;margin:0;display:grid;gap:12px}
li a{display:block;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;text-decoration:none;color:var(--ink)}
li a:hover{border-color:var(--violet)}li strong{display:block;line-height:1.3;margin-bottom:6px}
li span{display:block;color:var(--muted);font-size:.92rem}.meta{font-size:.82rem;color:var(--violet);margin-top:6px}
</style>
</head>
<body><div class="wrap">
<div class="aviso"><strong>Esto es un feed RSS</strong>
<p>Sirve para recibir nuestras notas en una app de lectura como Feedly o Inoreader. Copiá esta dirección y pegala en tu app: <code><xsl:value-of select="link"/>feed.xml</code></p></div>
<h1><xsl:value-of select="title"/></h1>
<p class="sub"><xsl:value-of select="description"/> · <a href="{link}">Ir al sitio</a></p>
<ul>
<xsl:for-each select="item">
<li><a href="{link}"><strong><xsl:value-of select="title"/></strong><span><xsl:value-of select="description"/></span>
<span class="meta"><xsl:value-of select="category"/> · <xsl:value-of select="substring(pubDate,1,16)"/></span></a></li>
</xsl:for-each>
</ul>
</div></body></html>
</xsl:template>
</xsl:stylesheet>
