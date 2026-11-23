/* Listado de ofertas de una tienda: búsqueda, orden y panel de filtros plegable. Sin dependencias.
   Dentro de un mismo grupo (por ejemplo, Plataforma) alcanza con que cumpla una opción; entre grupos tienen que cumplirse todos.
   El estado queda en la dirección (?pl=PS5&dm=50...) para poder compartir o volver al mismo listado. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var L = $("o-lista");
  if (!L) return;
  var C = [].slice.call(L.children), q = $("o-q"), o = $("o-ord"), n = $("o-n"), dm = $("o-dm"), pmin = $("o-pmin"), pmax = $("o-pmax");
  var panel = $("o-panel"), btn = $("o-fbtn"), fn = $("o-fn"), activos = $("o-activos");
  var cajas = [].slice.call(panel.querySelectorAll("input[type=checkbox][data-f]"));

  var cumple = {
    pl: function (c, v) { return c.dataset.pl.split("|").indexOf(v) >= 0; },
    os: function (c, v) { return (c.dataset.os || "").split("|").indexOf(v) >= 0; },
    es: function (c, v) { var x = c.dataset.es || ""; return v === "t" ? x === "t" || x === "tv" : x === "tv"; },
    k: function (c, v) { return c.dataset.k === v; },
    min: function (c) { return c.dataset.min === "1"; },
    gp: function (c) { return c.dataset.gp === "1"; }
  };

  function elegidos() {
    var g = {};
    cajas.forEach(function (x) { if (x.checked) (g[x.dataset.f] = g[x.dataset.f] || []).push(x.value); });
    return g;
  }

  function aplicar() {
    var t = q.value.trim().toLowerCase(), s = o.value, d = +dm.value,
      mn = pmin.value === "" ? 0 : +pmin.value, mx = pmax.value === "" ? Infinity : +pmax.value, g = elegidos();
    var v = C.filter(function (c) {
      if (t && c.dataset.t.indexOf(t) < 0) return false;
      if (+c.dataset.d < d || +c.dataset.p < mn || +c.dataset.p > mx) return false;
      for (var k in g) if (!g[k].some(function (val) { return cumple[k](c, val); })) return false;
      return true;
    });
    var by = { d: function (a, b) { return b.dataset.d - a.dataset.d; }, p: function (a, b) { return a.dataset.p - b.dataset.p; },
      pd: function (a, b) { return b.dataset.p - a.dataset.p; }, t: function (a, b) { return a.dataset.t.localeCompare(b.dataset.t); } }[s];
    var orden = by ? v.slice().sort(by) : C.filter(function (c) { return v.indexOf(c) >= 0; });
    C.forEach(function (c) { c.hidden = true; });
    orden.forEach(function (c) { c.hidden = false; L.appendChild(c); });
    n.textContent = v.length === 1 ? "1 oferta" : v.length.toLocaleString("es-AR") + " ofertas";
    $("o-sin").hidden = v.length > 0;
    resumen(g, d, mn, mx);
    guardar(t, s, d, g);
  }

  // Cantidad de filtros activos en el botón y una fila de etiquetas para sacarlos de a uno
  function resumen(g, d, mn, mx) {
    var items = [];
    if (d) items.push([d + "% o más", function () { dm.value = "0"; }]);
    if (mn) items.push(["Desde $" + mn.toLocaleString("es-AR"), function () { pmin.value = ""; }]);
    if (mx !== Infinity) items.push(["Hasta $" + mx.toLocaleString("es-AR"), function () { pmax.value = ""; }]);
    cajas.forEach(function (x) { if (x.checked) items.push([x.nextElementSibling.textContent, function () { x.checked = false; }]); });
    fn.textContent = items.length; fn.hidden = !items.length;
    activos.textContent = ""; activos.hidden = !items.length;
    items.forEach(function (it) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "o-tag"; b.textContent = it[0]; b.setAttribute("aria-label", "Quitar filtro: " + it[0]);
      b.addEventListener("click", function () { it[1](); aplicar(); });
      activos.appendChild(b);
    });
  }

  function guardar(t, s, d, g) {
    if (!window.history || !history.replaceState) return;
    var p = new URLSearchParams();
    if (t) p.set("q", t); if (s) p.set("orden", s); if (d) p.set("dm", d);
    if (pmin.value) p.set("pmin", pmin.value); if (pmax.value) p.set("pmax", pmax.value);
    for (var k in g) p.set(k, g[k].join(","));
    var qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
  }
  function leer() {
    var p = new URLSearchParams(location.search);
    if (p.get("q")) q.value = p.get("q");
    if (p.get("orden")) o.value = p.get("orden");
    if (p.get("dm")) dm.value = p.get("dm");
    if (p.get("pmin")) pmin.value = p.get("pmin");
    if (p.get("pmax")) pmax.value = p.get("pmax");
    cajas.forEach(function (x) { var v = p.get(x.dataset.f); if (v && v.split(",").indexOf(x.value) >= 0) x.checked = true; });
  }

  function abrir(si) {
    panel.hidden = !si;
    btn.setAttribute("aria-expanded", si ? "true" : "false");
    if (si) { var f = panel.querySelector("select,input"); if (f) f.focus(); }
  }
  btn.addEventListener("click", function () { abrir(panel.hidden); });
  $("o-listo").addEventListener("click", function () { abrir(false); btn.focus(); L.scrollIntoView({ behavior: "smooth", block: "start" }); });
  $("o-limpiar").addEventListener("click", function () {
    dm.value = "0"; pmin.value = ""; pmax.value = ""; cajas.forEach(function (x) { x.checked = false; }); aplicar();
  });
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !panel.hidden) { abrir(false); btn.focus(); } });

  [q, o, dm, pmin, pmax].concat(cajas).forEach(function (x) { x.addEventListener("input", aplicar); x.addEventListener("change", aplicar); });
  leer();
  aplicar();
})();
