// Panel de administración FoW. Lee y escribe en Firestore, los mismos datos que usa la web del cliente.
import {
  conectar, errorAuth, doc, collection, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, where, writeBatch, runTransaction, deleteField,
  onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "../../shared/firebase.js";
import {
  PRODUCTOS, RECETAS, PROMOCIONES, BANNER, INVENTARIO, PROMOCIONES_BASE,
  PUNTOS_BASE, inventarioBase, recetaADoc, escucharCatalogo, necesidades, faltantes, agotado, pasosDe,
  esCombo, incluyeDe, comboADoc, combosQueUsan, disponibles, codigoPedido, ordenFecha, precioFinal
} from "../../shared/catalogo.js";

const { db, auth } = conectar("admin");
const $ = (s) => document.querySelector(s);
const dinero = (n) => "$" + Math.round(n).toLocaleString("es-CO");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r3 = (n) => Math.round(n * 1000) / 1000;
const ESTADOS = ["pendiente", "en preparación", "listo", "en camino", "entregado", "cancelado"];
const VISTAS = [["inicio","🏠","Inicio"],["pedidos","🧾","Pedidos"],["reclamos","📮","Reclamos"],["ventas","📈","Ventas"],["facturas","📄","Facturas"],["productos","📦","Productos"],["combos","🍱","Combos"],["inventario","🥬","Inventario"],["puntos","🏪","Puntos de venta"],["clientes","👥","Clientes"],["reportes","📊","Reportes"],["apariencia","🎨","Banner y promos"],["config","⚙️","Configuración"]];

/* ===== DATOS EN VIVO (se llenan con onSnapshot al entrar) ===== */
let pedidos = [], cuentas = [], membresias = [], historial = [], reclamos = [], listaPuntos = PUNTOS_BASE;
let inv = INVENTARIO;
let nombreAdmin = "Admin";
let busq = "", filtro = "todos";

const activos = () => pedidos.filter((p) => p.estado !== "cancelado");
const hoy = () => activos().filter((p) => new Date(p.fecha).toDateString() === new Date().toDateString());
const hora = (p) => new Date(p.fecha).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
const codigo = (p) => codigoPedido(p.id);
const FINALES = ["entregado", "cancelado"];
// Siguiente paso de un pedido según su tipo de entrega (null si ya terminó)
function siguiente(p) {
  if (FINALES.includes(p.estado)) return null;
  const pasos = pasosDe(p.entrega), i = pasos.indexOf(p.estado);
  return i >= 0 ? pasos[i + 1] : "entregado"; // estado antiguo que no aplica (p. ej. "en camino" al recoger)
}
const ACCION = { "en preparación": "Empezar a preparar", listo: "Marcar listo", "en camino": "Enviar", entregado: "Marcar entregado" };
const textoAccion = (p, e) => p.entrega === "recoger" ? ({ listo: "Listo para recoger", entregado: "Marcar recogido" }[e] || ACCION[e]) : ACCION[e];
const textoEstado = (p, e = p.estado) => p.entrega === "recoger" ? ({ listo: "listo para recoger", entregado: "recogido" }[e] || e) : e;
const prod = (id) => PRODUCTOS.find((x) => x.id == id);
const badge = (e, p) => `<span class="est e${ESTADOS.indexOf(e)}">${p ? textoEstado(p, e) : e}</span>`;
const coincide = (...t) => t.join(" ").toLowerCase().includes(busq);
const puntos = () => listaPuntos;
function aviso(m) { const a = $("#aviso"); a.textContent = m; a.classList.add("ver"); setTimeout(() => a.classList.remove("ver"), 2200); }
const fallo = () => aviso("No se pudo guardar. Revisa tu conexión o tus permisos.");

function registrar(n, c, motivo) { // historial de movimientos del inventario
  return addDoc(collection(db, "historial"), { f: new Date().toISOString(), n, c: r3(c), motivo });
}
// Cambia el estado de un pedido y descuenta (o devuelve) sus insumos.
// Es una TRANSACCIÓN: o se guarda todo junto o nada, aunque dos admins cambien el mismo pedido a la vez.
// Solo permite avanzar al paso siguiente o cancelar (las reglas de Firestore exigen lo mismo).
async function cambiarEstado(p, nuevo, extra = {}) {
  const ref = doc(db, "pedidos", String(p.id));
  await runTransaction(db, async (tx) => {
    const ped = (await tx.get(ref)).data();
    if (nuevo !== siguiente(ped) && !(nuevo === "cancelado" && !FINALES.includes(ped.estado))) throw new Error("estado");
    const consume = !["pendiente", "cancelado"].includes(nuevo);
    const signo = consume && !ped.descontado ? -1 : !consume && ped.descontado ? 1 : 0;
    const movs = [];
    if (signo) {
      const t = necesidades(ped.items);
      const snaps = await Promise.all(inv.filter((i) => t[i.n] && i._id).map((i) => tx.get(doc(db, "inventario", i._id))));
      if (signo < 0) { // no se empieza a preparar si no alcanza el inventario
        const hay = Object.fromEntries(snaps.filter((x) => x.exists()).map((x) => [x.data().n, x.data().s]));
        const falta = Object.keys(t).filter((k) => !(hay[k] >= t[k] - 1e-9));
        if (falta.length) throw Object.assign(new Error("falta"), { falta });
      }
      snaps.filter((x) => x.exists()).forEach((x) => { // en una transacción, primero se lee todo y después se escribe
        const d = x.data(); tx.update(x.ref, { s: Math.max(0, r3(d.s + signo * t[d.n])) }); movs.push([d.n, signo * t[d.n]]);
      });
    }
    tx.update(ref, { estado: nuevo, descontado: signo ? signo < 0 : !!ped.descontado, tiempos: { ...(ped.tiempos || {}), [nuevo]: Date.now() }, ...extra });
    movs.forEach(([n, c]) => tx.set(doc(collection(db, "historial")), { f: new Date().toISOString(), n, c: r3(c), motivo: (signo < 0 ? "Pedido " : "Devolución ") + codigo(p) }));
  });
}
const errorEstado = (e) => aviso(e.message === "falta" ? "No alcanza el inventario: " + e.falta.join(", ")
  : e.message === "estado" ? "Este pedido ya cambió de estado. Revisa la lista." : "No se pudo guardar. Revisa tu conexión o tus permisos.");

// Reserva el siguiente número de pedido y crea el pedido en la misma transacción
async function crearPedidoConsecutivo(datos, extra = () => {}) {
  return runTransaction(db, async (tx) => {
    const cref = doc(db, "contadores", "pedidos"), c = await tx.get(cref), n = (c.exists() ? c.data().n : 0) + 1;
    c.exists() ? tx.update(cref, { n }) : tx.set(cref, { n });
    tx.set(doc(db, "pedidos", String(n)), { ...datos, id: n });
    extra(tx, n);
    return n;
  });
}

// La primera vez que entra un admin se suben los datos base (insumos, promociones y puntos de venta).
// Los productos y combos no se siembran: se crean desde las secciones Productos y Combos.
// Se usa config/puntos como marca de "ya se hizo", porque una lista de productos vacía ahora es normal.
async function sembrarSiVacio() {
  if (!(await getDoc(doc(db, "config", "puntos"))).exists()) {
    const b = writeBatch(db);
    if ((await getDocs(query(collection(db, "inventario"), limit(1)))).empty)
      inventarioBase().forEach((i, k) => b.set(doc(collection(db, "inventario")), { ...i, orden: k }));
    b.set(doc(db, "config", "promos"), { lista: PROMOCIONES_BASE });
    b.set(doc(db, "config", "puntos"), { lista: PUNTOS_BASE });
    await b.commit();
    aviso("Configuración inicial cargada en Firebase");
    return;
  }
  // Combos con el formato anterior (categoría "Combos" + receta) → combos con precio fijo e "incluye"
  const viejos = (await getDocs(query(collection(db, "productos"), where("categoria", "==", "Combos")))).docs.filter((d) => d.data().tipo !== "combo");
  if (!viejos.length) return;
  const b = writeBatch(db);
  viejos.forEach((d) => { const p = d.data(); b.update(d.ref, { tipo: "combo", incluye: incluyeDe(p), precio: Math.round(precioFinal(p) / 100) * 100, descuento: 0, receta: deleteField() }); });
  await b.commit();
}

/* Piezas */
const kpi = (ico, c, t, v, f = "") => `<article class="kpi"><span class="ico ${c}">${ico}</span><div><p>${t}</p><b data-n="${v}" data-f="${f}">0</b></div></article>`;
const tabla = (cab, filas) => `<div class="tabla"><table><thead><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${filas.join("") || `<tr><td colspan="${cab.length}" class="vacio">Sin resultados</td></tr>`}</tbody></table></div>`;
// Avisa si los precios del pedido no cuadran con el catálogo (p. ej. alguien modificó el total desde el navegador)
function alertaPrecio(p) {
  if (p.reposicionDe || p.estado === "cancelado") return "";
  const suma = p.items.reduce((s, i) => s + i.precio * i.cant, 0);
  const masBarato = p.items.some((i) => { const x = prod(i.id); return x && i.precio < precioFinal(x) - 1; });
  const primeSinMembresia = p.prime > 0 && !cuentas.find((c) => c.uid === p.uid)?.prime;
  const noCuadra = Math.abs(suma - p.sub) > 1 || Math.abs(p.sub - p.prime - p.total) > 1;
  return masBarato || primeSinMembresia || noCuadra ? `<small class="alerta-precio" title="Los precios o el descuento no coinciden con el catálogo actual">⚠️ Revisar precios</small>` : "";
}
function filaPedido(p, edit) {
  const det = p.items.map((i) => `${i.cant}× ${prod(i.id)?.nombre ?? "Producto"}`).join(", ");
  const rec = p.entrega === "recoger", sig = siguiente(p);
  const contacto = [!rec && p.direccion ? `📍 ${esc(p.direccion)}` : "", p.cliente.telefono ? `📞 ${esc(p.cliente.telefono)}` : ""].filter(Boolean).join(" · ");
  const falta = p.estado === "pendiente" && !p.descontado ? faltantes(p.items, inv) : [];
  const desde = p.tiempos?.[p.estado] ? `<small class="desde">${FINALES.includes(p.estado) ? "a las" : "desde"} ${new Date(p.tiempos[p.estado]).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</small>` : "";
  // Un botón para pasar al siguiente estado y otro para cancelar; los pedidos terminados ya no se tocan
  const control = `<div class="control-estado">${badge(p.estado, p)}${desde}${sig ? `<div class="botones-estado">
      <button class="btn-estado" data-avanzar="${p.id}" ${falta.length ? `disabled title="Falta: ${esc(falta.join(", "))}"` : ""}>${textoAccion(p, sig)} →</button>
      <button class="btn-cancelar" data-cancelar="${p.id}" aria-label="Cancelar pedido ${codigo(p)}">Cancelar</button></div>` : ""}
    ${falta.length ? `<small class="falta">⚠️ Falta inventario: ${esc(falta.join(", "))}</small>` : ""}</div>`;
  const extra = [p.reposicionDe ? `<em class="repo">🔁 Reposición sin costo de ${codigoPedido(p.reposicionDe)}</em>` : "",
    p.estado === "cancelado" && p.motivoCancelacion ? `<em class="cancel">Cancelado por ${p.canceladoPor === "cliente" ? "el cliente" : "el restaurante"}: ${esc(p.motivoCancelacion)}</em>` : "",
    p.notas ? `<em>Nota: ${esc(p.notas)}</em>` : "", alertaPrecio(p)].join("");
  return `<tr class="${p.estado === "pendiente" ? "nuevo" : ""}"><td>${hora(p)}</td><td><b>${codigo(p)}</b></td><td>${esc(p.cliente.nombre)}</td>${edit ? `<td class="det">${det}${contacto ? `<small class="contacto">${contacto}</small>` : ""}${extra}</td>` : ""}<td>${rec ? "🏪 Recoger" : "🛵 Domicilio"}</td><td>${p.reposicionDe ? "Sin costo" : dinero(p.total)}</td><td>${edit ? control : badge(p.estado, p)}</td></tr>`;
}
function ranking(n) {
  const m = {}; activos().forEach((p) => p.items.forEach((i) => (m[i.id] = (m[i.id] || 0) + i.cant)));
  return Object.entries(m).map(([id, c]) => ({ p: prod(id), c })).filter((x) => x.p).sort((a, b) => b.c - a.c).slice(0, n);
}
function barras(n) {
  const r = ranking(n), max = r[0]?.c || 1;
  return `<ol class="barras">${r.map((x, i) => `<li style="--w:${x.c / max * 100}%;--i:${i}"><span>${x.p.emoji} ${x.p.nombre}</span><i></i><b>${x.c} vendidos</b></li>`).join("")}</ol>`;
}
function grafica() {
  const h = Array(15).fill(0);
  hoy().forEach((p) => { const k = new Date(p.fecha).getHours() - 8; if (k >= 0 && k < 15) h[k] += p.total; });
  let ac = 0; const c = h.map((v) => (ac += v)), max = Math.max(...c, 1);
  const pts = c.map((v, i) => [40 + i * (540 / 14), 190 - (v / max) * 160]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  return `<svg viewBox="0 0 600 220" class="graf" role="img" aria-label="Ventas acumuladas por hora"><path class="area" d="${d} L580 190 L40 190Z"/><path class="linea" pathLength="1" d="${d}"/>${pts.map((p, i) => i % 2 ? "" : `<text x="${p[0]}" y="212" text-anchor="middle">${8 + i}h</text>`).join("")}<circle class="punto" cx="${pts[14][0]}" cy="${pts[14][1]}" r="5"/></svg>`;
}
const campo = (l, n, v = "", t = "text", x = "") => `<label>${l}<input name="${n}" type="${t}" value="${esc(v)}" ${x}></label>`;
const mini = (p) => p.imagen ? `<img class="thumb" src="${p.imagen}" alt="">` : `<span class="em">${p.emoji}</span>`;
const redimensionar = (file, max = 480) => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => { const im = new Image(); im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas"); c.width = im.width * k; c.height = im.height * k; c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); ok(c.toDataURL("image/jpeg", .8)); }; im.onerror = no; im.src = r.result; };
  r.onerror = no; r.readAsDataURL(file);
});
// Plan Spark: las imágenes van dentro del documento de Firestore, que admite máximo 1 MB.
const IMG_MAX = 700000, IMG_GRANDE = "La imagen es muy pesada. Usa una más pequeña.";
function editor(titulo, html, guardarFn, textoBoton = "Guardar") { // ventana genérica: guardarFn devuelve true o un texto de error
  const f = $("#formDlg");
  f.innerHTML = `<h2>${titulo}</h2>${html}<p class="error" id="errDlg" role="alert"></p><div class="acciones"><button class="btn gris" type="button" data-x>Volver</button><button class="btn" type="submit">${textoBoton}</button></div>`;
  f.onsubmit = async (e) => {
    e.preventDefault(); const btn = f.querySelector("[type=submit]"); btn.disabled = true;
    let r; try { r = await guardarFn(new FormData(f)); } catch { r = "No se pudo guardar. Revisa tu conexión."; }
    btn.disabled = false;
    if (r === true) { $("#dlg").close(); aviso("Listo"); } else $("#errDlg").textContent = r || "No se pudo guardar.";
  };
  $("#dlg").showModal();
}

/* ===== VISTAS ===== */
const V = {
  inicio: () => { const h = hoy(), v = h.reduce((a, p) => a + p.total, 0); return `
    <section class="banner"><div><h1>¡Hola, ${esc(nombreAdmin.split(" ")[0])}!</h1><p>Aquí tienes el resumen de Food on Wheels hoy.</p></div><span class="moto" aria-hidden="true">🛵</span><em>Grandes sabores, mejores resultados</em></section>
    <div class="kpis">${kpi("🛍️","c1","Pedidos hoy",h.length)}${kpi("💰","c2","Ventas hoy",v,"$")}${kpi("🧾","c3","Facturas emitidas",pedidos.filter((p) => p.estado === "entregado").length)}${kpi("🏪","c4","Puntos de venta activos",puntos().filter((x) => x.activo).length)}</div>
    <div class="dos"><section class="caja"><h2>Pedidos en tiempo real <small class="vivo">En línea</small></h2>${tabla(["Hora","Pedido","Cliente","Entrega","Total","Estado"], pedidos.slice(-6).reverse().map((p) => filaPedido(p, false)))}<a class="ver" href="#pedidos">Ver todos los pedidos →</a></section>
    <section class="caja"><h2>Resumen de ventas</h2><p class="gran">${dinero(v)}</p>${grafica()}</section></div>
    <section class="caja"><h2>Productos más vendidos</h2>${barras(6)}</section>`; },
  pedidos: () => { const l = pedidos.slice().reverse().filter((p) => (filtro === "todos" || p.estado === filtro) && coincide(codigo(p), p.cliente.nombre)); return `
    <section class="caja"><h2>Pedidos</h2><div class="chips">${["todos", ...ESTADOS].map((e) => `<button class="chip" data-f="${e}" aria-pressed="${e === filtro}">${e}${e === "todos" ? "" : " (" + pedidos.filter((p) => p.estado === e).length + ")"}</button>`).join("")}</div>
    ${tabla(["Hora","Pedido","Cliente","Detalle","Entrega","Total","Estado"], l.map((p) => filaPedido(p, true)))}</section>`; },
  ventas: () => { const a = activos(), t = a.reduce((s, p) => s + p.total, 0); return `
    <div class="kpis">${kpi("💰","c2","Ventas totales",t,"$")}${kpi("🛍️","c1","Pedidos",a.length)}${kpi("🎟️","c3","Ticket promedio",a.length ? t / a.length : 0,"$")}${kpi("🛵","c4","Domicilios",a.filter((p) => p.entrega === "domicilio").length)}${kpi("👑","c1","Ingresos Prime",membresias.reduce((s, m) => s + m.precio, 0),"$")}${kpi("↩️","c3","Reembolsos aprobados",reclamos.filter((r) => r.resolucion === "reembolso").reduce((s, r) => s + (r.monto || 0), 0),"$")}</div>
    <div class="dos"><section class="caja"><h2>Ventas de hoy por hora</h2>${grafica()}</section><section class="caja"><h2>Más vendidos</h2>${barras(8)}</section></div>`; },
  facturas: () => `<section class="caja"><h2>Facturas emitidas</h2>${tabla(["Factura","Fecha","Cliente","Total"], pedidos.filter((p) => p.estado === "entregado" && !p.reposicionDe).reverse().filter((p) => coincide(codigo(p), p.cliente.nombre)).map((p) => `<tr><td><b>${codigo(p).replace("#FOW", "FAC")}</b></td><td>${new Date(p.fecha).toLocaleDateString("es-CO")} ${hora(p)}</td><td>${esc(p.cliente.nombre)}</td><td>${dinero(p.total)}</td></tr>`))}</section>`,
  reportes: () => { const a = activos(), t = a.reduce((s, p) => s + p.total, 0), r = ranking(1)[0]; return `
    <div class="kpis">${kpi("⭐","c1","Unidades vendidas",a.reduce((n, p) => n + p.items.reduce((x, i) => x + i.cant, 0), 0))}${kpi("🚫","c3","Cancelados",pedidos.length - a.length)}${kpi("🎟️","c2","Ticket promedio",a.length ? t / a.length : 0,"$")}${kpi("🧾","c4","Pedidos totales",pedidos.length)}</div>
    <section class="caja"><h2>Producto estrella</h2><p class="gran">${r ? r.p.emoji + " " + r.p.nombre : "Sin datos"}</p><p>${r ? r.c + " unidades vendidas" : ""}</p></section>`; },
  config: () => `<section class="caja"><h2>Configuración</h2><p>Sesión iniciada como ${esc(auth.currentUser?.email)}.</p><div class="acciones"><button class="btn" id="btnSalir">Cerrar sesión</button><button class="btn gris" id="btnReset">Reiniciar pedidos e inventario</button><button class="btn gris peli" id="btnBorrarCatalogo">Eliminar todos los productos y combos</button></div></section>`
};

/* ---------- Productos (con receta de insumos) ---------- */
let catSel = "todas";
const soloProductos = () => PRODUCTOS.filter((p) => !esCombo(p));
const vendidos = () => { const v = {}; activos().forEach((p) => p.items.forEach((i) => (v[i.id] = (v[i.id] || 0) + i.cant))); return v; };
const estadoStock = (p) => { const d = disponibles(p.id, inv); return d === 0 ? '<span class="est e5">Agotado</span>' : d !== null && d <= 3 ? `<span class="est e1">Quedan ${d}</span>` : '<span class="est e3">Disponible</span>'; };
const dispTxt = (p) => { const d = disponibles(p.id, inv); return d === null ? "—" : `<b class="disp">${d}</b>`; };
function filaReceta(k = "", c = "") {
  const ops = inv.map((i) => `<option value="${esc(i.n)}" ${i.n === k ? "selected" : ""}>${esc(i.n)} (${esc(i.u)})</option>`).join("");
  return `<div class="fila-receta"><select name="rk">${ops}</select><input name="rc" type="number" step="any" min="0.001" value="${c}" required aria-label="Cantidad"><button type="button" class="mini" data-rm aria-label="Quitar">✕</button></div>`;
}
V.productos = () => {
  const vend = vendidos(), lista = soloProductos();
  const cats = ["todas", ...new Set(lista.map((p) => p.categoria))];
  const filas = lista.filter((p) => (catSel === "todas" || p.categoria === catSel) && coincide(p.nombre, p.categoria)).map((p) => `<tr><td>${mini(p)}</td><td><b>${esc(p.nombre)}</b></td><td>${esc(p.categoria)}</td><td>${dinero(p.precio)}${p.descuento ? ` <span class="est e1">-${p.descuento}%</span>` : ""}</td><td>${vend[p.id] || 0}</td><td>${dispTxt(p)}</td><td>${estadoStock(p)}</td><td class="acc"><button data-a="prod-edit" data-id="${p.id}">Editar</button><button class="peli" data-a="prod-del" data-id="${p.id}">Eliminar</button></td></tr>`);
  return `<section class="caja"><div class="cab"><h2>Productos (${lista.length})</h2><button class="btn" data-a="prod-nuevo">＋ Añadir producto</button></div><div class="chips">${cats.map((c) => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${c === catSel}">${esc(c)}</button>`).join("")}</div>${tabla(["", "Producto", "Categoría", "Precio", "Vendidos", "Disponibles", "Estado", "Acciones"], filas)}<p class="nota">«Disponibles» son las unidades que se pueden preparar; se calcula con el inventario de insumos y la receta de cada producto.</p></section>`;
};
// Id único que nunca se repite (aunque se borren productos), para que los pedidos antiguos no muestren otro nombre
const siguienteId = () => Math.max(Date.now(), ...PRODUCTOS.map((x) => x.id + 1));
async function leerImagen(fd, actual, max = 480) {
  const f = fd.get("img"); let imagen = actual || "";
  if (f && f.size) imagen = await redimensionar(f, max); else if (fd.get("quitar")) imagen = "";
  if (imagen.length > IMG_MAX) throw new Error(IMG_GRANDE);
  return imagen;
}
const campoImagen = (e) => `<label>Imagen (opcional)<input type="file" name="img" accept="image/*"></label>${e.imagen ? `<img class="prev" src="${e.imagen}" alt=""><label class="chk"><input type="checkbox" name="quitar"> Quitar imagen actual</label>` : ""}`;
function editarProducto(id) {
  const e = PRODUCTOS.find((p) => p.id === id) || {};
  editor(id ? "Editar producto" : "Nuevo producto", `
    ${campo("Nombre", "nombre", e.nombre, "text", "required")}${campo("Descripción", "descripcion", e.descripcion)}
    <div class="dos-col">${campo("Precio (COP)", "precio", e.precio, "number", 'required min="1" step="1" inputmode="numeric"')}${campo("Descuento (%)", "descuento", e.descuento || 0, "number", 'min="0" max="90" step="1" inputmode="numeric"')}</div>
    <div class="dos-col">${campo("Categoría", "categoria", e.categoria, "text", 'required list="cats"')}${campo("Emoji", "emoji", e.emoji || "🍽️")}</div>
    <datalist id="cats">${[...new Set(soloProductos().map((p) => p.categoria))].map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
    ${campoImagen(e)}
    <p class="nota"><b>Receta:</b> insumos que gasta una unidad. Con esto se calcula cuántas unidades se pueden hacer.</p>
    <div id="recetas">${(RECETAS[id] || []).map(([k, c]) => filaReceta(k, c)).join("")}</div>
    <button class="btn gris" type="button" data-a="rec-add">＋ Ingrediente</button>`,
  async (fd) => {
    const categoria = fd.get("categoria").trim();
    if (categoria.toLowerCase() === "combos") return "Los combos se crean en la sección Combos.";
    let imagen; try { imagen = await leerImagen(fd, e.imagen); } catch (err) { return err.message || "No se pudo leer la imagen."; }
    const pid = e.id || siguienteId(), cs = fd.getAll("rc"), receta = fd.getAll("rk").map((k, i) => [k, +cs[i]]).filter(([, c]) => c > 0);
    await setDoc(doc(db, "productos", String(pid)), { id: pid, nombre: fd.get("nombre").trim(), descripcion: fd.get("descripcion").trim(), precio: +fd.get("precio"), categoria, minutos: e.minutos || 15, rating: e.rating || 4.5, emoji: fd.get("emoji") || "🍽️", descuento: +fd.get("descuento") || 0, imagen, receta: recetaADoc(receta) });
    return true;
  });
}
// Guarda en lote las recetas que cambiaron (al borrar o renombrar un insumo). Los combos no tienen insumos.
async function actualizarRecetas(cambiar, extra = () => {}) {
  const b = writeBatch(db);
  Object.entries(RECETAS).filter(([id]) => !esCombo(prod(id))).forEach(([id, r]) => { const n = cambiar(r); if (JSON.stringify(n) !== JSON.stringify(r)) b.update(doc(db, "productos", id), { receta: recetaADoc(n) }); });
  extra(b); await b.commit();
}
async function borrarProducto(id) {
  const p = prod(id), usan = combosQueUsan(id);
  if (usan.length) return alert(`«${p.nombre}» está en ${usan.length === 1 ? "el combo" : "los combos"}: ${usan.map((c) => c.nombre).join(", ")}.\nQuítalo de ahí antes de eliminarlo.`);
  if (!confirm(`¿Eliminar «${p.nombre}»? Desaparece del menú del cliente.`)) return;
  try { await deleteDoc(doc(db, "productos", String(id))); aviso("Producto eliminado"); } catch { fallo(); }
}

/* ---------- Combos (productos + cantidades, precio fijo) ---------- */
const sumaSeparado = (incluye) => incluye.reduce((s, i) => s + (prod(i.id) ? precioFinal(prod(i.id)) * i.cant : 0), 0);
const textoIncluye = (incluye) => incluye.map((i) => `${i.cant}× ${esc(prod(i.id)?.nombre ?? "Producto eliminado")}`).join(", ");
V.combos = () => {
  const vend = vendidos(), lista = PRODUCTOS.filter(esCombo).filter((p) => coincide(p.nombre));
  const filas = lista.map((p) => { const sep = sumaSeparado(p.incluye), ahorro = sep - p.precio;
    return `<tr><td>${mini(p)}</td><td><b>${esc(p.nombre)}</b></td><td class="det">${textoIncluye(p.incluye)}</td><td><b>${dinero(p.precio)}</b><small class="separado">Por separado ${dinero(sep)}</small>${ahorro > 0 ? `<span class="est e3">ahorra ${Math.round(ahorro / sep * 100)}%</span>` : '<span class="est e1">sin ahorro</span>'}</td><td>${vend[p.id] || 0}</td><td>${dispTxt(p)}</td><td>${estadoStock(p)}</td><td class="acc"><button data-a="combo-edit" data-id="${p.id}">Editar</button><button class="peli" data-a="combo-del" data-id="${p.id}">Eliminar</button></td></tr>`; });
  return `<section class="caja"><div class="cab"><h2>Combos (${lista.length})</h2><button class="btn" data-a="combo-nuevo">＋ Crear combo</button></div>${tabla(["", "Combo", "Incluye", "Precio", "Vendidos", "Disponibles", "Estado", "Acciones"], filas)}<p class="nota">Un combo se agota cuando alguno de sus productos ya no se puede preparar.</p></section>`;
};
function filaCombo(id = "", cant = 1) {
  return `<div class="fila-receta"><select name="ci">${soloProductos().map((p) => `<option value="${p.id}" ${p.id === id ? "selected" : ""}>${esc(p.nombre)} — ${dinero(precioFinal(p))}</option>`).join("")}</select><input name="cc" type="number" min="1" step="1" value="${cant}" required aria-label="Cantidad"><button type="button" class="mini" data-rm aria-label="Quitar">✕</button></div>`;
}
const leerIncluye = (fd) => { const cs = fd.getAll("cc"), m = new Map(); fd.getAll("ci").forEach((id, k) => m.set(+id, (m.get(+id) || 0) + Math.max(0, Math.round(+cs[k] || 0)))); return [...m].filter(([, c]) => c > 0).map(([id, cant]) => ({ id, cant })); };
function resumenCombo() { // se actualiza mientras se edita el combo
  const f = $("#formDlg"), r = $("#resCombo"); if (!f || !r) return;
  const fd = new FormData(f), inc = leerIncluye(fd), sep = sumaSeparado(inc), precio = +fd.get("precio") || 0;
  r.innerHTML = inc.length ? `Por separado: <b>${dinero(sep)}</b> · Precio del combo: <b>${dinero(precio)}</b> · ${precio && precio < sep ? `<span class="pos">El cliente ahorra ${dinero(sep - precio)} (${Math.round((sep - precio) / sep * 100)}%)</span>` : '<span class="neg">El combo no tiene ahorro</span>'}` : "Agrega al menos un producto.";
}
function editarCombo(id) {
  const e = PRODUCTOS.find((p) => p.id === id) || {};
  editor(id ? "Editar combo" : "Nuevo combo", `
    ${campo("Nombre", "nombre", e.nombre, "text", "required")}${campo("Descripción", "descripcion", e.descripcion)}
    <p class="nota"><b>Productos del combo</b> y cuántas unidades de cada uno incluye.</p>
    <div id="itemsCombo">${(e.incluye || []).map((i) => filaCombo(i.id, i.cant)).join("") || filaCombo()}</div>
    <button class="btn gris" type="button" data-a="combo-add">＋ Producto</button>
    <div class="dos-col">${campo("Precio fijo del combo (COP)", "precio", e.precio, "number", 'required min="1" step="1" inputmode="numeric"')}${campo("Emoji", "emoji", e.emoji || "🍱")}</div>
    <p class="resumen-combo" id="resCombo"></p>
    ${campoImagen(e)}`,
  async (fd) => {
    const incluye = leerIncluye(fd);
    if (!incluye.length) return "Agrega al menos un producto al combo.";
    let imagen; try { imagen = await leerImagen(fd, e.imagen); } catch (err) { return err.message || "No se pudo leer la imagen."; }
    const pid = e.id || siguienteId();
    await setDoc(doc(db, "productos", String(pid)), comboADoc({ id: pid, nombre: fd.get("nombre").trim(), descripcion: fd.get("descripcion").trim(), precio: +fd.get("precio"), minutos: e.minutos || 25, rating: e.rating || 4.6, emoji: fd.get("emoji") || "🍱", imagen }, incluye));
    return true;
  });
  resumenCombo();
}

/* ---------- Reclamos ---------- */
let recTab = "abiertos";
const MOTIVOS_RECLAMO = { equivocado: "Recibí un pedido equivocado", falto: "Faltó algo", estado: "Llegó en mal estado", otro: "Otro" };
function tarjetaReclamo(r) {
  const p = pedidos.find((x) => x.id === r.pedidoId), pide = r.solicitud === "reembolso" ? `Reembolso total (${dinero(p?.total ?? 0)})` : `Reenvío de: ${textoIncluye(r.items)}`;
  const resultado = r.estado === "abierto" ? "" : `<p class="respuesta ${r.estado}"><b>${r.estado === "aprobado" ? (r.resolucion === "reembolso" ? `✅ Reembolso aprobado: ${dinero(r.monto)}` : `✅ Reenvío creado: ${codigoPedido(r.reposicionId)}`) : "❌ Rechazado"}</b>${r.respuesta ? ` — ${esc(r.respuesta)}` : ""}</p>`;
  return `<article class="reclamo caja"><button class="foto" data-foto="${esc(r.pedidoId)}" aria-label="Ver foto en grande"><img src="${r.foto}" alt="Foto adjunta por el cliente"></button>
    <div><header><b>${codigoPedido(r.pedidoId)}</b> · ${esc(r.nombre)} <span class="est ${r.estado === "abierto" ? "e0" : r.estado === "aprobado" ? "e3" : "e5"}">${r.estado}</span><small>${new Date(r.fecha).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</small></header>
    <p><b>${MOTIVOS_RECLAMO[r.motivo] || esc(r.motivo)}</b> · Productos: ${textoIncluye(r.items)}</p>
    <p class="desc">“${esc(r.descripcion)}”</p>
    <p class="pide">El cliente pide: <b>${pide}</b></p>${resultado}
    ${r.estado === "abierto" ? `<div class="acc"><button data-a="rec-ok" data-r="${r.pedidoId}">Aprobar</button><button class="peli" data-a="rec-no" data-r="${r.pedidoId}">Rechazar</button></div>` : ""}</div></article>`;
}
V.reclamos = () => {
  const abiertos = reclamos.filter((r) => r.estado === "abierto").length;
  const l = reclamos.filter((r) => (recTab === "abiertos") === (r.estado === "abierto") && coincide(codigoPedido(r.pedidoId), r.nombre)).sort((a, b) => b.fecha.localeCompare(a.fecha));
  return `<div class="cab"><h2>Reclamos</h2></div><div class="chips">${[["abiertos", `Por revisar (${abiertos})`], ["resueltos", "Resueltos"]].map(([k, t]) => `<button class="chip" data-rtab="${k}" aria-pressed="${k === recTab}">${t}</button>`).join("")}</div>${l.map(tarjetaReclamo).join("") || '<p class="vacio caja">No hay reclamos aquí.</p>'}`;
};
function resolverReclamo(pid, aprobar) {
  const r = reclamos.find((x) => x.pedidoId == pid), p = pedidos.find((x) => x.id === r.pedidoId);
  const que = r.solicitud === "reembolso" ? `Se registrará un reembolso de <b>${dinero(p?.total ?? 0)}</b>. Recuerda devolver el dinero al cliente.` : `Se creará un pedido sin costo con: <b>${textoIncluye(r.items)}</b>.`;
  editor(aprobar ? "Aprobar reclamo" : "Rechazar reclamo", `${aprobar ? `<p class="nota">${que}</p>` : ""}<label>Mensaje para el cliente${aprobar ? " (opcional)" : ""}<textarea name="respuesta" rows="3" ${aprobar ? "" : "required minlength=\"5\""} placeholder="${aprobar ? "Ej. Lamentamos lo ocurrido." : "Explica por qué se rechaza"}"></textarea></label>`, async (fd) => {
    const base = { respuesta: fd.get("respuesta").trim(), fechaRespuesta: new Date().toISOString() }, ref = doc(db, "reclamos", String(r.pedidoId));
    if (!aprobar) { await updateDoc(ref, { ...base, estado: "rechazado" }); return true; }
    if (r.solicitud === "reembolso") { await updateDoc(ref, { ...base, estado: "aprobado", resolucion: "reembolso", monto: p?.total ?? 0 }); return true; }
    await crearPedidoConsecutivo({ uid: r.uid, estado: "pendiente", fecha: new Date().toISOString(), cliente: p.cliente, entrega: p.entrega, direccion: p.direccion || "", notas: `Reposición del pedido ${codigoPedido(p.id)}`, items: r.items.map((i) => ({ ...i, precio: 0 })), sub: 0, prime: 0, total: 0, reposicionDe: p.id, tiempos: { pendiente: Date.now() } },
      (tx, n) => tx.update(ref, { ...base, estado: "aprobado", resolucion: "reenvio", reposicionId: n }));
    return true;
  }, aprobar ? "Aprobar" : "Rechazar");
}
function verFoto(pid) {
  const r = reclamos.find((x) => x.pedidoId == pid), f = $("#formDlg");
  f.innerHTML = `<h2>Foto del reclamo ${codigoPedido(r.pedidoId)}</h2><img class="foto-grande" src="${r.foto}" alt="Foto adjunta por el cliente"><div class="acciones"><button class="btn gris" type="button" data-x>Cerrar</button></div>`;
  f.onsubmit = (e) => e.preventDefault();
  $("#dlg").showModal();
}

/* ---------- Cancelar un pedido desde el admin (pide el motivo) ---------- */
function cancelarPedido(id) {
  const p = pedidos.find((x) => x.id == id);
  editor(`Cancelar ${codigo(p)}`, `<p class="nota">El cliente verá el motivo en «Mis pedidos». ${p.descontado ? "Los insumos ya descontados vuelven al inventario." : ""}</p>
    <label>Motivo<select name="motivo">${["No hay ingredientes suficientes", "No hay cobertura en esa dirección", "No se pudo contactar al cliente", "El cliente lo pidió por teléfono", "Otro"].map((m) => `<option>${m}</option>`).join("")}</select></label>
    <label>Detalle (opcional)<textarea name="detalle" rows="2"></textarea></label>`, async (fd) => {
    const motivo = fd.get("motivo") + (fd.get("detalle").trim() ? ": " + fd.get("detalle").trim() : "");
    try { await cambiarEstado(p, "cancelado", { motivoCancelacion: motivo, canceladoPor: "restaurante" }); } catch (e) { errorEstado(e); return true; }
    return true;
  }, "Cancelar pedido");
}

/* ---------- Inventario e historial ---------- */
let invTab = "existencias", rango = "todo";
function gastos() {
  const hoyStr = new Date().toDateString(), h = historial.filter((x) => rango === "todo" || new Date(x.f).toDateString() === hoyStr);
  const res = {}; h.forEach((x) => { const r = (res[x.n] ||= { g: 0, r: 0 }); if (/^(Pedido|Devolución)/.test(x.motivo)) r.g -= x.c; else if (x.c > 0) r.r += x.c; });
  const r2 = (n) => +n.toFixed(2);
  return `<div class="chips">${[["hoy", "Hoy"], ["todo", "Todo el historial"]].map(([k, t]) => `<button class="chip" data-rango="${k}" aria-pressed="${k === rango}">${t}</button>`).join("")}</div>
  ${tabla(["Insumo", "Gastado", "Repuesto", "Stock actual"], inv.map((i) => `<tr><td><b>${esc(i.n)}</b></td><td>${r2(res[i.n]?.g || 0)} ${esc(i.u)}</td><td>${r2(res[i.n]?.r || 0)} ${esc(i.u)}</td><td>${r2(i.s)} ${esc(i.u)}</td></tr>`))}
  <h3 class="sub">Últimos movimientos</h3>
  ${tabla(["Fecha", "Insumo", "Cantidad", "Motivo"], h.slice(0, 40).map((x) => `<tr><td>${new Date(x.f).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</td><td>${esc(x.n)}</td><td class="${x.c < 0 ? "neg" : "pos"}">${x.c > 0 ? "+" : ""}${x.c}</td><td>${esc(x.motivo)}</td></tr>`))}`;
}
V.inventario = () => {
  const bajos = inv.filter((i) => i.s <= i.m).length;
  const tabs = `<div class="chips">${[["existencias", "Existencias"], ["gastos", "Gastos e historial"]].map(([k, t]) => `<button class="chip" data-tab="${k}" aria-pressed="${k === invTab}">${t}</button>`).join("")}</div>`;
  if (invTab === "gastos") return `<section class="caja"><h2>Gasto de insumos</h2>${tabs}${gastos()}</section>`;
  return `${bajos ? `<p class="alerta">⚠️ ${bajos} insumo${bajos > 1 ? "s" : ""} con stock bajo. Repón antes de que se agote la cocina.</p>` : ""}
  <section class="caja"><div class="cab"><h2>Inventario de insumos</h2><button class="btn" data-a="ins-nuevo">＋ Añadir insumo</button></div>${tabs}
  ${tabla(["Insumo", "Stock", "Mínimo", "Nivel", "Ajustar", "Acciones"], inv.map((i, k) => [i, k]).filter(([i]) => coincide(i.n)).map(([i, k]) => `<tr class="${i.s <= i.m ? "bajo" : ""}"><td><b>${esc(i.n)}</b></td><td>${+i.s.toFixed(2)} ${esc(i.u)}</td><td>${i.m} ${esc(i.u)}</td><td><div class="nivel"><i style="width:${Math.min(100, i.s / ((i.m || 1) * 3) * 100)}%"></i></div></td><td class="ajuste"><button data-k="${k}" data-d="-1">−1</button><button data-k="${k}" data-d="1">+1</button><button data-k="${k}" data-d="10">+10</button></td><td class="acc"><button data-a="ins-edit" data-j="${k}">Editar</button><button class="peli" data-a="ins-del" data-j="${k}">Eliminar</button></td></tr>`))}</section>`;
};
function editarInsumo(k) {
  const e = inv[k] || {};
  editor(k >= 0 ? "Editar insumo" : "Nuevo insumo", `${campo("Nombre", "n", e.n, "text", "required")}${campo("Unidad (kg, und, L…)", "u", e.u || "kg", "text", "required")}<div class="dos-col">${campo("Stock", "s", e.s ?? 0, "number", 'required min="0" step="any"')}${campo("Mínimo", "m", e.m ?? 0, "number", 'required min="0" step="any"')}</div>`, async (fd) => {
    const n = fd.get("n").trim();
    if (inv.some((x, j) => x.n === n && j !== k)) return "Ya existe un insumo con ese nombre.";
    const nuevo = { n, u: fd.get("u").trim(), s: +fd.get("s"), m: +fd.get("m") };
    if (k >= 0) {
      if (e.n !== n) await actualizarRecetas((r) => r.map(([x, c]) => [x === e.n ? n : x, c])); // renombrar en las recetas
      await updateDoc(doc(db, "inventario", e._id), nuevo);
      if (nuevo.s !== e.s) await registrar(n, nuevo.s - e.s, "Ajuste manual");
    } else { await addDoc(collection(db, "inventario"), { ...nuevo, orden: Date.now() }); await registrar(n, nuevo.s, "Stock inicial"); }
    return true;
  });
}
async function borrarInsumo(k) {
  const i = inv[k];
  if (!confirm(`¿Eliminar «${i.n}»? También se quitará de las recetas.`)) return;
  try { await actualizarRecetas((r) => r.filter(([x]) => x !== i.n), (b) => b.delete(doc(db, "inventario", i._id))); aviso("Insumo eliminado"); } catch { fallo(); }
}

/* ---------- Puntos de venta (documento config/puntos) ---------- */
const guardarPuntos = (lista) => setDoc(doc(db, "config", "puntos"), { lista }).catch(fallo);
V.puntos = () => `<div class="cab"><h2>Puntos de venta</h2><button class="btn" data-a="pv-nuevo">＋ Añadir punto</button></div><div class="kpis">${puntos().map((x) => `<article class="kpi"><span class="ico c4">🏪</span><div><p>${esc(x.nombre)}</p><b class="txt">${esc(x.dir)}</b><small class="${x.activo ? "vivo" : ""}">${x.activo ? "Activo" : "Inactivo"}</small><div class="acc"><button data-a="pv-edit" data-id="${x.id}">Editar</button><button data-a="pv-tog" data-id="${x.id}">${x.activo ? "Desactivar" : "Activar"}</button><button class="peli" data-a="pv-del" data-id="${x.id}">Eliminar</button></div></div></article>`).join("") || '<p class="vacio">No hay puntos de venta.</p>'}</div>`;
function editarPunto(id) {
  const ps = puntos().map((p) => ({ ...p })), e = ps.find((x) => x.id === id) || { activo: true };
  editor(id ? "Editar punto de venta" : "Nuevo punto de venta", `${campo("Nombre", "nombre", e.nombre, "text", "required")}${campo("Dirección", "dir", e.dir, "text", "required")}<label class="chk"><input type="checkbox" name="activo" ${e.activo ? "checked" : ""}> Activo</label>`, async (fd) => {
    const x = { id: id || Math.max(0, ...ps.map((p) => p.id)) + 1, nombre: fd.get("nombre").trim(), dir: fd.get("dir").trim(), activo: !!fd.get("activo") };
    id ? (ps[ps.findIndex((p) => p.id === id)] = x) : ps.push(x);
    await setDoc(doc(db, "config", "puntos"), { lista: ps });
    return true;
  });
}

/* ---------- Clientes (colección usuarios). Cada cliente se registra solo desde la web. ---------- */
V.clientes = () => {
  const c = cuentas.filter((x) => coincide(x.nombre, x.correo));
  return `<section class="caja"><div class="cab"><h2>Clientes (${c.length})</h2></div>${tabla(["Nombre", "Correo", "Teléfono", "Pedidos", "Prime", "Estado", "Acciones"], c.map((x) => `<tr class="${x.bloqueado ? "bloq" : ""}"><td><b>${esc(x.nombre)}</b></td><td>${esc(x.correo)}</td><td>${esc(x.telefono)}</td><td>${pedidos.filter((p) => p.uid === x.uid).length}</td><td>${x.prime ? "👑 " + (x.vence ? "hasta " + new Date(x.vence).toLocaleDateString("es-CO") : "Sí") : "No"}</td><td>${x.bloqueado ? '<span class="est e5">Bloqueado</span>' : '<span class="est e3">Activo</span>'}</td><td class="acc"><button data-a="cli-edit" data-c="${x.uid}">Editar</button><button data-a="cli-blq" data-c="${x.uid}">${x.bloqueado ? "Desbloquear" : "Bloquear"}</button><button class="peli" data-a="cli-del" data-c="${x.uid}">Eliminar</button></td></tr>`))}</section>`;
};
function editarCliente(uid) {
  const e = cuentas.find((x) => x.uid === uid);
  editor("Editar cliente", `${campo("Nombre", "nombre", e.nombre, "text", "required")}${campo("Teléfono", "telefono", e.telefono, "tel", 'required pattern="[0-9 ]{7,15}"')}${campo("Correo", "correo", e.correo, "email", "readonly")}${campo("Dirección", "direccion", e.direccion)}<p class="nota">La contraseña la cambia cada cliente desde su perfil.</p>`, async (fd) => {
    await updateDoc(doc(db, "usuarios", uid), { nombre: fd.get("nombre").trim(), telefono: fd.get("telefono").trim(), direccion: fd.get("direccion").trim() });
    return true;
  });
}

/* ---------- Banner y promociones (config/banner y config/promos) ---------- */
V.apariencia = () => {
  const b = BANNER;
  return `<section class="caja"><h2>Banner principal del cliente</h2><form id="formBanner" class="form">${campo("Etiqueta pequeña", "etiqueta", b.etiqueta)}${campo("Título", "titulo", b.titulo)}<label>Texto<textarea name="texto" rows="2">${esc(b.texto)}</textarea></label>${campo("Texto del botón", "boton", b.boton)}${campo("Emoji (si no hay imagen)", "emoji", b.emoji)}<label>Imagen del banner<input type="file" name="img" accept="image/*"></label>${b.imagen ? `<img class="prev" src="${b.imagen}" alt=""><label class="chk"><input type="checkbox" name="quitar"> Quitar imagen</label>` : ""}<div class="acciones"><button class="btn gris" type="button" data-a="ban-reset">Restablecer</button><button class="btn" type="submit">Guardar banner</button></div></form></section>
  <section class="caja"><div class="cab"><h2>Promociones</h2><button class="btn" data-a="promo-nueva">＋ Añadir</button></div>${tabla(["Título", "Texto", "Lleva a", "Acciones"], PROMOCIONES.map((x, i) => `<tr><td><b>${esc(x.titulo)}</b></td><td>${esc(x.texto)}</td><td>${esc(x.filtro)}</td><td class="acc"><button data-a="promo-edit" data-j="${i}">Editar</button><button class="peli" data-a="promo-del" data-j="${i}">Eliminar</button></td></tr>`))}<p class="nota">El descuento de cada producto se cambia en Productos (campo «Descuento»).</p></section>`;
};
const guardarPromos = (lista) => setDoc(doc(db, "config", "promos"), { lista });
function editarPromo(i) {
  const e = PROMOCIONES[i] || {}, cats = [...new Set(PRODUCTOS.map((p) => p.categoria)), "prime"];
  editor(i >= 0 ? "Editar promoción" : "Nueva promoción", `${campo("Título", "titulo", e.titulo, "text", "required")}${campo("Texto", "texto", e.texto, "text", "required")}<label>Al pulsar lleva a<select name="filtro">${cats.map((c) => `<option value="${esc(c)}" ${c === e.filtro ? "selected" : ""}>${c === "prime" ? "Sección FoW Prime" : "Categoría: " + esc(c)}</option>`).join("")}</select></label>`, async (fd) => {
    const lista = [...PROMOCIONES], x = { titulo: fd.get("titulo").trim(), texto: fd.get("texto").trim(), filtro: fd.get("filtro") };
    i >= 0 ? (lista[i] = x) : lista.push(x);
    await guardarPromos(lista); return true;
  });
}

/* ===== RENDER ===== */
function contar() {
  document.querySelectorAll("[data-n]").forEach((el) => {
    const n = +el.dataset.n, pre = el.dataset.f, t0 = performance.now();
    const paso = (t) => { const k = Math.min(1, (t - t0) / 700); el.textContent = (pre || "") + Math.round(n * (1 - Math.pow(1 - k, 3))).toLocaleString("es-CO"); if (k < 1) requestAnimationFrame(paso); };
    requestAnimationFrame(paso);
  });
}
const contador = (n) => n ? `<b class="cuenta">${n}</b>` : "";
function render() {
  if ($("#app").hidden) return;
  const h = (location.hash || "#inicio").slice(1), v = V[h] ? h : "inicio";
  $("#vista").innerHTML = V[v]();
  $("#nav").innerHTML = VISTAS.map(([id, ico, t]) => `<a href="#${id}" class="${id === v ? "activo" : ""}">${ico}<span>${t}</span>${contador(id === "pedidos" ? pedidos.filter((p) => p.estado === "pendiente").length : id === "reclamos" ? reclamos.filter((r) => r.estado === "abierto").length : 0)}</a>`).join("");
  const pend = pedidos.filter((p) => p.estado === "pendiente").length;
  $("#campana").textContent = pend; $("#campana").hidden = !pend;
  abrirLateral(false);
  // En celular las tablas se ven como tarjetas: cada celda toma el nombre de su columna
  $("#vista").querySelectorAll("table").forEach((t) => {
    const cab = [...t.querySelectorAll("th")].map((th) => th.textContent);
    t.querySelectorAll("tbody tr").forEach((tr) => tr.children.length === cab.length && [...tr.children].forEach((td, k) => (td.dataset.label = cab[k])));
  });
  contar();
}
// Re-dibuja como máximo una vez por cuadro aunque lleguen varios cambios seguidos
let pendiente = false;
// y nunca mientras el admin escribe en un formulario de la vista (lo borraría); se reintenta en un momento.
const escribiendo = () => !!document.activeElement?.closest("#vista form");
const pedirRender = () => { if (!pendiente) { pendiente = true; requestAnimationFrame(function intento() { if (escribiendo()) return setTimeout(intento, 1500); pendiente = false; render(); }); } };

/* ===== EVENTOS ===== */
window.onhashchange = () => { busq = ""; $("#buscar").value = ""; render(); scrollTo(0, 0); };
$("#buscar").oninput = (e) => { busq = e.target.value.toLowerCase().trim(); render(); };
function abrirLateral(abrir) { $("#lateral").classList.toggle("abierto", abrir); $("#veloLat").hidden = !abrir; }
$("#btnMenu").onclick = () => abrirLateral(!$("#lateral").classList.contains("abierto"));
$("#veloLat").onclick = () => abrirLateral(false);
addEventListener("keydown", (e) => { if (e.key === "Escape") abrirLateral(false); });
$("#vista").addEventListener("click", async (e) => {
  const av = e.target.closest("[data-avanzar]"), ca = e.target.closest("[data-cancelar]"), fo = e.target.closest("[data-foto]");
  if (fo) verFoto(fo.dataset.foto);
  if (ca) cancelarPedido(ca.dataset.cancelar);
  if (!av) return;
  const p = pedidos.find((x) => x.id == av.dataset.avanzar), sig = siguiente(p);
  if (sig === "entregado" && !confirm(`¿Confirmas que ${codigo(p)} fue ${p.entrega === "recoger" ? "recogido" : "entregado"}? Después ya no se podrá cambiar.`)) return;
  av.disabled = true;
  try { await cambiarEstado(p, sig); aviso(`${codigo(p)}: ${textoEstado(p, sig)}`); } catch (err) { errorEstado(err); av.disabled = false; }
});
$("#vista").addEventListener("submit", async (e) => {
  if (e.target.id !== "formBanner") return;
  e.preventDefault();
  const fd = new FormData(e.target), file = fd.get("img"); let imagen = BANNER.imagen;
  if (file && file.size) { try { imagen = await redimensionar(file, 900); } catch { return aviso("No se pudo leer la imagen."); } } else if (fd.get("quitar")) imagen = "";
  if (imagen.length > IMG_MAX) return aviso(IMG_GRANDE);
  try { await setDoc(doc(db, "config", "banner"), { etiqueta: fd.get("etiqueta"), titulo: fd.get("titulo"), texto: fd.get("texto"), boton: fd.get("boton"), emoji: fd.get("emoji") || "🍛", imagen }); aviso("Banner actualizado"); } catch { fallo(); }
});
$("#dlg").addEventListener("click", (e) => {
  const t = e.target;
  if (t === $("#dlg") || t.dataset.x !== undefined) $("#dlg").close();
  if (t.dataset.rm !== undefined) { t.closest(".fila-receta").remove(); resumenCombo(); }
  if (t.dataset.a === "rec-add") $("#recetas").insertAdjacentHTML("beforeend", filaReceta());
  if (t.dataset.a === "combo-add") { $("#itemsCombo").insertAdjacentHTML("beforeend", filaCombo()); resumenCombo(); }
});
$("#dlg").addEventListener("input", resumenCombo);
$("#vista").addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  const d = t.dataset, id = +d.id, j = +d.j;
  if (d.f) { filtro = d.f; render(); }
  if (d.cat) { catSel = d.cat; render(); }
  if (d.tab) { invTab = d.tab; render(); }
  if (d.rango) { rango = d.rango; render(); }
  if (d.rtab) { recTab = d.rtab; render(); }
  if (d.k) { // ajuste rápido de stock
    const i = inv[+d.k], nuevo = Math.max(0, r3(i.s + +d.d));
    try { await updateDoc(doc(db, "inventario", i._id), { s: nuevo }); await registrar(i.n, nuevo - i.s, "Ajuste manual"); } catch { fallo(); }
  }
  if (t.id === "btnSalir") signOut(auth);
  if (t.id === "btnBorrarCatalogo" && confirm(`Se eliminarán los ${PRODUCTOS.length} productos y combos del menú. Los pedidos antiguos se conservan. ¿Continuar?`)) borrarCatalogo();
  if (t.id === "btnReset" && confirm("Se borrarán TODOS los pedidos, reclamos e historial, la numeración vuelve a #FOW-0001 y el inventario a los valores iniciales. ¿Continuar?")) reiniciar();
  ({
    "prod-nuevo": () => editarProducto(0), "prod-edit": () => editarProducto(id), "prod-del": () => borrarProducto(id),
    "combo-nuevo": () => soloProductos().length ? editarCombo(0) : aviso("Primero crea productos en la sección Productos."), "combo-edit": () => editarCombo(id),
    "combo-del": () => { if (confirm("¿Eliminar este combo? Desaparece del menú del cliente.")) deleteDoc(doc(db, "productos", String(id))).then(() => aviso("Combo eliminado"), fallo); },
    "rec-ok": () => resolverReclamo(d.r, true), "rec-no": () => resolverReclamo(d.r, false),
    "ins-nuevo": () => editarInsumo(-1), "ins-edit": () => editarInsumo(j), "ins-del": () => borrarInsumo(j),
    "pv-nuevo": () => editarPunto(0), "pv-edit": () => editarPunto(id),
    "pv-tog": () => guardarPuntos(puntos().map((p) => p.id === id ? { ...p, activo: !p.activo } : p)),
    "pv-del": () => { if (confirm("¿Eliminar este punto de venta?")) guardarPuntos(puntos().filter((p) => p.id !== id)); },
    "cli-edit": () => editarCliente(d.c),
    "cli-blq": () => { const c = cuentas.find((x) => x.uid === d.c); updateDoc(doc(db, "usuarios", d.c), { bloqueado: !c.bloqueado }).then(() => aviso(!c.bloqueado ? "Cliente bloqueado: ya no puede comprar" : "Cliente desbloqueado"), fallo); },
    "cli-del": () => { if (confirm("¿Eliminar este cliente? Se borran sus datos y ya no podrá entrar a la web.")) deleteDoc(doc(db, "usuarios", d.c)).then(() => aviso("Cliente eliminado"), fallo); },
    "ban-reset": () => { if (confirm("¿Volver al banner original?")) deleteDoc(doc(db, "config", "banner")).catch(fallo); },
    "promo-nueva": () => editarPromo(-1), "promo-edit": () => editarPromo(j),
    "promo-del": () => { if (confirm("¿Eliminar esta promoción?")) guardarPromos(PROMOCIONES.filter((_, k) => k !== j)).catch(fallo); },
  })[d.a]?.();
});
// Elimina todos los productos y combos (por ejemplo, los de prueba que venían en el código)
async function borrarCatalogo() {
  try {
    const refs = (await getDocs(collection(db, "productos"))).docs.map((x) => x.ref);
    for (let k = 0; k < refs.length; k += 450) { const b = writeBatch(db); refs.slice(k, k + 450).forEach((r) => b.delete(r)); await b.commit(); }
    aviso("Productos y combos eliminados");
  } catch { fallo(); }
}
// Borra en lotes (un writeBatch admite máximo 500 operaciones)
async function reiniciar() {
  try {
    const refs = [...(await getDocs(collection(db, "pedidos"))).docs, ...(await getDocs(collection(db, "historial"))).docs, ...(await getDocs(collection(db, "reclamos"))).docs].map((x) => x.ref);
    refs.push(doc(db, "contadores", "pedidos"));
    for (let k = 0; k < refs.length; k += 450) { const b = writeBatch(db); refs.slice(k, k + 450).forEach((r) => b.delete(r)); await b.commit(); }
    const b = writeBatch(db), base = inventarioBase();
    inv.forEach((i) => { const x = base.find((y) => y.n === i.n); if (x && i._id) b.update(doc(db, "inventario", i._id), { s: x.s }); });
    await b.commit(); aviso("Datos reiniciados");
  } catch { fallo(); }
}

/* ===== SESIÓN DEL ADMIN =====
   Un admin es una cuenta de Authentication que además tiene un documento en la colección "admins". */
let quitarEscuchas = [];
$("#formLogin").onsubmit = async (e) => {
  e.preventDefault(); const f = e.target, btn = f.querySelector("[type=submit]"); btn.disabled = true;
  try { await signInWithEmailAndPassword(auth, f.correo.value.trim().toLowerCase(), f.clave.value); f.reset(); $("#errLogin").textContent = ""; }
  catch (err) { $("#errLogin").textContent = errorAuth(err); }
  btn.disabled = false;
};
onAuthStateChanged(auth, async (user) => {
  quitarEscuchas.forEach((fn) => fn()); quitarEscuchas = [];
  const mostrar = (app) => { $("#login").hidden = app; $("#app").hidden = !app; };
  if (!user) return mostrar(false);
  let perfil;
  try { perfil = await getDoc(doc(db, "admins", user.uid)); } catch { perfil = null; }
  if (!perfil?.exists()) { await signOut(auth); $("#errLogin").textContent = "Esta cuenta no tiene permisos de administrador."; return; }
  nombreAdmin = perfil.data().nombre || user.email;
  document.querySelector(".usuario b").textContent = nombreAdmin;
  document.querySelector(".usuario .avatar").textContent = nombreAdmin.trim()[0].toUpperCase();
  try { await sembrarSiVacio(); } catch { aviso("No se pudo cargar la configuración inicial."); }
  mostrar(true); render();
  escuchar();
});
function escuchar() {
  const on = (ref, fn) => quitarEscuchas.push(onSnapshot(ref, (s) => { fn(s); pedirRender(); }, () => {}));
  let iniciales = true;
  on(collection(db, "pedidos"), (s) => {
    pedidos = s.docs.map((x) => x.data()).sort(ordenFecha);
    if (!iniciales && s.docChanges().some((c) => c.type === "added")) aviso("Llegó un pedido nuevo");
    iniciales = false;
  });
  on(collection(db, "usuarios"), (s) => { cuentas = s.docs.map((x) => ({ uid: x.id, ...x.data() })); });
  let recIniciales = true;
  on(collection(db, "reclamos"), (s) => {
    reclamos = s.docs.map((x) => x.data());
    if (!recIniciales && s.docChanges().some((c) => c.type === "added")) aviso("Llegó un reclamo nuevo");
    recIniciales = false;
  });
  on(collection(db, "membresias"), (s) => { membresias = s.docs.map((x) => x.data()); });
  on(query(collection(db, "historial"), orderBy("f", "desc"), limit(500)), (s) => { historial = s.docs.map((x) => x.data()); });
  on(doc(db, "config", "puntos"), (s) => { listaPuntos = s.exists() ? s.data().lista : PUNTOS_BASE; });
}
let catalogoEscuchado = false;
onAuthStateChanged(auth, (user) => { // el catálogo es público, pero se empieza a escuchar al entrar
  if (!user || catalogoEscuchado) return;
  catalogoEscuchado = true;
  escucharCatalogo(db, () => { inv = INVENTARIO; pedirRender(); });
});