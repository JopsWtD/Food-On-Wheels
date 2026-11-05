// Carrito y envío del pedido.
// Visitante → se guarda en este dispositivo (localStorage). Con sesión → en usuarios/{uid}.carrito,
// así se continúa en cualquier dispositivo.
import { $, esc, dinero, animar } from "../../shared/util.js";
import { doc, updateDoc } from "../../shared/firebase.js";
import { PRODUCTOS, TIENDA, producto, faltantes, precioFinal, precioDe, descuentoDe } from "../../shared/catalogo.js";
import { calcularTotales } from "../../shared/dominio.js";
import { crearPedido } from "../../shared/pedidos.js";
import { S, db, en, emitir, primeActivo, bloqueado, AVISO_BLOQ } from "./estado.js";
import { aviso, panel, pedirAcceso } from "./ui.js";

export const leerLocal = () => { try { return JSON.parse(localStorage.getItem("fow_carrito")) ?? []; } catch { return []; } };
export function guardarCarrito() {
  if (S.cliente) updateDoc(doc(db, "usuarios", S.cliente.uid), { carrito: S.carrito }).catch(() => aviso("No se pudo guardar el carrito. Revisa tu conexión."));
  else localStorage.setItem("fow_carrito", JSON.stringify(S.carrito));
}
// Solo los productos que siguen existiendo (el admin pudo borrar alguno)
export const carritoValido = () => S.carrito.filter((i) => PRODUCTOS.some((p) => p.id === i.id));
export const cantidadEn = (id) => S.carrito.find((i) => i.id === id)?.cant || 0;
export const totales = (entrega = "recoger") => calcularTotales(carritoValido(), precioDe, { prime: primeActivo(), entrega, tienda: TIENDA });

// Agrega (o quita, con cant negativa) unidades; comprueba que alcance el inventario
export function agregar(id, cant = 1, nota) {
  if (cant > 0 && S.cliente && bloqueado()) { aviso(AVISO_BLOQ); return false; }
  const it = S.carrito.find((i) => i.id === id);
  if (cant > 0) {
    const prueba = carritoValido().map((i) => ({ ...i })), e = prueba.find((i) => i.id === id);
    e ? (e.cant += cant) : prueba.push({ id, cant });
    if (faltantes(prueba).length) { aviso("No hay más existencias de " + producto(id).nombre); return false; }
    animar($("#contador"), "pop"); animar($("#btnCarrito"), "meneo");
  }
  if (it) { it.cant += cant; if (nota !== undefined) it.nota = nota; S.carrito = S.carrito.filter((i) => i.cant > 0); }
  else if (cant > 0) S.carrito.push(nota ? { id, cant, nota } : { id, cant });
  guardarCarrito(); emitir("carrito");
  return true;
}
export function vaciar() { S.carrito = []; guardarCarrito(); emitir("carrito"); }

function pintar() {
  const lista = carritoValido(), n = lista.reduce((s, i) => s + i.cant, 0);
  $("#contador").textContent = n; $("#contador").hidden = !n;
  $("#itemsCarrito").innerHTML = lista.length ? lista.map((i) => {
    const p = producto(i.id), pf = precioFinal(p), ev = descuentoDe(p);
    return `<div class="item"><button class="item-emoji" type="button" data-abrir="${p.id}" aria-label="Ver ${esc(p.nombre)}">${p.imagen ? `<img src="${p.imagen}" alt="">` : esc(p.emoji)}</button>
      <div><b>${esc(p.nombre)}</b>${ev ? `<s class="antes">${dinero(p.precio)}</s> ` : ""}${dinero(pf)}${ev ? ` <span class="ev-mini">-${ev.porcentaje}%</span>` : ""}${i.cant > 1 ? `<small class="linea-total">${i.cant} × ${dinero(pf)} = <b>${dinero(pf * i.cant)}</b></small>` : ""}${i.nota ? `<small class="nota-item">📝 ${esc(i.nota)}</small>` : ""}</div>
      <div class="cantidad"><button data-menos="${p.id}" aria-label="Quitar uno">−</button>${i.cant}<button data-mas="${p.id}" aria-label="Agregar uno">+</button></div></div>`;
  }).join("") : `<div class="vacio vacio-grande"><span aria-hidden="true">🛒</span><p>Tu carrito está vacío.</p><button class="btn btn-naranja" type="button" data-ir-menu>Ver el menú</button></div>`;
  const t = totales();
  $("#tSub").textContent = dinero(t.sub);
  $("#filaPrime").hidden = !t.prime;
  $("#filaPrime dt").textContent = `Descuento Prime (${TIENDA.primeDescuento}%)`;
  $("#tPrime").textContent = "-" + dinero(t.prime);
  $("#tTotal").textContent = dinero(t.total);
  $("#notaEnvio").textContent = TIENDA.costoEnvio ? `+ ${dinero(TIENDA.costoEnvio)} de domicilio si lo pides a domicilio` : "";
  $("#btnContinuar").disabled = !lista.length;
}
export const abrirCarrito = (abrir = true) => panel("carrito", abrir);

