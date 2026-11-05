// Banner principal del inicio del cliente (los descuentos ahora se manejan en Eventos)
import { esc, redimensionar, IMG } from "../../../shared/util.js";
import { doc, setDoc, deleteDoc } from "../../../shared/firebase.js";
import { BANNER } from "../../../shared/catalogo.js";
import { db } from "../estado.js";
import { campo, aviso, fallo } from "../ui.js";

export default {
  id: "apariencia", icono: "🎨", titulo: "Banner",
  render() {
    const b = BANNER;
    return `<section class="caja"><h2>Banner principal del cliente</h2><form id="formBanner" class="form">${campo("Etiqueta pequeña", "etiqueta", b.etiqueta)}${campo("Título", "titulo", b.titulo)}<label>Texto<textarea name="texto" rows="2">${esc(b.texto)}</textarea></label>${campo("Texto del botón", "boton", b.boton)}${campo("Emoji (si no hay imagen)", "emoji", b.emoji)}<label>Imagen del banner<input type="file" name="img" accept="image/*"></label>${b.imagen ? `<img class="prev" src="${b.imagen}" alt=""><label class="chk"><input type="checkbox" name="quitar"> Quitar imagen</label>` : ""}<div class="acciones"><button class="btn gris" type="button" data-a="restablecer">Restablecer</button><button class="btn" type="submit">Guardar banner</button></div></form>
    <p class="nota">Los descuentos y anuncios del inicio se manejan en <a href="#eventos">Eventos</a>.</p></section>`;
  },
  async alEnviar(form) {
    const fd = new FormData(form), file = fd.get("img"); let imagen = BANNER.imagen;
    if (file && file.size) { try { imagen = await redimensionar(file, 1200, .8); } catch { return aviso("No se pudo leer la imagen."); } } else if (fd.get("quitar")) imagen = "";
    if (imagen.length > IMG.MAX) return aviso("La imagen es muy pesada. Usa una más pequeña.");
    try { await setDoc(doc(db, "config", "banner"), { etiqueta: fd.get("etiqueta"), titulo: fd.get("titulo"), texto: fd.get("texto"), boton: fd.get("boton"), emoji: fd.get("emoji") || "🍛", imagen }); aviso("Banner actualizado"); } catch (e) { fallo(e); }
  },
  acciones: {
    restablecer: () => { if (confirm("¿Volver al banner original?")) deleteDoc(doc(db, "config", "banner")).catch(fallo); }
  }
};
