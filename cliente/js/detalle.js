// Hoja de detalle de un producto: imagen grande, descripción, qué incluye, cantidad y nota para la cocina.
import { $, esc, dinero } from "../../shared/util.js";
import { doc, getDoc } from "../../shared/firebase.js";
import { precioFinal } from "../../shared/dominio.js";
import { producto, esCombo, sumaSeparado, disponibles, agotado, categoriaDe } from "../../shared/catalogo.js";
import { S, db, nombreDe } from "./estado.js";
import { agregar } from "./carrito.js";
import { aviso } from "./ui.js";

const imagenes = new Map(); // imágenes grandes ya descargadas (no se vuelven a pedir)
async function imagenGrande(p, img) {
  if (!p.imagenGrande) return;
  try {
    if (!imagenes.has(p.id)) imagenes.set(p.id, (await getDoc(doc(db, "imagenes", String(p.id)))).data()?.data);
    const src = imagenes.get(p.id); if (src && img.isConnected) { img.src = src; img.classList.add("nitida"); }
  } catch { /* se queda la miniatura */ }
}
export function abrirDetalle(id) {
  const p = producto(id); if (!p) return;
  const item = S.carrito.find((i) => i.id === p.id), d = disponibles(p.id), ag = agotado(p), pf = precioFinal(p);
  let cant = 1;
  const dlg = $("#dlgProducto");
  dlg.innerHTML = `<form method="dialog" class="hoja-cont">
    <button class="btn-icono cerrar-hoja" type="button" data-cerrar aria-label="Cerrar">✕</button>
    <div class="hoja-img">${p.imagen ? `<img src="${p.imagen}" alt="${esc(p.nombre)}">` : `<span aria-hidden="true">${esc(p.emoji)}</span>`}${p.descuento ? `<span class="etiqueta-desc">-${p.descuento}%</span>` : ""}</div>
    <div class="hoja-cuerpo">
      <p class="hoja-cat">${esCombo(p) ? "🍱 Combo" : esc((categoriaDe(p)?.emoji || "") + " " + (categoriaDe(p)?.nombre || ""))}</p>
      <h2>${esc(p.nombre)}</h2>
      ${p.descripcion ? `<p class="hoja-desc">${esc(p.descripcion)}</p>` : ""}
      ${esCombo(p) ? `<div class="hoja-incluye"><b>Incluye</b><ul>${p.incluye.map((i) => `<li><span>${i.cant}×</span> ${esc(nombreDe(i.id))}</li>`).join("")}</ul>${sumaSeparado(p.incluye) > p.precio ? `<span class="ahorro">Ahorras ${dinero(sumaSeparado(p.incluye) - p.precio)} frente a pedirlos por separado</span>` : ""}</div>` : ""}
      <p class="hoja-precio">${p.descuento ? `<s>${dinero(p.precio)}</s>` : ""}${dinero(pf)}${d !== null && d <= 5 && !ag ? `<small>${d === 1 ? "¡Última unidad!" : `Quedan ${d}`}</small>` : ""}</p>
      <label class="hoja-nota"><span>Indicaciones para la cocina <small>(opcional)</small></span><textarea name="nota" rows="2" maxlength="120" placeholder="Ej. sin cebolla, salsa aparte">${esc(item?.nota || "")}</textarea></label>
    </div>
    <footer class="hoja-pie">
      <div class="cantidad grande"><button type="button" data-paso="-1" aria-label="Menos">−</button><output id="cantHoja">1</output><button type="button" data-paso="1" aria-label="Más">+</button></div>
      <button class="btn btn-naranja hoja-agregar" type="submit" ${ag ? "disabled" : ""}>${ag ? "Agotado" : `Agregar · <b id="totalHoja">${dinero(pf)}</b>`}</button>
    </footer></form>`;
  const f = $("form", dlg), max = d === null ? 99 : Math.max(1, d - (item?.cant || 0));
  f.onclick = (e) => {
    const b = e.target.closest("[data-paso]"); if (!b) return;
    cant = Math.min(max, Math.max(1, cant + +b.dataset.paso));
    $("#cantHoja").value = cant; if ($("#totalHoja")) $("#totalHoja").textContent = dinero(pf * cant);
    if (cant === max && +b.dataset.paso > 0 && d !== null) aviso("No hay más unidades disponibles");
  };
  f.onsubmit = (e) => {
    e.preventDefault();
    if (agregar(p.id, cant, f.nota.value.trim())) { dlg.close(); aviso(`${cant}× ${p.nombre} agregado al pedido`); }
  };
  dlg.showModal();
  imagenGrande(p, $(".hoja-img img", dlg) || document.createElement("img"));
}
export function iniciarDetalle() {
  document.addEventListener("click", (e) => { const t = e.target.closest("[data-abrir]"); if (t) abrirDetalle(+t.dataset.abrir); });
}
