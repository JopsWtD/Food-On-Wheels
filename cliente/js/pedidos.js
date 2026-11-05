// "Mis pedidos": seguimiento en vivo, cancelar, reportar un problema, volver a pedir y ver la factura.
import { $, esc, dinero, hora, fechaHora, fecha, IMG, redimensionar } from "../../shared/util.js";
import { doc, setDoc, updateDoc } from "../../shared/firebase.js";
import { pasosDe, etiquetaCliente, terminado, codigoPedido, puedeReclamar, VENTANA_RECLAMO, MOTIVOS_RECLAMO } from "../../shared/dominio.js";
import { producto, TIENDA, agotado } from "../../shared/catalogo.js";
import { abrirFactura } from "../../shared/pedidos.js";
import { S, db, en, nombreDe } from "./estado.js";
import { aviso, dialogo, opcion, panel, pedirAcceso } from "./ui.js";
import { agregar, abrirCarrito } from "./carrito.js";
import { sinLeerDe } from "./chat.js";

const limpio = (t) => esc(t);
// Chat con el restaurante: abierto mientras el pedido está en curso; después solo se puede ver el historial
function botonChat(p) {
  const c = S.chats[p.id], n = sinLeerDe(p.id), fin = terminado(p);
  if (fin && !c) return "";
  const texto = fin ? "💬 Ver chat" : c ? "💬 Chat con el restaurante" : "💬 Escribir al restaurante";
  return `<button class="btn ${fin ? "btn-gris" : "btn-verde"} btn-mini btn-chat" type="button" data-chat="${p.id}">${texto}${n ? `<span class="chat-cont" aria-label="${n} sin leer">${n}</span>` : ""}</button>`;
}
function bloqueAcciones(p) {
  if (p.estado === "pendiente") return `<div class="pedido-botones">${botonChat(p)}</div><div class="pedido-acciones"><button class="enlace peligro" type="button" data-cancelar-pedido="${p.id}">Cancelar pedido</button><small>Puedes cancelarlo hasta que empecemos a prepararlo.</small></div>`;
  let h = "";
  const r = S.reclamos[p.id];
  if (r) {
    const txt = r.estado === "abierto" ? "📮 Tu reclamo está en revisión. Te responderemos aquí mismo."
      : r.estado === "rechazado" ? "❌ Tu reclamo fue rechazado."
      : r.resolucion === "reembolso" ? `✅ Reclamo aprobado: te devolveremos ${dinero(r.monto)}.`
      : `✅ Reclamo aprobado: te reenviamos lo que faltó en el pedido ${codigoPedido(r.reposicionId)}.`;
    h += `<div class="reclamo-estado ${r.estado}"><b>${txt}</b>${r.respuesta ? `<span>Respuesta del restaurante: “${limpio(r.respuesta)}”</span>` : ""}</div>`;
  }
  if (!terminado(p)) return h + `<div class="pedido-botones">${botonChat(p)}</div>`;
  const botones = [botonChat(p)].filter(Boolean);
  if (!p.reposicionDe) botones.push(`<button class="btn btn-gris btn-mini" type="button" data-repetir="${p.id}">🔁 Volver a pedir</button>`);
  if (p.estado === "entregado" && !p.reposicionDe) botones.push(`<button class="btn btn-gris btn-mini" type="button" data-factura="${p.id}">🧾 Factura</button>`);
  if (!r && puedeReclamar(p)) botones.push(`<button class="btn btn-gris btn-mini" type="button" data-reclamo="${p.id}" title="Disponible hasta ${fechaHora(p.tiempos.entregado + VENTANA_RECLAMO)}">⚠️ Reportar un problema</button>`);
  return h + (botones.length ? `<div class="pedido-botones">${botones.join("")}</div>` : "");
}
function tarjetaPedido(p, k) {
  const rec = p.entrega === "recoger", pasos = pasosDe(p.entrega);
  let i = pasos.indexOf(p.estado);
  if (i < 0) i = p.estado === "en camino" ? pasos.indexOf("listo") : 0; // estado antiguo que no aplica a este tipo de entrega
  const items = p.items.map((x) => `${x.cant}× ${esc(nombreDe(x.id))}${x.nota ? ` <i>(${esc(x.nota)})</i>` : ""}`).join(", ");
  const desde = p.tiempos?.[p.estado] ? `<p class="pedido-hora">${etiquetaCliente(p, pasos[i])} ${p.estado === "entregado" ? "a las" : "desde las"} ${hora(p.tiempos[p.estado])}</p>` : "";
  const ruta = p.estado === "cancelado"
    ? `<p class="pedido-cancel">${p.canceladoPor === "cliente" ? "Cancelaste este pedido" : "El restaurante canceló este pedido"}${p.motivoCancelacion ? `<span>Motivo: ${esc(p.motivoCancelacion)}</span>` : ""}</p>`
    : `<div class="ruta${rec ? " recoger" : ""}${i === pasos.length - 1 ? " fin" : ""}" style="--p:${i / (pasos.length - 1)};--n:${pasos.length}" role="img" aria-label="Estado: ${etiquetaCliente(p, pasos[i])}"><i class="barra"></i><span class="moto" aria-hidden="true">${rec ? "🛍️" : "🛵"}</span>${pasos.map((s, n) => `<span class="paso ${n < i ? "hecho" : n === i ? "actual" : ""}"><u></u><small>${etiquetaCliente(p, s)}</small></span>`).join("")}</div>${desde}`;
  return `<article class="pedido${p.estado === "cancelado" ? " cancelado" : ""}" style="--i:${k}"><header><b>${codigoPedido(p.id)}</b><span>${fechaHora(p.fecha)}</span></header>${p.reposicionDe ? `<p class="repo">🔁 Reposición sin costo del pedido ${codigoPedido(p.reposicionDe)}</p>` : ""}<p class="pedido-items">${items}</p>${ruta}${bloqueAcciones(p)}<footer><span class="tipo-entrega ${rec ? "recoger" : ""}">${rec ? "🏪 Recoger en el local" : "🛵 Domicilio"}</span><b>${p.reposicionDe ? "Sin costo" : dinero(p.total)}</b></footer></article>`;
}
function pintar() {
  const l = S.cliente ? S.pedidos : [], vivos = l.filter((p) => !terminado(p)), pasados = l.filter(terminado);
  $("#contPedidos").textContent = vivos.length; $("#contPedidos").hidden = !vivos.length;
  $("#listaPedidos").innerHTML = l.length
    ? (vivos.length ? `<h3 class="grupo">En curso <span>${vivos.length}</span></h3>` + vivos.map(tarjetaPedido).join("") : "")
      + (pasados.length ? `<h3 class="grupo">Anteriores</h3>` + pasados.map((p, k) => tarjetaPedido(p, k + vivos.length)).join("") : "")
    : `<div class="vacio vacio-grande"><span aria-hidden="true">🧾</span><p>Aún no tienes pedidos. ¡Pide algo rico!</p><button class="btn btn-naranja" type="button" data-ir-menu>Ver el menú</button></div>`;
}
export function abrirPedidos(abrir = true) {
  if (abrir && !S.cliente) return pedirAcceso("Inicia sesión para ver el estado de tus pedidos.", () => abrirPedidos());
  if (abrir) pintar();
  panel("panelPedidos", abrir);
}

