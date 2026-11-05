// Categorías del menú: nombre, emoji, orden en que aparecen y si están visibles para el cliente.
import { esc } from "../../../shared/util.js";
import { doc, collection, setDoc, updateDoc, writeBatch } from "../../../shared/firebase.js";
import { CATEGORIAS, productosDeCategoria } from "../../../shared/catalogo.js";
import { db } from "../estado.js";
import { tabla, campo, editor, aviso, fallo } from "../ui.js";
import { borrar } from "../servicios.js";

function editar(id) {
  const e = CATEGORIAS.find((c) => c.id === id) || { emoji: "🍽️", visible: true };
  editor(id ? "Editar categoría" : "Nueva categoría", `${campo("Nombre", "nombre", e.nombre, "text", 'required maxlength="40"')}<label>Emoji<input name="emoji" value="${esc(e.emoji)}" maxlength="8"></label><label class="chk"><input type="checkbox" name="visible" ${e.visible !== false ? "checked" : ""}> Visible en el menú del cliente</label>`, async (fd) => {
    const nombre = fd.get("nombre").trim();
    if (CATEGORIAS.some((c) => c.id !== id && c.nombre.toLowerCase() === nombre.toLowerCase())) return "Ya existe una categoría con ese nombre.";
    const datos = { nombre, emoji: fd.get("emoji") || "🍽️", visible: !!fd.get("visible") };
    if (id) await updateDoc(doc(db, "categorias", id), datos);
    else await setDoc(doc(collection(db, "categorias")), { ...datos, orden: CATEGORIAS.length ? Math.max(...CATEGORIAS.map((c) => c.orden ?? 0)) + 1 : 0 });
    return true;
  });
}
async function mover(id, dir) { // intercambia el orden con la categoría vecina
  const i = CATEGORIAS.findIndex((c) => c.id === id), j = i + dir;
  if (j < 0 || j >= CATEGORIAS.length) return;
  const b = writeBatch(db);
  CATEGORIAS.forEach((c, k) => b.update(doc(db, "categorias", c.id), { orden: k === i ? j : k === j ? i : k }));
  await b.commit().catch(fallo);
}

export default {
  id: "categorias", icono: "🗂️", titulo: "Categorías",
  render() {
    const filas = CATEGORIAS.map((c, i) => `<tr class="${c.visible === false ? "bloq" : ""}"><td class="ajuste"><button data-a="subir" data-id="${c.id}" ${i ? "" : "disabled"} aria-label="Subir">↑</button><button data-a="bajar" data-id="${c.id}" ${i < CATEGORIAS.length - 1 ? "" : "disabled"} aria-label="Bajar">↓</button></td><td><span class="em">${esc(c.emoji)}</span></td><td><b>${esc(c.nombre)}</b></td><td>${productosDeCategoria(c.id).length}</td><td>${c.visible === false ? '<span class="est e5">Oculta</span>' : '<span class="est e3">Visible</span>'}</td><td class="acc"><button data-a="editar" data-id="${c.id}">Editar</button><button class="peli" data-a="eliminar" data-id="${c.id}">Eliminar</button></td></tr>`);
    return `<section class="caja"><div class="cab"><h2>Categorías (${CATEGORIAS.length})</h2><button class="btn" data-a="nueva">＋ Nueva categoría</button></div>${tabla(["Orden", "", "Categoría", "Productos", "Estado", "Acciones"], filas, "Aún no hay categorías. Crea la primera para empezar a cargar productos.")}<p class="nota">El orden de esta lista es el orden de las secciones en el menú del cliente. Los combos siempre tienen su propia sección.</p></section>`;
  },
  acciones: {
    nueva: () => editar(null),
    editar: (d) => editar(d.id),
    subir: (d) => mover(d.id, -1),
    bajar: (d) => mover(d.id, 1),
    async eliminar(d) {
      const c = CATEGORIAS.find((x) => x.id === d.id), n = productosDeCategoria(c.id).length;
      if (n) return alert(`«${c.nombre}» tiene ${n} producto${n > 1 ? "s" : ""}. Muévelos a otra categoría o elimínalos antes.`);
      if (!confirm(`¿Eliminar la categoría «${c.nombre}»?`)) return;
      try { await borrar("categorias", c.id); aviso("Categoría eliminada"); } catch (e) { fallo(e); }
    }
  }
};