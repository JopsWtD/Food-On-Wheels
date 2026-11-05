// Datos del negocio (salen en las facturas), costos de envío y Prime, sesión y zona de peligro.
import { esc } from "../../../shared/util.js";
import { doc, collection, getDocs, writeBatch } from "../../../shared/firebase.js";
import { TIENDA, PRODUCTOS, INVENTARIO, inventarioBase } from "../../../shared/catalogo.js";
import { db, auth } from "../estado.js";
import { campo, aviso, fallo } from "../ui.js";
import { guardarTienda, eliminarProductos } from "../servicios.js";
import { signOut } from "../../../shared/firebase.js";

async function borrarColecciones(nombres) { // por lotes: un writeBatch admite máximo 500 operaciones
  const refs = (await Promise.all(nombres.map((n) => getDocs(collection(db, n))))).flatMap((s) => s.docs.map((d) => d.ref));
  for (let k = 0; k < refs.length; k += 450) { const b = writeBatch(db); refs.slice(k, k + 450).forEach((r) => b.delete(r)); await b.commit(); }
}
export default {
  id: "config", icono: "⚙️", titulo: "Configuración",
  render() {
    const t = TIENDA;
    return `<section class="caja"><h2>Datos del negocio</h2><form id="formTienda" class="form">
      <div class="dos-col">${campo("Nombre comercial", "nombre", t.nombre, "text", "required")}${campo("NIT", "nit", t.nit)}</div>
      <div class="dos-col">${campo("Dirección", "direccion", t.direccion)}${campo("Teléfono", "telefono", t.telefono, "tel")}</div>
      <div class="dos-col">${campo("Costo del domicilio (COP)", "costoEnvio", t.costoEnvio, "number", 'min="0" step="100" required')}${campo("Descuento FoW Prime (%)", "primeDescuento", t.primeDescuento, "number", 'min="0" max="90" step="1" required')}</div>
      <p class="nota">El nombre, NIT, dirección y teléfono aparecen en las facturas. El costo del domicilio se suma a los pedidos a domicilio.</p>
      <div class="acciones"><button class="btn" type="submit">Guardar</button></div></form></section>
    <section class="caja"><h2>Sesión</h2><p>Sesión iniciada como <b>${esc(auth.currentUser?.email)}</b>.</p><div class="acciones"><button class="btn" data-a="salir">Cerrar sesión</button></div></section>
    <section class="caja peligro"><h2>Zona de pruebas</h2><p class="nota">Acciones para limpiar datos de prueba. No se pueden deshacer.</p><div class="acciones">
      <button class="btn gris" data-a="reiniciar">Borrar pedidos, reclamos e historial</button>
      <button class="btn gris peli" data-a="borrarCatalogo">Eliminar todos los productos y combos</button></div></section>`;
  },
  async alEnviar(form) {
    const fd = new FormData(form);
    try { await guardarTienda({ nombre: fd.get("nombre").trim(), nit: fd.get("nit").trim(), direccion: fd.get("direccion").trim(), telefono: fd.get("telefono").trim(), costoEnvio: +fd.get("costoEnvio"), primeDescuento: +fd.get("primeDescuento") }); aviso("Datos guardados"); } catch (e) { fallo(e); }
  },
  acciones: {
    salir: () => signOut(auth),
    async reiniciar() {
      if (!confirm("Se borrarán TODOS los pedidos, reclamos e historial, la numeración vuelve a #FOW-0001, el inventario a los valores iniciales y se reinician los «más vendidos». ¿Continuar?")) return;
      try {
        await borrarColecciones(["pedidos", "historial", "reclamos"]);
        const b = writeBatch(db), base = inventarioBase();
        b.delete(doc(db, "contadores", "pedidos")); b.delete(doc(db, "stats", "popularidad"));
        INVENTARIO.forEach((i) => { const x = base.find((y) => y.n === i.n); if (x && i._id) b.update(doc(db, "inventario", i._id), { s: x.s }); });
        await b.commit(); aviso("Datos reiniciados");
      } catch (e) { fallo(e); }
    },
    async borrarCatalogo() {
      if (!confirm(`Se eliminarán los ${PRODUCTOS.length} productos y combos del menú. Los pedidos antiguos se conservan. ¿Continuar?`)) return;
      try { await eliminarProductos(PRODUCTOS.map((p) => p.id)); aviso("Productos y combos eliminados"); } catch (e) { fallo(e); }
    }
  }
};