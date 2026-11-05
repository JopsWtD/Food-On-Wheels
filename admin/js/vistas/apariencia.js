// Banner principal y promociones del menú del cliente
import { esc, redimensionar, IMG } from "../../../shared/util.js";
import { doc, setDoc, deleteDoc } from "../../../shared/firebase.js";
import { BANNER, PROMOCIONES, categoriasVisibles } from "../../../shared/catalogo.js";
import { db } from "../estado.js";
import { tabla, campo, editor, aviso, fallo } from "../ui.js";

const guardarPromos = (lista) => setDoc(doc(db, "config", "promos"), { lista });
const destinos = () => [...categoriasVisibles().map((c) => [c.nombre, "Categoría: " + c.nombre]), ["Combos", "Sección Combos"], ["prime", "Sección FoW Prime"]];
function editarPromo(i) {
  const e = PROMOCIONES[i] || {};
  editor(i >= 0 ? "Editar promoción" : "Nueva promoción", `${campo("Título", "titulo", e.titulo, "text", "required")}${campo("Texto", "texto", e.texto, "text", "required")}<label>Al pulsar lleva a<select name="filtro">${destinos().map(([v, t]) => `<option value="${esc(v)}" ${v === e.filtro ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`, async (fd) => {
    const lista = [...PROMOCIONES], x = { titulo: fd.get("titulo").trim(), texto: fd.get("texto").trim(), filtro: fd.get("filtro") };
    i >= 0 ? (lista[i] = x) : lista.push(x);
    await guardarPromos(lista); return true;
  });
}
export default {
  id: "apariencia", icono: "🎨", titulo: "Banner y promos",
  render() {
    const b = BANNER;
    return `<section class="caja"><h2>Banner principal del cliente</h2><form id="formBanner" class="form">${campo("Etiqueta pequeña", "etiqueta", b.etiqueta)}${campo("Título", "titulo", b.titulo)}<label>Texto<textarea name="texto" rows="2">${esc(b.texto)}</textarea></label>${campo("Texto del botón", "boton", b.boton)}${campo("Emoji (si no hay imagen)", "emoji", b.emoji)}<label>Imagen del banner<input type="file" name="img" accept="image/*"></label>${b.imagen ? `<img class="prev" src="${b.imagen}" alt=""><label class="chk"><input type="checkbox" name="quitar"> Quitar imagen</label>` : ""}<div class="acciones"><button class="btn gris" type="button" data-a="restablecer">Restablecer</button><button class="btn" type="submit">Guardar banner</button></div></form></section>
    <section class="caja"><div class="cab"><h2>Promociones</h2><button class="btn" data-a="nuevaPromo">＋ Añadir</button></div>${tabla(["Título", "Texto", "Lleva a", "Acciones"], PROMOCIONES.map((x, i) => `<tr><td><b>${esc(x.titulo)}</b></td><td>${esc(x.texto)}</td><td>${esc(x.filtro)}</td><td class="acc"><button data-a="editarPromo" data-j="${i}">Editar</button><button class="peli" data-a="borrarPromo" data-j="${i}">Eliminar</button></td></tr>`), "Sin promociones.")}<p class="nota">Las promociones son anuncios que llevan a una sección del menú. El descuento real de un producto se pone en Productos (campo «Descuento»).</p></section>`;
  },
  async alEnviar(form) {
    const fd = new FormData(form), file = fd.get("img"); let imagen = BANNER.imagen;
    if (file && file.size) { try { imagen = await redimensionar(file, 1200, .8); } catch { return aviso("No se pudo leer la imagen."); } } else if (fd.get("quitar")) imagen = "";
    if (imagen.length > IMG.MAX) return aviso("La imagen es muy pesada. Usa una más pequeña.");
    try { await setDoc(doc(db, "config", "banner"), { etiqueta: fd.get("etiqueta"), titulo: fd.get("titulo"), texto: fd.get("texto"), boton: fd.get("boton"), emoji: fd.get("emoji") || "🍛", imagen }); aviso("Banner actualizado"); } catch (e) { fallo(e); }
  },
  acciones: {
    restablecer: () => { if (confirm("¿Volver al banner original?")) deleteDoc(doc(db, "config", "banner")).catch(fallo); },
    nuevaPromo: () => editarPromo(-1), editarPromo: (d) => editarPromo(+d.j),
    borrarPromo: (d) => { if (confirm("¿Eliminar esta promoción?")) guardarPromos(PROMOCIONES.filter((_, k) => k !== +d.j)).catch(fallo); }
  }
};