/* ===== ENVÍO DEL PEDIDO ===== */
function resumenPedido() {
  const entrega = $("#selEntrega").value, t = totales(entrega), dom = entrega === "domicilio";
  $("#lblDireccion").hidden = !dom; $("#formPedido").direccion.required = dom;
  $("#resumenPedido").innerHTML = `<div><dt>Subtotal</dt><dd>${dinero(t.sub)}</dd></div>${t.prime ? `<div><dt>Descuento Prime</dt><dd>-${dinero(t.prime)}</dd></div>` : ""}${dom ? `<div><dt>Domicilio</dt><dd>${t.envio ? dinero(t.envio) : "Gratis"}</dd></div>` : ""}<div class="total"><dt>Total</dt><dd>${dinero(t.total)}</dd></div>`;
}
export function abrirPedido() {
  if (bloqueado()) return aviso(AVISO_BLOQ);
  const f = $("#formPedido");
  f.nombre.value = S.cliente.nombre; f.telefono.value = S.cliente.telefono; f.direccion.value = S.cliente.direccion || "";
  resumenPedido(); $("#dlgPedido").showModal();
}
async function enviarPedido(e) {
  e.preventDefault();
  const f = e.target, items = carritoValido(), btn = f.querySelector("[type=submit]");
  if (bloqueado()) { $("#dlgPedido").close(); return aviso(AVISO_BLOQ); }
  if (faltantes(items).length) { $("#dlgPedido").close(); abrirCarrito(); return aviso("Algún producto se agotó. Ajusta tu pedido."); }
  const entrega = f.entrega.value;
  // Estado inicial "pendiente"; el número consecutivo (#FOW-0001…) se reserva en la misma transacción
  const datos = {
    uid: S.cliente.uid, estado: "pendiente", fecha: new Date().toISOString(), tiempos: { pendiente: Date.now() },
    cliente: { nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim(), correo: S.cliente.correo },
    entrega, direccion: entrega === "domicilio" ? f.direccion.value.trim() : "", notas: f.notas.value.trim(),
    items: items.map((i) => { const p = producto(i.id), ev = descuentoDe(p); return { id: i.id, cant: i.cant, precio: precioFinal(p), ...(ev ? { evento: ev.nombre, descuento: ev.porcentaje } : {}), ...(i.nota ? { nota: i.nota } : {}) }; }),
    ...totales(entrega)
  };
  btn.disabled = true;
  try { await crearPedido(db, datos); }
  catch { btn.disabled = false; return aviso("No se pudo enviar el pedido. Revisa tu conexión."); }
  btn.disabled = false; $("#dlgPedido").close(); f.notas.value = "";
  vaciar(); abrirCarrito(false); aviso("¡Pedido enviado! Te avisaremos cada cambio.");
  emitir("abrirPedidos");
}

export function iniciarCarrito() {
  $("#btnCarrito").onclick = () => abrirCarrito();
  $("#cerrarCarrito").onclick = () => abrirCarrito(false);
  $("#btnContinuar").onclick = () => S.cliente ? abrirPedido() : pedirAcceso("Para hacer tu pedido inicia sesión o crea una cuenta.", abrirPedido);
  $("#selEntrega").onchange = resumenPedido;
  $("#formPedido").onsubmit = enviarPedido;
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-mas],[data-menos]"); if (!t) return;
    t.dataset.mas ? agregar(+t.dataset.mas, 1) : agregar(+t.dataset.menos, -1);
  });
  en("carrito", pintar); en("catalogo", pintar); en("sesion", pintar);
}