/* ===== Acciones ===== */
function cancelar(id) {
  const p = S.pedidos.find((x) => x.id == id);
  dialogo(`¿Cancelar el pedido ${codigoPedido(p.id)}?`, `<p class="nota">Como todavía no empezamos a prepararlo, se cancela sin ningún costo.</p>
    <fieldset class="opciones"><legend>¿Por qué lo cancelas?</legend>${["Me equivoqué en el pedido", "Ya no lo necesito", "Está tardando mucho", "Otro motivo"].map((m, i) => opcion("radio", "motivo", m, m, !i)).join("")}</fieldset>`,
  async (fd) => {
    try { await updateDoc(doc(db, "pedidos", String(p.id)), { estado: "cancelado", motivoCancelacion: fd.get("motivo"), canceladoPor: "cliente", tiempos: { ...(p.tiempos || {}), cancelado: Date.now() } }); }
    catch { return "Ya no se puede cancelar: el restaurante empezó a preparar tu pedido."; }
    aviso("Pedido cancelado"); return true;
  }, "Sí, cancelar");
}
function reclamar(id) {
  const p = S.pedidos.find((x) => x.id == id), sinCosto = !p.total;
  dialogo(`Reportar un problema con ${codigoPedido(p.id)}`, `
    <label>¿Qué pasó?<select name="motivo">${Object.entries(MOTIVOS_RECLAMO).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></label>
    <fieldset class="opciones"><legend>¿Qué productos tuvieron el problema?</legend>${p.items.map((x, k) => opcion("checkbox", "item", k, `${x.cant}× ${esc(nombreDe(x.id))}`, p.items.length === 1)).join("")}</fieldset>
    <label>Cuéntanos qué pasó<textarea name="descripcion" rows="3" required minlength="10" placeholder="Ej. Pedí 2 bandejas y llegó solo una."></textarea></label>
    <label>Foto de lo que recibiste<input type="file" name="foto" accept="image/*" required></label>
    <img class="prev-foto" id="prevFoto" alt="Vista previa de la foto" hidden>
    <fieldset class="opciones"><legend>¿Qué solución prefieres?</legend>
      ${sinCosto ? "" : opcion("radio", "solicitud", "reembolso", `Que me devuelvan el dinero (${dinero(p.total)})`, true)}
      ${opcion("radio", "solicitud", "reenvio", "Que me reenvíen los productos marcados", sinCosto)}</fieldset>
    <p class="nota">El restaurante revisará tu reclamo y te responderá aquí, en «Mis pedidos».</p>`,
  async (fd) => {
    const marcados = fd.getAll("item").map(Number);
    if (!marcados.length) return "Marca al menos un producto.";
    let foto; try { foto = await redimensionar(fd.get("foto"), 1000, .75); } catch { return "No se pudo leer la foto. Prueba con otra."; }
    if (foto.length > IMG.MAX) return "La foto es muy pesada. Prueba con otra.";
    try {
      await setDoc(doc(db, "reclamos", String(p.id)), {
        pedidoId: p.id, uid: S.cliente.uid, nombre: S.cliente.nombre, correo: S.cliente.correo, fecha: new Date().toISOString(),
        motivo: fd.get("motivo"), items: marcados.map((k) => ({ id: p.items[k].id, cant: p.items[k].cant })),
        descripcion: fd.get("descripcion").trim(), foto, solicitud: fd.get("solicitud"), estado: "abierto"
      });
    } catch { return "No se pudo enviar el reclamo. Solo se puede reportar durante las 24 horas siguientes a la entrega."; }
    aviso("Reclamo enviado"); return true;
  }, "Enviar reclamo");
  $("#formGen").foto.onchange = (e) => { const f = e.target.files[0], img = $("#prevFoto"); if (f) { img.src = URL.createObjectURL(f); img.hidden = false; } };
}
function repetir(id) { // agrega de nuevo al carrito todo lo que siga disponible
  const p = S.pedidos.find((x) => x.id == id); let ok = 0, no = 0;
  p.items.forEach((i) => { const prod = producto(i.id); (prod && !agotado(prod) && agregar(i.id, i.cant, i.nota)) ? ok++ : no++; });
  if (!ok) return aviso("Esos productos ya no están disponibles.");
  abrirCarrito(); aviso(no ? `Agregamos ${ok} producto${ok > 1 ? "s" : ""}; ${no} ya no está${no > 1 ? "n" : ""} disponible${no > 1 ? "s" : ""}.` : "Agregamos tu pedido anterior al carrito");
}

export function iniciarPedidos() {
  $("#btnPedidos").onclick = $("#btnPedidos2").onclick = () => abrirPedidos();
  $("#cerrarPedidos").onclick = () => abrirPedidos(false);
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-cancelar-pedido],[data-reclamo],[data-repetir],[data-factura]"); if (!t) return;
    const d = t.dataset;
    if (d.cancelarPedido) cancelar(d.cancelarPedido);
    if (d.reclamo) reclamar(d.reclamo);
    if (d.repetir) repetir(d.repetir);
    if (d.factura) abrirFactura(S.pedidos.find((x) => x.id == d.factura), TIENDA, nombreDe);
  });
  en("pedidos", pintar); en("sesion", pintar); en("catalogo", (t) => t === "productos" && pintar());
  en("abrirPedidos", () => abrirPedidos());
}
