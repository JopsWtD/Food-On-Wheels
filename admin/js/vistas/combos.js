import { $, esc, dinero } from "../../../shared/util.js";
import { precioFinal } from "../../../shared/dominio.js";
import { PRODUCTOS, esCombo, comboADoc, producto, sumaSeparado } from "../../../shared/catalogo.js";
import { coincide, nombreDe } from "../estado.js";
import { tabla, campo, mini, editor, campoImagen, leerImagen, aviso, fallo } from "../ui.js";
import { guardarProducto, eliminarProductos, nuevoId } from "../servicios.js";
import { vendidos, dispTxt, estadoStock, emojiCampo } from "./comun-catalogo.js";

const soloProductos = () => PRODUCTOS.filter((p) => !esCombo(p));
const textoIncluye = (inc) => inc.map((i) => `${i.cant}× ${esc(nombreDe(i.id))}`).join(", ");
const fila = (id = "", cant = 1) => `<div class="fila-receta"><select name="ci">${soloProductos().map((p) => `<option value="${p.id}" ${p.id === id ? "selected" : ""}>${esc(p.nombre)} — ${dinero(precioFinal(p))}</option>`).join("")}</select><input name="cc" type="number" min="1" step="1" value="${cant}" required aria-label="Cantidad"><button type="button" class="mini" data-a="quitarFila" aria-label="Quitar">✕</button></div>`;
// Junta filas repetidas del mismo producto
const leerIncluye = (fd) => { const cs = fd.getAll("cc"), m = new Map(); fd.getAll("ci").forEach((id, k) => m.set(+id, (m.get(+id) || 0) + Math.max(0, Math.round(+cs[k] || 0)))); return [...m].filter(([, c]) => c > 0).map(([id, cant]) => ({ id, cant })); };
function resumen() { // se actualiza mientras se edita
  const f = $("#formDlg"), r = $("#resCombo"); if (!r) return;
  const fd = new FormData(f), inc = leerIncluye(fd), sep = sumaSeparado(inc), precio = +fd.get("precio") || 0;
  r.innerHTML = inc.length ? `Por separado: <b>${dinero(sep)}</b> · Combo: <b>${dinero(precio)}</b> · ${precio && precio < sep ? `<span class="pos">El cliente ahorra ${dinero(sep - precio)} (${Math.round((sep - precio) / sep * 100)}%)</span>` : '<span class="neg">El combo no tiene ahorro</span>'}` : "Agrega al menos un producto.";
}
function editar(id) {
  if (!soloProductos().length) return aviso("Primero crea productos en la sección Productos.");
  const e = PRODUCTOS.find((p) => p.id === id) || {};
  editor(id ? "Editar combo" : "Nuevo combo", `
    ${campo("Nombre", "nombre", e.nombre, "text", 'required maxlength="60"')}
    <label>Descripción<textarea name="descripcion" rows="2" maxlength="220">${esc(e.descripcion)}</textarea></label>
    <p class="nota"><b>Productos del combo</b> y cuántas unidades de cada uno incluye.</p>
    <div id="itemsCombo">${(e.incluye || []).map((i) => fila(i.id, i.cant)).join("") || fila()}</div>
    <button class="btn gris" type="button" data-a="agregarProducto">＋ Producto</button>
    <div class="dos-col">${campo("Precio fijo del combo (COP)", "precio", e.precio, "number", 'required min="1" step="1" inputmode="numeric"')}${emojiCampo(e.emoji || "🍱")}</div>
    <p class="resumen-combo" id="resCombo"></p>
    ${campoImagen(e)}`,
  async (fd) => {
    const incluye = leerIncluye(fd);
    if (!incluye.length) return "Agrega al menos un producto al combo.";
    let img; try { img = await leerImagen(fd, e.imagen); } catch (err) { return err.message; }
    await guardarProducto(comboADoc({ id: e.id || nuevoId(PRODUCTOS), nombre: fd.get("nombre").trim(), descripcion: fd.get("descripcion").trim(), precio: +fd.get("precio"), emoji: fd.get("emoji") || "🍱", imagenGrande: e.imagenGrande }, incluye), img);
    return true;
  });
  resumen();
}

export default {
  id: "combos", icono: "🍱", titulo: "Combos",
  render() {
    const l = PRODUCTOS.filter(esCombo).filter((p) => coincide(p.nombre));
    const filas = l.map((p) => { const sep = sumaSeparado(p.incluye), ahorro = sep - p.precio;
      return `<tr><td>${mini(p)}</td><td><b>${esc(p.nombre)}</b></td><td class="det">${textoIncluye(p.incluye)}</td><td><b>${dinero(p.precio)}</b><small class="separado">Por separado ${dinero(sep)}</small>${ahorro > 0 ? `<span class="est e3">ahorra ${Math.round(ahorro / sep * 100)}%</span>` : '<span class="est e1">sin ahorro</span>'}</td><td>${vendidos(p)}</td><td>${dispTxt(p)}</td><td>${estadoStock(p)}</td><td class="acc"><button data-a="editar" data-id="${p.id}">Editar</button><button class="peli" data-a="eliminar" data-id="${p.id}">Eliminar</button></td></tr>`; });
    return `<section class="caja"><div class="cab"><h2>Combos (${l.length})</h2><button class="btn" data-a="nuevo">＋ Crear combo</button></div>${tabla(["", "Combo", "Incluye", "Precio", "Vendidos", "Disponibles", "Estado", "Acciones"], filas, "Aún no hay combos.")}<p class="nota">Un combo se agota cuando alguno de sus productos ya no se puede preparar. En el menú del cliente aparecen en su propia sección.</p></section>`;
  },
  alEditar: resumen,
  acciones: {
    nuevo: () => editar(0),
    editar: (d) => editar(+d.id),
    async eliminar(d) {
      if (!confirm("¿Eliminar este combo? Desaparece del menú del cliente.")) return;
      try { await eliminarProductos([+d.id]); aviso("Combo eliminado"); } catch (e) { fallo(e); }
    },
    agregarProducto: () => { $("#itemsCombo").insertAdjacentHTML("beforeend", fila()); resumen(); },
    quitarFila: (d, btn) => { btn.closest(".fila-receta").remove(); resumen(); }
  }
};