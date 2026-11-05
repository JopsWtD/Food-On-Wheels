// Menú del cliente: inicio por secciones (Combos, Los más pedidos y cada categoría),
// vista "Ver todo" de una categoría y resultados de búsqueda.
import { $, $$, esc, dinero } from "../../shared/util.js";
import { PRODUCTOS, BANNER, TIENDA, precioFinal, descuentoDe, eventosVigentes, objetivoDe, esCombo, combos, categoriasVisibles, productosDeCategoria, masPedidos, sumaSeparado, disponibles, agotado, categoriaDe } from "../../shared/catalogo.js";
import { S, en, emitir, nombreDe } from "./estado.js";
import { cantidadEn } from "./carrito.js";

const POR_SECCION = 8; // productos que se muestran en cada sección del inicio

/* ===== Tarjeta de producto ===== */
function extras(p) {
  let h = "";
  if (esCombo(p)) {
    h += `<p class="incluye">${p.incluye.map((i) => `${i.cant}× ${esc(nombreDe(i.id))}`).join(" · ")}</p>`;
    const sep = sumaSeparado(p.incluye); if (sep > p.precio) h += `<span class="ahorro">Ahorras ${dinero(sep - p.precio)}</span>`;
  }
  const d = disponibles(p.id);
  if (d && d <= 3) h += `<span class="ultimas">¡${d === 1 ? "Última unidad" : "Últimas " + d}!</span>`;
  return h;
}
export function tarjeta(p, i = 0) {
  const ag = agotado(p), n = cantidadEn(p.id), ev = descuentoDe(p);
  return `<article class="tarjeta${ag ? " agotado" : ""}" data-pid="${p.id}" style="--i:${Math.min(i, 10)}">
    <button class="tarjeta-abrir" type="button" data-abrir="${p.id}" aria-label="Ver detalle de ${esc(p.nombre)}"></button>
    <div class="tarjeta-img" aria-hidden="true">${p.imagen ? `<img src="${p.imagen}" alt="" loading="lazy">` : esc(p.emoji)}${ag ? '<span class="etiqueta-desc etiqueta-agotado">Agotado</span>' : ev ? `<span class="etiqueta-desc" title="${esc(ev.nombre)}">-${ev.porcentaje}%</span>` : ""}<span class="en-carrito"${n ? "" : " hidden"}>${n ? "×" + n : ""}</span></div>
    <div class="tarjeta-cuerpo">${ev && !ag ? `<span class="ev-nombre">🎉 ${esc(ev.nombre)}</span>` : ""}<h3>${esc(p.nombre)}</h3><p>${esc(p.descripcion)}</p>${extras(p)}
      <div class="tarjeta-pie"><span class="precio">${ev ? `<s>${dinero(p.precio)}</s>` : ""}${dinero(precioFinal(p))}</span>
      <button class="btn-anadir" type="button" data-id="${p.id}" aria-label="Añadir ${esc(p.nombre)}"${ag ? " disabled" : ""}>${ag ? "Agotado" : "+ Añadir"}</button></div></div></article>`;
}
// Actualiza la marca "×2" de cada tarjeta sin volver a dibujar el menú
function marcarEnCarrito() {
  $$(".tarjeta[data-pid]").forEach((t) => {
    const n = cantidadEn(+t.dataset.pid), b = $(".en-carrito", t), txt = n ? "×" + n : "";
    if (b.textContent !== txt) { b.textContent = txt; b.hidden = !n; b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
  });
}

/* ===== Secciones ===== */
function secciones() {
  const l = [];
  if (combos().length) l.push({ id: "combos", emoji: "🍱", nombre: "Combos", sub: "Más sabor por menos", productos: combos() });
  const top = masPedidos(POR_SECCION); if (top.length >= 3) l.push({ id: "top", emoji: "🔥", nombre: "Los más pedidos", sub: "Lo que todos están pidiendo", productos: top, sinVerTodo: true });
  categoriasVisibles().forEach((c) => l.push({ id: c.id, emoji: c.emoji, nombre: c.nombre, productos: productosDeCategoria(c.id) }));
  return l.filter((s) => s.productos.length);
}
const productosDe = (id) => id === "combos" ? combos() : productosDeCategoria(id);
const seccionPorId = (id) => secciones().find((s) => s.id === id);

function htmlSeccion(s) {
  const muestra = s.productos.slice(0, POR_SECCION), mas = !s.sinVerTodo && s.productos.length > 4;
  return `<section class="seccion" id="sec-${esc(s.id)}" data-sec="${esc(s.id)}">
    <header class="seccion-cab"><div><h3><span aria-hidden="true">${esc(s.emoji)}</span> ${esc(s.nombre)}</h3>${s.sub ? `<p>${s.sub}</p>` : ""}</div>${mas ? `<button class="ver-todo" type="button" data-ver="${esc(s.id)}">Ver todo <b>${s.productos.length}</b> →</button>` : ""}</header>
    <div class="fila-wrap"><button class="flecha izq" type="button" data-mover="-1" aria-label="Anteriores" hidden>‹</button>
      <div class="fila">${muestra.map(tarjeta).join("")}</div>
      <button class="flecha der" type="button" data-mover="1" aria-label="Siguientes" hidden>›</button></div></section>`;
}
function pintarChips(lista, activo, atributo) {
  $("#categorias").innerHTML = lista.map((s) => `<button class="chip" type="button" ${atributo}="${esc(s.id)}" aria-pressed="${s.id === activo}"><span aria-hidden="true">${esc(s.emoji)}</span> ${esc(s.nombre)}</button>`).join("");
}
export function pintarMenu() {
  const cont = $("#secciones"), info = $("#infoResultados");
  if (!S.catalogoListo) {
    info.textContent = "";
    cont.innerHTML = [0, 1].map(() => `<section class="seccion"><header class="seccion-cab"><i class="esq-titulo"></i></header><div class="fila">${Array.from({ length: 5 }, (_, i) => `<article class="tarjeta esqueleto" style="--i:${i}" aria-hidden="true"><div class="tarjeta-img"></div><div class="tarjeta-cuerpo"><i></i><i></i><i></i></div></article>`).join("")}</div></section>`).join("");
    return;
  }
  if (!PRODUCTOS.length) { $("#categorias").innerHTML = ""; info.textContent = ""; cont.innerHTML = `<div class="vacio vacio-grande"><span aria-hidden="true">👩‍🍳</span><p>Pronto tendremos platos disponibles. ¡Vuelve más tarde!</p></div>`; return; }
  // 1) Búsqueda
  if (S.texto) {
    const r = PRODUCTOS.filter((p) => `${p.nombre} ${p.descripcion} ${categoriaDe(p)?.nombre ?? ""}`.toLowerCase().includes(S.texto));
    $("#categorias").innerHTML = ""; info.textContent = `${r.length} resultado${r.length === 1 ? "" : "s"}`;
    cont.innerHTML = `<div class="vista-cab"><h3>Resultados para “${esc(S.texto)}”</h3><button class="enlace" type="button" data-limpiar>Limpiar búsqueda</button></div>` +
      (r.length ? `<div class="grilla">${r.map(tarjeta).join("")}</div>` : `<p class="vacio">No encontramos platos con esa búsqueda.</p>`);
    return;
  }
  const lista = secciones();
  // 2) "Ver todo" de una categoría
  if (S.vista.tipo === "categoria") {
    const s = lista.find((x) => x.id === S.vista.cat) || seccionPorId("combos");
    if (!s) { S.vista = { tipo: "inicio" }; return pintarMenu(); }
    pintarChips(lista.filter((x) => x.id !== "top"), s.id, "data-ver");
    info.textContent = `${s.productos.length} producto${s.productos.length === 1 ? "" : "s"}`;
    cont.innerHTML = `<div class="vista-cab"><button class="volver" type="button" data-inicio>← Todo el menú</button><h3><span aria-hidden="true">${esc(s.emoji)}</span> ${esc(s.nombre)}</h3></div><div class="grilla">${productosDe(s.id).map(tarjeta).join("")}</div>`;
    return;
  }
  // 3) Inicio por secciones
  pintarChips(lista, lista[0]?.id, "data-sec-ir");
  info.textContent = `${PRODUCTOS.length} productos`;
  cont.innerHTML = lista.map(htmlSeccion).join("");
  $$(".fila").forEach(actualizarFlechas);
  alDesplazarMenu();
}

/* ===== Navegación ===== */
const altoCabecera = () => $(".top").offsetHeight + $("#categorias").offsetHeight + 12;
export function irASeccion(id) {
  if (S.vista.tipo !== "inicio" || S.texto) { S.vista = { tipo: "inicio" }; S.texto = ""; $("#buscar").value = ""; pintarMenu(); }
  const el = $(`#sec-${CSS.escape(id)}`); if (!el) return $("#menu").scrollIntoView({ behavior: "smooth" });
  marcarChip(id); pausaResaltado = Date.now() + 1000; // mientras dura el desplazamiento no se cambia el resaltado
  scrollTo({ top: el.getBoundingClientRect().top + scrollY - altoCabecera(), behavior: "smooth" });
}
function verTodo(id) { S.vista = { tipo: "categoria", cat: id }; pintarMenu(); scrollTo({ top: $("#menu").getBoundingClientRect().top + scrollY - $(".top").offsetHeight, behavior: "smooth" }); }
// Resalta en la barra de categorías la sección que se está viendo
let pausaResaltado = 0;
function marcarChip(id) {
  const chips = $$("#categorias .chip"), activo = chips.find((c) => c.dataset.secIr === id);
  if (!activo || activo.getAttribute("aria-pressed") === "true") return;
  chips.forEach((c) => c.setAttribute("aria-pressed", c === activo));
  activo.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
}
function seccionVisible() {
  const secs = $$(".seccion[data-sec]"); if (!secs.length) return null;
  const linea = altoCabecera() + 40; let actual = secs[0];
  secs.forEach((s) => { if (s.getBoundingClientRect().top <= linea) actual = s; });
  // La última sección puede no llegar arriba porque se acaba la página: si ya se ve, se marca
  const ultima = secs[secs.length - 1], r = ultima.getBoundingClientRect();
  const alFinal = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
  if (r.top < innerHeight * .75 && (alFinal || r.bottom <= innerHeight)) actual = ultima;
  return actual.dataset.sec;
}
let pendienteSpy = false;
function alDesplazarMenu() {
  if (pendienteSpy || S.vista.tipo !== "inicio" || S.texto || Date.now() < pausaResaltado) return;
  pendienteSpy = true;
  requestAnimationFrame(() => { pendienteSpy = false; const id = seccionVisible(); if (id) marcarChip(id); });
}
function actualizarFlechas(fila) {
  const w = fila.closest(".fila-wrap"); if (!w) return;
  $(".izq", w).hidden = fila.scrollLeft < 8;
  $(".der", w).hidden = fila.scrollLeft + fila.clientWidth >= fila.scrollWidth - 8;
}

/* ===== Promociones y banner ===== */
// Franja del inicio con los eventos vigentes. Al tocar uno lleva al producto o a la sección que tiene el descuento.
function pintarEventos() {
  const l = eventosVigentes().map((e) => ({ e, o: objetivoDe(e) })).filter(({ o }) => o);
  $("#promos").hidden = !l.length;
  $("#listaPromos").innerHTML = l.map(({ e, o }, k) => `<button class="promo evento" type="button" style="--i:${k}" data-evento="${esc(e.id)}">
    <span class="evento-pct">-${e.porcentaje}%</span><h3>${esc(e.nombre)}</h3>${e.texto ? `<p>${esc(e.texto)}</p>` : ""}
    <small>${esc(o.emoji || "🍽️")} ${e.objetivo.tipo === "producto" ? esc(o.nombre) : "Toda la sección " + esc(o.nombre)}${e.hasta ? ` · hasta el ${new Date(e.hasta).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}` : ""}</small></button>`).join("");
}
function irAEvento(id) {
  const e = eventosVigentes().find((x) => x.id === id); if (!e) return;
  if (e.objetivo.tipo === "producto") return emitir("abrirDetalle", e.objetivo.id);
  secciones().some((s) => s.id === e.objetivo.id) ? irASeccion(e.objetivo.id) : $("#menu").scrollIntoView({ behavior: "smooth" });
}
function aplicarBanner() {
  const b = BANNER, h = $("#hPlato");
  $("#hEtiqueta").textContent = b.etiqueta; $("#hTitulo").textContent = b.titulo; $("#hTexto").textContent = b.texto;
  $("#hBoton").textContent = b.boton; $("#hEmoji").textContent = b.emoji;
  h.classList.toggle("con-imagen", !!b.imagen); h.style.backgroundImage = b.imagen ? `url(${b.imagen})` : "";
  $("#textoPrime").textContent = `Tendrás un ${TIENDA.primeDescuento}% de descuento en todas tus compras con tu membresía.`;
}

export function iniciarMenu() {
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    const d = t.dataset;
    if (d.secIr) irASeccion(d.secIr);
    if (d.ver) verTodo(d.ver);
    if (d.inicio !== undefined) { S.vista = { tipo: "inicio" }; pintarMenu(); $("#menu").scrollIntoView(); }
    if (d.limpiar !== undefined) { S.texto = ""; $("#buscar").value = ""; pintarMenu(); }
    if (d.evento) irAEvento(d.evento);
    if (d.mover) { const f = $(".fila", t.closest(".fila-wrap")); f.scrollBy({ left: +d.mover * f.clientWidth * .85, behavior: "smooth" }); }
  });
  document.addEventListener("scroll", (e) => { if (e.target.classList?.contains("fila")) actualizarFlechas(e.target); }, { capture: true, passive: true });
  addEventListener("scroll", alDesplazarMenu, { passive: true });
  let espera;
  $("#buscar").oninput = (e) => { clearTimeout(espera); espera = setTimeout(() => { S.texto = e.target.value.toLowerCase().trim(); pintarMenu(); if (S.texto) $("#menu").scrollIntoView({ behavior: "smooth" }); }, 180); };
  en("catalogo", (tipo) => {
    if (["productos", "categorias", "inventario", "popularidad", "eventos"].includes(tipo)) pintarMenu();
    if (["eventos", "productos", "categorias"].includes(tipo)) pintarEventos();
    if (tipo === "banner" || tipo === "tienda") aplicarBanner();
  });
  en("carrito", marcarEnCarrito);
  pintarMenu(); pintarEventos(); aplicarBanner();
}
