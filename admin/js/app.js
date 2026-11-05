// Núcleo del panel admin: sesión, datos en vivo, navegación y reparto de eventos a cada sección.
// Para agregar una sección nueva: crea vistas/mi-seccion.js (con id, icono, titulo, render y acciones)
// y agrégala a la lista VISTAS. No hace falta tocar nada más.
import { $, $$ } from "../../shared/util.js";
import { doc, collection, getDoc, onSnapshot, query, where, orderBy, limit, onAuthStateChanged, signInWithEmailAndPassword, signOut, errorAuth } from "../../shared/firebase.js";
import { escucharCatalogo } from "../../shared/catalogo.js";
import { ordenFecha } from "../../shared/dominio.js";
import { haceDias } from "../../shared/util.js";
import { S, db, auth, ganchos } from "./estado.js";
import { aviso, contarNumeros, mensajeError } from "./ui.js";
import { prepararDatos } from "./servicios.js";
import inicio from "./vistas/inicio.js";
import pedidos from "./vistas/pedidos.js";
import reclamos from "./vistas/reclamos.js";
import ventas from "./vistas/ventas.js";
import facturas from "./vistas/facturas.js";
import productos from "./vistas/productos.js";
import combos from "./vistas/combos.js";
import categorias from "./vistas/categorias.js";
import inventario from "./vistas/inventario.js";
import clientes from "./vistas/clientes.js";
import apariencia from "./vistas/apariencia.js";
import eventos from "./vistas/eventos.js";
import config from "./vistas/config.js";

const VISTAS = [inicio, pedidos, reclamos, ventas, facturas, productos, combos, categorias, eventos, inventario, clientes, apariencia, config];
const vistaActual = () => VISTAS.find((v) => v.id === location.hash.slice(1)) || inicio;

/* ===== RENDER ===== */
function render() {
  if ($("#app").hidden) return;
  const v = vistaActual();
  $("#vista").innerHTML = v.render();
  $("#nav").innerHTML = VISTAS.map((x) => { const n = x.contador?.() || 0; return `<a href="#${x.id}" class="${x === v ? "activo" : ""}">${x.icono}<span>${x.titulo}</span>${n ? `<b class="cuenta">${n}</b>` : ""}</a>`; }).join("");
  const pend = pedidos.contador();
  $("#campana").textContent = pend; $("#campana").hidden = !pend;
  abrirLateral(false);
  // En el celular las tablas se ven como tarjetas: cada celda toma el nombre de su columna
  $$("#vista table").forEach((t) => {
    const cab = $$("th", t).map((th) => th.textContent);
    $$("tbody tr", t).forEach((tr) => tr.children.length === cab.length && [...tr.children].forEach((td, k) => (td.dataset.label = cab[k])));
  });
  contarNumeros($("#vista"));
}
// Redibuja como máximo una vez por cuadro, y nunca mientras el admin escribe en un formulario de la vista
let pendiente = false;
const escribiendo = () => !!document.activeElement?.closest("#vista form");
function pedirRender() {
  if (pendiente) return; pendiente = true;
  requestAnimationFrame(function intento() { if (escribiendo()) return setTimeout(intento, 1500); pendiente = false; render(); });
}
ganchos.render = pedirRender;

/* ===== EVENTOS =====
   Cada botón lleva data-a="nombreDeLaAccion"; se ejecuta la acción de la sección activa con sus data-* */
async function despachar(e) {
  const el = e.target.closest("[data-a]"); if (!el || el.disabled) return;
  const accion = vistaActual().acciones?.[el.dataset.a]; if (!accion) return;
  e.preventDefault();
  await accion(el.dataset, el, e);
  if (["filtro", "tab", "rango", "cat"].includes(el.dataset.a)) render(); // filtros locales de la vista
}
$("#vista").addEventListener("click", despachar);
$("#dlg").addEventListener("click", (e) => { if (e.target === $("#dlg") || e.target.closest("[data-x]")) return $("#dlg").close(); despachar(e); });
$("#dlg").addEventListener("input", () => vistaActual().alEditar?.());
$("#vista").addEventListener("submit", (e) => { const v = vistaActual(); if (!v.alEnviar) return; e.preventDefault(); v.alEnviar(e.target); });
window.onhashchange = () => { S.busq = ""; $("#buscar").value = ""; render(); scrollTo(0, 0); };
$("#buscar").oninput = (e) => { S.busq = e.target.value.toLowerCase().trim(); render(); };
function abrirLateral(abrir) { $("#lateral").classList.toggle("abierto", abrir); $("#veloLat").hidden = !abrir; }
$("#btnMenu").onclick = () => abrirLateral(!$("#lateral").classList.contains("abierto"));
$("#veloLat").onclick = () => abrirLateral(false);
addEventListener("keydown", (e) => { if (e.key === "Escape") abrirLateral(false); });

