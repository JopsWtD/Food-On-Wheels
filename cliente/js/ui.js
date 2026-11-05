// Piezas de interfaz del cliente: avisos, ventana genérica y acceso.
import { $ } from "../../shared/util.js";

export function aviso(msg) {
  const el = $("#aviso"); el.textContent = msg; el.classList.add("ver");
  clearTimeout(aviso.t); aviso.t = setTimeout(() => el.classList.remove("ver"), 2400);
}
// Ventana genérica (cancelar, reclamar…). enviar(FormData) devuelve true o un texto de error.
export function dialogo(titulo, html, enviar, textoBoton) {
  const f = $("#formGen");
  f.innerHTML = `<h2>${titulo}</h2>${html}<p class="error" id="errGen" role="alert"></p><div class="acciones"><button class="btn btn-gris" type="button" data-cerrar>Volver</button><button class="btn btn-verde" type="submit">${textoBoton}</button></div>`;
  f.onsubmit = async (e) => {
    e.preventDefault(); const b = f.querySelector("[type=submit]"); b.disabled = true;
    let r; try { r = await enviar(new FormData(f)); } catch { r = "No se pudo enviar. Revisa tu conexión."; }
    b.disabled = false;
    if (r === true) $("#dlgGen").close(); else $("#errGen").textContent = r;
  };
  $("#dlgGen").showModal();
}
export const opcion = (tipo, name, value, texto, marcado) => `<label class="opcion"><input type="${tipo}" name="${name}" value="${value}" ${marcado ? "checked" : ""}><span>${texto}</span></label>`;

// Pide iniciar sesión y, al lograrlo, continúa con "siguiente"
export const acceso = { siguiente: null };
export function pedirAcceso(msg, siguiente = null) {
  $("#msgLogin").textContent = msg; acceso.siguiente = siguiente;
  $("#dlgLogin").showModal();
}
// Paneles laterales (carrito y mis pedidos)
export function panel(id, abrir) {
  ["carrito", "panelPedidos"].forEach((p) => { const el = $("#" + p), on = p === id && abrir; el.classList.toggle("abierto", on); el.setAttribute("aria-hidden", !on); });
  $("#velo").hidden = !abrir; document.body.classList.toggle("bloqueo", abrir);
  $("#btnPedidos2").classList.toggle("activo", id === "panelPedidos" && abrir);
}
