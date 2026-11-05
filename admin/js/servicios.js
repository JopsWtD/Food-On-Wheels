// Operaciones del admin que escriben en Firestore. Las vistas las usan; aquí vive la lógica delicada.
import { doc, collection, getDoc, getDocs, setDoc, deleteDoc, addDoc, query, where, limit, writeBatch, runTransaction, deleteField, increment } from "../../shared/firebase.js";
import { RECETAS, INVENTARIO, PROMOCIONES_BASE, TIENDA_BASE, inventarioBase, recetaADoc, necesidades, incluyeDe, esCombo, producto } from "../../shared/catalogo.js";
import { siguiente, FINALES, codigoPedido, precioFinal } from "../../shared/dominio.js";
import { db } from "./estado.js";
import { aviso } from "./ui.js";

const r3 = (n) => Math.round(n * 1000) / 1000;
export const registrar = (n, c, motivo) => addDoc(collection(db, "historial"), { f: new Date().toISOString(), n, c: r3(c), motivo });

/* Cambia el estado de un pedido en una TRANSACCIÓN (todo o nada, aunque dos admins actúen a la vez):
   - solo permite avanzar al paso siguiente o cancelar (las reglas de Firestore exigen lo mismo)
   - descuenta los insumos al empezar a prepararlo y los devuelve si se cancela
   - al entregarlo, suma las unidades a stats/popularidad (sección «Los más pedidos» del cliente) */
export async function cambiarEstado(p, nuevo, extra = {}) {
  const ref = doc(db, "pedidos", String(p.id));
  await runTransaction(db, async (tx) => {
    const ped = (await tx.get(ref)).data();
    if (nuevo !== siguiente(ped) && !(nuevo === "cancelado" && !FINALES.includes(ped.estado))) throw new Error("estado");
    const consume = !["pendiente", "cancelado"].includes(nuevo);
    const signo = consume && !ped.descontado ? -1 : !consume && ped.descontado ? 1 : 0;
    const movs = [];
    if (signo) {
      const t = necesidades(ped.items);
      const snaps = await Promise.all(INVENTARIO.filter((i) => t[i.n] && i._id).map((i) => tx.get(doc(db, "inventario", i._id))));
      if (signo < 0) {
        const hay = Object.fromEntries(snaps.filter((x) => x.exists()).map((x) => [x.data().n, x.data().s]));
        const falta = Object.keys(t).filter((k) => !(hay[k] >= t[k] - 1e-9));
        if (falta.length) throw Object.assign(new Error("falta"), { falta });
      }
      snaps.filter((x) => x.exists()).forEach((x) => { // en una transacción primero se lee todo y después se escribe
        const d = x.data(); tx.update(x.ref, { s: Math.max(0, r3(d.s + signo * t[d.n])) }); movs.push([d.n, signo * t[d.n]]);
      });
    }
    tx.update(ref, { estado: nuevo, descontado: signo ? signo < 0 : !!ped.descontado, tiempos: { ...(ped.tiempos || {}), [nuevo]: Date.now() }, ...extra });
    if (nuevo === "entregado" && !ped.reposicionDe) {
      const vendidos = {}; ped.items.forEach((i) => (vendidos[i.id] = increment(i.cant)));
      tx.set(doc(db, "stats", "popularidad"), { vendidos }, { merge: true });
    }
    movs.forEach(([n, c]) => tx.set(doc(collection(db, "historial")), { f: new Date().toISOString(), n, c: r3(c), motivo: (signo < 0 ? "Pedido " : "Devolución ") + codigoPedido(p.id) }));
  });
}
export const errorEstado = (e) => aviso(e.message === "falta" ? "No alcanza el inventario: " + e.falta.join(", ")
  : e.message === "estado" ? "Este pedido ya cambió de estado. Revisa la lista." : "No se pudo guardar. Revisa tu conexión o tus permisos.");

// Actualiza en lote las recetas que cambian al renombrar o borrar un insumo (los combos no tienen insumos)
export async function actualizarRecetas(cambiar, extra = () => {}) {
  const b = writeBatch(db);
  Object.entries(RECETAS).filter(([id]) => !esCombo(producto(id))).forEach(([id, r]) => {
    const n = cambiar(r); if (JSON.stringify(n) !== JSON.stringify(r)) b.update(doc(db, "productos", id), { receta: recetaADoc(n) });
  });
  extra(b); await b.commit();
}