/* ===== DATOS EN VIVO ===== */
let quitar = [];
const escuchar = (ref, fn) => quitar.push(onSnapshot(ref, (s) => { fn(s); pedirRender(); }, (err) => console.error(err)));
let quitarPedidos = () => {};
function escucharPedidos() { // solo los pedidos de los últimos S.diasPedidos días
  quitarPedidos();
  let iniciales = true;
  quitarPedidos = onSnapshot(query(collection(db, "pedidos"), where("fecha", ">=", haceDias(S.diasPedidos))), (s) => {
    S.pedidos = s.docs.map((x) => x.data()).sort(ordenFecha);
    if (!iniciales && s.docChanges().some((c) => c.type === "added")) aviso("Llegó un pedido nuevo");
    if (!s.metadata.fromCache) iniciales = false; // la caché local responde primero: solo se avisa lo que llegue después del servidor
    pedirRender();
  }, (err) => console.error(err));
}
ganchos.ampliarPedidos = (dias) => { S.diasPedidos += dias; escucharPedidos(); aviso(`Mostrando los últimos ${S.diasPedidos} días`); };
function iniciarEscuchas() {
  escucharPedidos();
  escuchar(collection(db, "usuarios"), (s) => { S.cuentas = s.docs.map((x) => ({ uid: x.id, ...x.data() })); });
  let recIniciales = true;
  escuchar(collection(db, "reclamos"), (s) => {
    S.reclamos = s.docs.map((x) => x.data());
    if (!recIniciales && s.docChanges().some((c) => c.type === "added")) aviso("Llegó un reclamo nuevo");
    if (!s.metadata.fromCache) recIniciales = false;
  });
  escuchar(collection(db, "membresias"), (s) => { S.membresias = s.docs.map((x) => x.data()); });
  escuchar(query(collection(db, "historial"), orderBy("f", "desc"), limit(500)), (s) => { S.historial = s.docs.map((x) => x.data()); });
}
let catalogoEscuchado = false;

/* ===== SESIÓN =====
   Un admin es una cuenta de Authentication con un documento en la colección "admins". */
$("#formLogin").onsubmit = async (e) => {
  e.preventDefault(); const f = e.target, btn = f.querySelector("[type=submit]");
  btn.disabled = true; btn.textContent = "Entrando…";
  try { await signInWithEmailAndPassword(auth, f.correo.value.trim().toLowerCase(), f.clave.value); f.reset(); $("#errLogin").textContent = ""; }
  catch (err) { $("#errLogin").textContent = errorAuth(err); }
  btn.disabled = false; btn.textContent = "Entrar";
};
onAuthStateChanged(auth, async (user) => {
  quitar.forEach((fn) => fn()); quitar = []; quitarPedidos();
  const mostrar = (app) => { $("#cargando").hidden = true; $("#login").hidden = app; $("#app").hidden = !app; };
  if (!user) return mostrar(false);
  let perfil; try { perfil = await getDoc(doc(db, "admins", user.uid)); } catch { perfil = null; }
  if (!perfil?.exists()) { await signOut(auth); mostrar(false); $("#errLogin").textContent = "Esta cuenta no tiene permisos de administrador."; return; }
  S.nombreAdmin = perfil.data().nombre || user.email;
  $(".usuario b").textContent = S.nombreAdmin;
  $(".usuario .avatar").textContent = S.nombreAdmin.trim()[0].toUpperCase();
  // El panel se muestra de inmediato; la preparación de datos corre en segundo plano
  if (!catalogoEscuchado) { catalogoEscuchado = true; escucharCatalogo(db, pedirRender); }
  mostrar(true); render(); iniciarEscuchas();
  prepararDatos().catch((e) => aviso(`No se pudo preparar: ${(e.pasos || ["datos iniciales"]).join(", ")}. ` + (e.code === "permission-denied" ? "Faltan permisos: publica las reglas nuevas (firestore.rules)." : mensajeError(e))));
});
