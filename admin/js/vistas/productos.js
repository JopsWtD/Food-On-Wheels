import { esc, dinero } from "../../../shared/util.js";
import { PRODUCTOS, RECETAS, INVENTARIO, CATEGORIAS, esCombo, categoriaDe, combosQueUsan, recetaADoc } from "../../../shared/catalogo.js";
import { coincide } from "../estado.js";
import { tabla, campo, mini, editor, campoImagen, leerImagen, aviso, fallo } from "../ui.js";
import { guardarProducto, eliminarProductos, nuevoId } from "../servicios.js";
import { vendidos, dispTxt, estadoStock, emojiCampo } from "./comun-catalogo.js";

let cat = "todas";
const lista = () => PRODUCTOS.filter((p) => !esCombo(p));
function filaReceta(k = "", c = "") {
  return `<div class="fila-receta"><select name="rk">${INVENTARIO.map((i) => `<option value="${esc(i.n)}" ${i.n === k ? "selected" : ""}>${esc(i.n)} (${esc(i.u)})</option>`).join("")}</select><input name="rc" type="number" step="any" min="0.001" value="${c}" required aria-label="Cantidad"><button type="button" class="mini" data-a="quitarFila" aria-label="Quitar">✕</button></div>`;
}
function editar(id) {
  if (!CATEGORIAS.length) return aviso("Primero crea una categoría en la sección Categorías.");
  const e = PRODUCTOS.find((p) => p.id === id) || {}, catActual = categoriaDe(e)?.id;
  editor(id ? "Editar producto" : "Nuevo producto", `
    ${campo("Nombre", "nombre", e.nombre, "text", "required maxlength=\"60\"")}
    <label>Descripción<textarea name="descripcion" rows="2" maxlength="220">${esc(e.descripcion)}</textarea></label>
    <div class="dos-col">${campo("Precio (COP)", "precio", e.precio, "number", 'required min="1" step="1" inputmode="numeric"')}${campo("Descuento (%)", "descuento", e.descuento || 0, "number", 'min="0" max="90" step="1" inputmode="numeric"')}</div>
    <div class="dos-col"><label>Categoría<select name="categoriaId" required>${CATEGORIAS.map((c) => `<option value="${c.id}" ${c.id === catActual ? "selected" : ""}>${esc(c.emoji)} ${esc(c.nombre)}</option>`).join("")}</select></label>${emojiCampo(e.emoji || "🍽️")}</div>
    ${campoImagen(e)}
    <p class="nota"><b>Receta:</b> insumos que gasta una unidad. Con esto se calcula cuántas unidades se pueden preparar.</p>
    <div id="recetas">${(RECETAS[id] || []).map(([k, c]) => filaReceta(k, c)).join("")}</div>
    <button class="btn gris" type="button" data-a="agregarIngrediente">＋ Ingrediente</button>`,
  async (fd) => {
    let img; try { img = await leerImagen(fd, e.imagen); } catch (err) { return err.message; }
    const pid = e.id || nuevoId(PRODUCTOS), cs = fd.getAll("rc");
    const receta = fd.getAll("rk").map((k, i) => [k, +cs[i]]).filter(([, c]) => c > 0);
    await guardarProducto({ id: pid, nombre: fd.get("nombre").trim(), descripcion: fd.get("descripcion").trim(), precio: +fd.get("precio"), descuento: +fd.get("descuento") || 0, categoriaId: fd.get("categoriaId"), emoji: fd.get("emoji") || "🍽️", imagenGrande: e.imagenGrande, receta: recetaADoc(receta) }, img);
    return true;
  });
}

export default {
  id: "productos", icono: "📦", titulo: "Productos",
  render() {
    const todos = lista();
    const usadas = [["todas", "Todas"], ...CATEGORIAS.filter((c) => todos.some((p) => categoriaDe(p)?.id === c.id)).map((c) => [c.id, `${esc(c.emoji)} ${esc(c.nombre)}`])];
    const filas = todos.filter((p) => (cat === "todas" || categoriaDe(p)?.id === cat) && coincide(p.nombre, categoriaDe(p)?.nombre)).map((p) => `<tr><td>${mini(p)}</td><td><b>${esc(p.nombre)}</b></td><td>${esc(categoriaDe(p)?.nombre ?? "Sin categoría")}</td><td>${dinero(p.precio)}${p.descuento ? ` <span class="est e1">-${p.descuento}%</span>` : ""}</td><td>${vendidos(p)}</td><td>${dispTxt(p)}</td><td>${estadoStock(p)}</td><td class="acc"><button data-a="editar" data-id="${p.id}">Editar</button><button class="peli" data-a="eliminar" data-id="${p.id}">Eliminar</button></td></tr>`);
    // Sin categorías no se pueden crear productos, pero los que ya existen se siguen mostrando
    const alertaCat = !CATEGORIAS.length ? `<p class="alerta">ℹ️ Para crear productos primero necesitas al menos una categoría. <a href="#categorias">Crear categoría →</a></p>` : "";
    return `${alertaCat}<section class="caja"><div class="cab"><h2>Productos (${todos.length})</h2><button class="btn" data-a="nuevo">＋ Añadir producto</button></div>
      <div class="chips">${usadas.map(([v, t]) => `<button class="chip" data-a="cat" data-v="${v}" aria-pressed="${v === cat}">${t}</button>`).join("")}</div>
      ${tabla(["", "Producto", "Categoría", "Precio", "Vendidos", "Disponibles", "Estado", "Acciones"], filas, "Aún no hay productos. Crea el primero con «Añadir producto».")}
      <p class="nota">«Disponibles» son las unidades que se pueden preparar con el inventario y la receta. «Vendidos» cuenta los pedidos entregados.</p></section>`;
  },
  acciones: {
    cat: (d) => { cat = d.v; },
    nuevo: () => editar(0),
    editar: (d) => editar(+d.id),
    async eliminar(d) {
      const p = PRODUCTOS.find((x) => x.id === +d.id), usan = combosQueUsan(p.id);
      if (usan.length) return alert(`«${p.nombre}» está en ${usan.length === 1 ? "el combo" : "los combos"}: ${usan.map((c) => c.nombre).join(", ")}.\nQuítalo de ahí antes de eliminarlo.`);
      if (!confirm(`¿Eliminar «${p.nombre}»? Desaparece del menú del cliente.`)) return;
      try { await eliminarProductos([p.id]); aviso("Producto eliminado"); } catch (e) { fallo(e); }
    },
    agregarIngrediente: () => document.querySelector("#recetas").insertAdjacentHTML("beforeend", filaReceta()),
    quitarFila: (d, btn) => btn.closest(".fila-receta").remove()
  }
};