/* Productos y combos: el documento lleva la miniatura; la imagen grande va en imagenes/{id} */
export async function guardarProducto(datos, img) {
  const b = writeBatch(db), id = String(datos.id);
  b.set(doc(db, "productos", id), { ...datos, imagen: img.imagen, imagenGrande: img.grande ? true : img.quitar ? false : !!datos.imagenGrande });
  if (img.grande) b.set(doc(db, "imagenes", id), { data: img.grande });
  if (img.quitar) b.delete(doc(db, "imagenes", id));
  await b.commit();
}
export async function eliminarProductos(ids) { // por lotes (un writeBatch admite máximo 500 operaciones)
  for (let k = 0; k < ids.length; k += 200) {
    const b = writeBatch(db);
    ids.slice(k, k + 200).forEach((id) => { b.delete(doc(db, "productos", String(id))); b.delete(doc(db, "imagenes", String(id))); });
    await b.commit();
  }
}
// Id único que nunca se repite, para que los pedidos antiguos no muestren otro producto con el mismo id
export const nuevoId = (lista) => Math.max(Date.now(), ...lista.map((x) => x.id + 1));

/* Primera entrada de un admin: sube los datos base que falten y migra formatos anteriores */
export async function prepararDatos() {
  const b = writeBatch(db); let cambios = 0;
  if (!(await getDoc(doc(db, "config", "tienda"))).exists()) { b.set(doc(db, "config", "tienda"), TIENDA_BASE); cambios++; }
  if (!(await getDoc(doc(db, "config", "promos"))).exists()) { b.set(doc(db, "config", "promos"), { lista: PROMOCIONES_BASE }); cambios++; }
  if ((await getDocs(query(collection(db, "inventario"), limit(1)))).empty) { inventarioBase().forEach((i, k) => b.set(doc(collection(db, "inventario")), { ...i, orden: k })); cambios++; }
  b.delete(doc(db, "config", "puntos")); // los puntos de venta se eliminaron del sistema
  await b.commit();
  if (cambios) aviso("Configuración inicial cargada");
  await migrarCatalogo();
}
// Productos de versiones anteriores: categoría como texto → categoriaId; combos con receta → incluye;
// y se quitan los campos que ya no se usan (calificación y tiempo).
async function migrarCatalogo() {
  const prods = (await getDocs(collection(db, "productos"))).docs;
  const viejos = prods.filter((d) => { const p = d.data(); return (p.categoria !== undefined) || p.rating !== undefined || p.minutos !== undefined || (p.categoria === "Combos" && p.tipo !== "combo"); });
  if (!viejos.length) return;
  const cats = (await getDocs(collection(db, "categorias"))).docs.map((d) => ({ id: d.id, ...d.data() }));
  const b = writeBatch(db);
  let orden = cats.length;
  const idCategoria = (nombre) => {
    let c = cats.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase());
    if (!c) { const ref = doc(collection(db, "categorias")); c = { id: ref.id, nombre, emoji: "🍽️", orden: orden++, visible: true }; cats.push(c); b.set(ref, { nombre, emoji: c.emoji, orden: c.orden, visible: true }); }
    return c.id;
  };
  viejos.forEach((d) => {
    const p = d.data(), cambios = { rating: deleteField(), minutos: deleteField(), categoria: deleteField() };
    if (p.tipo === "combo" || p.categoria === "Combos") Object.assign(cambios, { tipo: "combo", incluye: incluyeDe(p), precio: Math.round(precioFinal(p) / 100) * 100, descuento: 0, receta: deleteField() });
    else if (p.categoria && !p.categoriaId) cambios.categoriaId = idCategoria(p.categoria);
    b.update(d.ref, cambios);
  });
  await b.commit();
  aviso("Catálogo actualizado al formato nuevo");
}
export const guardarTienda = (datos) => setDoc(doc(db, "config", "tienda"), datos, { merge: true });
export const borrar = (col, id) => deleteDoc(doc(db, col, String(id)));
export { where };
