/* Página de juego: precio estimado en pesos y gráfico del historial. Sin dependencias. */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var fmtArs = function (n) { return "$" + Math.round(n).toLocaleString("es-AR"); };
  var fmtUsd = function (n) { return "US$" + n.toFixed(2).replace(/\.00$/, ""); };
  var fmtM = function (n, m) { return m === "ARS" ? fmtArs(n) : fmtUsd(n); };
  var dia = function (d) { var p = d.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; };
  var hoy = function () { return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); }; // hora de Argentina
  var num = function (d) { return Date.parse(d + "T12:00:00Z") / 864e5; };

  // Videos de YouTube: el iframe se carga solo cuando la persona toca reproducir
  [].slice.call(document.querySelectorAll(".j-yt")).forEach(function (b) {
    b.addEventListener("click", function () {
      var f = document.createElement("iframe");
      f.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(b.dataset.id) + "?autoplay=1&rel=0";
      f.title = b.getAttribute("aria-label").replace(/^Reproducir /, "");
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      f.allowFullscreen = true;
      f.className = "j-yt-frame";
      b.replaceWith(f);
      f.focus();
    });
  });

  // Precio estimado en pesos con impuestos en cada tienda, con la cotización del día; marca la más barata
  var ofertas = [].slice.call(document.querySelectorAll(".j-of[data-precio]"));
  if (ofertas.length) {
    fetch("/ofertas/cotizacion.json").then(function (r) { return r.json(); }).then(function (c) {
      var f = 1 + (c.iva || 0) + (c.percepcion || 0), mejor = null;
      ofertas.forEach(function (box) {
        var m = box.dataset.moneda, pr = +box.dataset.precio;
        if (!(pr > 0) || (m !== "ARS" && !c.oficial)) return;
        var aArs = function (v) { return m === "ARS" ? v * f : v * c.oficial * f; };
        var p = document.createElement("p");
        p.className = "j-pesos";
        p.innerHTML = "<strong></strong><span></span>";
        p.firstChild.textContent = "≈ " + fmtArs(aArs(pr));
        p.lastChild.textContent = "en pesos con impuestos" + (+box.dataset.original > pr ? " (antes " + fmtArs(aArs(+box.dataset.original)) + ")" : "");
        box.querySelector(".j-of-precio").insertAdjacentElement("beforebegin", p);
        box._v = aArs(pr);
        if (!mejor || box._v < mejor.v) mejor = { v: box._v };
      });
      // Si hay empate (diferencia menor al 0,5%) se marcan todas las que empatan
      var conValor = ofertas.filter(function (b) { return b._v; });
      var ganan = mejor ? conValor.filter(function (b) { return b._v <= mejor.v * 1.005; }) : [];
      if (conValor.length > 1 && ganan.length < conValor.length) ganan.forEach(function (box) {
        var b = document.createElement("span");
        b.className = "j-mejor"; b.textContent = ganan.length > 1 ? "Más barato hoy (empate)" : "Más barato hoy";
        box.querySelector(".j-of-tienda").appendChild(b);
      });
    }).catch(function () {});
  }

  // Gráfico escalonado: un tramo por cada período de días seguidos con el mismo precio
  [].slice.call(document.querySelectorAll(".j-chart")).forEach(grafico);
  function grafico(el) {
  var tramos = JSON.parse(el.dataset.tramos || "[]"), mon = el.dataset.moneda, orig = +el.dataset.original || 0;
  if (!tramos.length) return;
  var fin = hoy();
  tramos.forEach(function (t) { if (!t[1]) t[1] = fin; });
  function dibujar() {
    var W = Math.max(280, el.clientWidth || 600), H = W < 520 ? 200 : 260, m = { t: 14, r: 14, b: 28, l: W < 520 ? 58 : 68 };
    var x0 = num(tramos[0][0]), x1 = Math.max(num(fin), x0 + 1);
    var vals = tramos.map(function (t) { return t[2]; }); if (orig) vals.push(orig);
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), pad = (max - min) * 0.12 || max * 0.1 || 1;
    min = Math.max(0, min - pad); max += pad;
    var X = function (d) { return m.l + (d - x0) * (W - m.l - m.r) / (x1 - x0); };
    var Y = function (v) { return m.t + (max - v) * (H - m.t - m.b) / (max - min); };
    var s = "";
    for (var k = 0; k <= 3; k++) {
      var v = min + (max - min) * k / 3, y = Y(v).toFixed(1);
      s += '<line class="g" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (m.l - 8) + '" y="' + y + '" dy="4" text-anchor="end">' + fmtM(v, mon) + "</text>";
    }
    if (orig) s += '<line class="ref" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(orig).toFixed(1) + '" y2="' + Y(orig).toFixed(1) + '"/><text class="ref-t" x="' + (W - m.r) + '" y="' + (Y(orig) - 6).toFixed(1) + '" text-anchor="end">Precio normal ' + fmtM(orig, mon) + "</text>";
    tramos.forEach(function (t) {
      var a = X(num(t[0])), b = Math.min(W - m.r, Math.max(X(num(t[1]) + 1), a + 3)), y = Y(t[2]).toFixed(1);
      s += '<line class="tramo" x1="' + a.toFixed(1) + '" x2="' + b.toFixed(1) + '" y1="' + y + '" y2="' + y + '"/>';
    });
    s += '<text x="' + m.l + '" y="' + (H - 8) + '">' + dia(tramos[0][0]).slice(0, 5) + '</text><text x="' + (W - m.r) + '" y="' + (H - 8) + '" text-anchor="end">Hoy</text>';
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H + '" role="img" tabindex="0" aria-label="Historial de precio. Usá las flechas para recorrer los tramos.">' + s +
      '<line class="cruz" y1="' + m.t + '" y2="' + (H - m.b) + '" visibility="hidden"/><rect class="hit" x="' + m.l + '" y="0" width="' + (W - m.l - m.r) + '" height="' + H + '"/></svg><div class="tip" hidden></div>';
    var svg = el.querySelector("svg"), cruz = svg.querySelector(".cruz"), tip = el.querySelector(".tip"), cur = -1;
    function mostrar(d, i) {
      var t = i != null ? tramos[i] : null;
      if (i == null) tramos.forEach(function (u, j) { if (d >= num(u[0]) && d < num(u[1]) + 1) { t = u; cur = j; } });
      var x = i != null ? X(num(t[0])) : X(d), esc = el.clientWidth / W;
      cruz.setAttribute("x1", x); cruz.setAttribute("x2", x); cruz.setAttribute("visibility", "visible");
      tip.hidden = false; tip.innerHTML = "<strong></strong><span></span>";
      tip.firstChild.textContent = t ? fmtM(t[2], mon) : "Sin oferta registrada";
      tip.lastChild.textContent = t ? (t[0] === t[1] ? dia(t[0]) : dia(t[0]) + " al " + (t[1] === fin ? "hoy" : dia(t[1]))) : "";
      var w = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(el.clientWidth - w, x * esc - w / 2)) + "px";
      tip.style.top = Math.max(0, (t ? Y(t[2]) : m.t) * esc - 58) + "px";
    }
    svg.addEventListener("pointermove", function (ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
      mostrar(Math.floor(x0 + (px - m.l) * (x1 - x0) / (W - m.l - m.r)));
    });
    svg.addEventListener("pointerleave", function () { cruz.setAttribute("visibility", "hidden"); tip.hidden = true; });
    svg.addEventListener("blur", function () { cruz.setAttribute("visibility", "hidden"); tip.hidden = true; });
    svg.addEventListener("keydown", function (ev) {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      cur = cur < 0 ? tramos.length - 1 : Math.max(0, Math.min(tramos.length - 1, cur + (ev.key === "ArrowRight" ? 1 : -1)));
      mostrar(null, cur);
    });
  }
  dibujar();
  var rt; window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(dibujar, 200); });
  }
})();
