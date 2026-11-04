// Parte del cliente. Los datos viven en Firebase: Authentication (cuentas) + Firestore (todo lo demás).
import {
  conectar, errorAuth, doc, collection, setDoc, updateDoc, addDoc, onSnapshot, query, where, runTransaction,
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updatePassword
} from "../../shared/firebase.js";
import {
  PRODUCTOS, PROMOCIONES, BANNER, escucharCatalogo, faltantes, agotado, pasosDe, precioFinal,
  esCombo, disponibles, codigoPedido, ordenFecha, VENTANA_RECLAMO
} from "../../shared/catalogo.js";

const { db, auth } = conectar("cliente");
const $ = (s) => document.querySelector(s);
const dinero = (n) => "$" + Math.round(n).toLocaleString("es-CO");

let categoria = "Todos";
let texto = "";
let catalogoListo = false;   // true cuando llegan los productos de Firestore
let cliente = null;          // datos del usuario (usuarios/{uid}) o null = visitante
let despuesDeAcceso = null;
let registrando = false;     // evita confundir "cuenta recién creada" con "cuenta eliminada"
let pedidos = [];            // mis pedidos, en vivo
let reclamos = {};           // mis reclamos por número de pedido
let quitarEscuchas = [];     // para dejar de escuchar al cerrar sesión

/* ===== CARRITO =====
   Visitante → se guarda en este dispositivo (localStorage).
   Con sesión → se guarda en usuarios/{uid}.carrito, así se continúa en cualquier dispositivo. */
const leerLocal = () => { try { return JSON.parse(localStorage.getItem("fow_carrito")) ?? []; } catch { return []; } };
let carrito = leerLocal();   // [{id, cant}]
function guardarCarrito() {
  if (cliente) updateDoc(doc(db, "usuarios", cliente.uid), { carrito }).catch(() => aviso("No se pudo guardar el carrito. Revisa tu conexión."));
  else localStorage.setItem("fow_carrito", JSON.stringify(carrito));
}
// Solo los productos que siguen existiendo (el admin pudo borrar alguno)
const carritoValido = () => carrito.filter((i) => PRODUCTOS.some((p) => p.id === i.id));

const primeActivo = () => !!cliente?.prime && (!cliente.vence || new Date(cliente.vence) > new Date());
const bloqueado = () => !!cliente?.bloqueado;
const AVISO_BLOQ = "Tu cuenta está bloqueada y no puede comprar. Contacta al restaurante.";

function aviso(msg) {
  const el = $("#aviso");
  el.textContent = msg; el.classList.add("ver");
  setTimeout(() => el.classList.remove("ver"), 2400);
}

/* Menú */
const nombreDe = (id) => PRODUCTOS.find((x) => x.id === id)?.nombre ?? "Producto";
function infoExtra(p) {
  let h = "";
  if (esCombo(p)) {
    const sep = p.incluye.reduce((s, i) => s + (PRODUCTOS.find((x) => x.id === i.id) ? precioFinal(PRODUCTOS.find((x) => x.id === i.id)) * i.cant : 0), 0);
    h += `<p class="incluye">Incluye: ${p.incluye.map((i) => `${i.cant}× ${nombreDe(i.id)}`).join(", ")}</p>`;
    if (sep > p.precio) h += `<span class="ahorro">Ahorras ${dinero(sep - p.precio)}</span>`;
  }
  const d = disponibles(p.id);
  if (d && d <= 3) h += `<span class="ultimas">¡${d === 1 ? "Última unidad" : "Últimas " + d}!</span>`;
  return h;
}
function pintarCategorias() {
  const cats = ["Todos", ...new Set(PRODUCTOS.map((p) => p.categoria))];
  $("#categorias").innerHTML = cats.map((c) =>
    `<button class="chip" type="button" data-cat="${c}" aria-pressed="${c === categoria}">${c}</button>`).join("");
}
function pintarMenu() {
  if (!catalogoListo) { // tarjetas "fantasma" mientras llegan los datos de Firebase
    $("#infoResultados").textContent = "";
    $("#grilla").innerHTML = Array.from({ length: 8 }, (_, i) => `<article class="tarjeta esqueleto" style="--i:${i}" aria-hidden="true"><div class="tarjeta-img"></div><div class="tarjeta-cuerpo"><i></i><i></i><i></i></div></article>`).join("");
    return;
  }
  const lista = PRODUCTOS.filter((p) =>
    (categoria === "Todos" || p.categoria === categoria) &&
    (p.nombre + " " + p.descripcion).toLowerCase().includes(texto));
  $("#infoResultados").textContent = lista.length + " productos";
  $("#grilla").innerHTML = lista.length ? lista.map((p, i) => `
    <article class="tarjeta${agotado(p) ? " agotado" : ""}" data-pid="${p.id}" style="--i:${Math.min(i, 12)}">
      <div class="tarjeta-img" aria-hidden="true">${p.imagen ? `<img src="${p.imagen}" alt="">` : p.emoji}${agotado(p) ? '<span class="etiqueta-desc etiqueta-agotado">Agotado</span>' : p.descuento ? `<span class="etiqueta-desc">-${p.descuento}%</span>` : ""}<span class="en-carrito" hidden></span></div>
      <div class="tarjeta-cuerpo">
        <h3>${p.nombre}</h3><p>${p.descripcion}</p>${infoExtra(p)}
        <span class="meta"><b>★ ${p.rating}</b> · ${p.minutos} min</span>
        <div class="tarjeta-pie">
          <span class="precio">${p.descuento ? `<s>${dinero(p.precio)}</s>` : "Desde "}${dinero(precioFinal(p))}</span>
          <button class="btn-anadir" type="button" data-id="${p.id}" aria-label="Añadir ${p.nombre}"${agotado(p) ? " disabled" : ""}>${agotado(p) ? "Agotado" : "+ Añadir"}</button>
        </div>
      </div>
    </article>`).join("") : !PRODUCTOS.length ? `<p class="vacio">Pronto tendremos platos disponibles. ¡Vuelve más tarde!</p>`
    : `<p class="vacio">No encontramos platos con esa búsqueda.<br><button class="enlace" type="button" data-limpiar>Ver todo el menú</button></p>`;
  marcarEnCarrito();
}
// Muestra en cada tarjeta cuántas unidades ya están en el carrito (sin volver a dibujar el menú)
function marcarEnCarrito() {
  document.querySelectorAll(".tarjeta[data-pid]").forEach((t) => {
    const n = carrito.find((i) => i.id === +t.dataset.pid)?.cant || 0, b = t.querySelector(".en-carrito");
    if (b.textContent !== (n ? "×" + n : "")) { b.textContent = n ? "×" + n : ""; b.hidden = !n; b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
    b.setAttribute("aria-label", n + " en tu pedido");
  });
}
function pintarPromos() {
  $("#listaPromos").innerHTML = PROMOCIONES.map((x) =>
    `<button class="promo" type="button" data-filtro="${x.filtro}"><h3>${x.titulo}</h3><p>${x.texto}</p></button>`).join("");
}

/* Carrito */
function totales() {
  const sub = carritoValido().reduce((s, i) => s + precioFinal(PRODUCTOS.find((p) => p.id === i.id)) * i.cant, 0);
  const prime = primeActivo() ? sub * 0.25 : 0;
  return { sub, prime, total: sub - prime };
}
function pintarCarrito() { // solo dibuja; guardar es aparte (si no, cada cambio en la nube volvería a guardarse)
  const lista = carritoValido(), n = lista.reduce((s, i) => s + i.cant, 0);
  $("#contador").textContent = n; $("#contador").hidden = !n;
  $("#itemsCarrito").innerHTML = lista.length ? lista.map((i) => {
    const p = PRODUCTOS.find((x) => x.id === i.id);
    return `<div class="item"><div class="item-emoji">${p.imagen ? `<img src="${p.imagen}" alt="">` : p.emoji}</div>
      <div><b>${p.nombre}</b>${dinero(precioFinal(p))}${i.cant > 1 ? `<small class="linea-total">${i.cant} × ${dinero(precioFinal(p))} = <b>${dinero(precioFinal(p) * i.cant)}</b></small>` : ""}</div>
      <div class="cantidad"><button data-menos="${p.id}" aria-label="Quitar uno">−</button>${i.cant}<button data-mas="${p.id}" aria-label="Agregar uno">+</button></div></div>`;
  }).join("") : `<div class="vacio vacio-grande"><span aria-hidden="true">🛒</span><p>Tu carrito está vacío.</p><button class="btn btn-naranja" type="button" data-ir-menu>Ver el menú</button></div>`;
  const t = totales();
  $("#tSub").textContent = dinero(t.sub);
  $("#filaPrime").hidden = !t.prime;
  $("#tPrime").textContent = "-" + dinero(t.prime);
  $("#tTotal").textContent = dinero(t.total);
  $("#btnContinuar").disabled = !lista.length;
  marcarEnCarrito();
}
function cambiar(id, d) {
  const it = carrito.find((i) => i.id === id);
  if (d > 0 && cliente && bloqueado()) { aviso(AVISO_BLOQ); return false; }
  if (d > 0) { // no dejar pedir más de lo que hay en el inventario
    const prueba = carritoValido().map((i) => ({ ...i })), e = prueba.find((i) => i.id === id);
    e ? e.cant++ : prueba.push({ id, cant: 1 });
    if (faltantes(prueba).length) { aviso("No quedan más existencias de " + PRODUCTOS.find((x) => x.id === id).nombre); pintarMenu(); return false; }
  }
  if (d > 0) { const b = $("#contador"); b.classList.remove("pop"); void b.offsetWidth; b.classList.add("pop"); }
  if (it) { it.cant += d; carrito = carrito.filter((i) => i.cant > 0); }
  else if (d > 0) carrito.push({ id, cant: 1 });
  pintarCarrito(); guardarCarrito();
  return true;
}
function abrirCarrito(abrir) {
  $("#carrito").classList.toggle("abierto", abrir);
  $("#carrito").setAttribute("aria-hidden", !abrir);
  $("#velo").hidden = !abrir;
  document.body.classList.toggle("bloqueo", abrir);
  if (abrir) setTimeout(() => $("#cerrarCarrito").focus(), 260);
}

/* Registro y pedido */
function pedirAcceso(msg, siguiente) {
  $("#msgLogin").textContent = msg;
  despuesDeAcceso = siguiente;
  $("#dlgLogin").showModal();
}
function abrirPedido() {
  if (bloqueado()) return aviso(AVISO_BLOQ);
  const f = $("#formPedido");
  f.nombre.value = cliente.nombre; f.telefono.value = cliente.telefono;
  f.direccion.value = cliente.direccion || "";
  $("#dlgPedido").showModal();
}
function entregaCambio() {
  const dom = $("#selEntrega").value === "domicilio";
  $("#lblDireccion").hidden = !dom;
  $("#formPedido").direccion.required = dom;
}

/* Eventos */
document.addEventListener("click", (e) => {
  const t = e.target.closest("button, a");
  if (!t) return;
  if (t.dataset.cat) { categoria = t.dataset.cat; pintarCategorias(); pintarMenu(); }
  if (t.dataset.id && cambiar(+t.dataset.id, 1)) { aviso("Añadido al pedido"); const c = $("#btnCarrito"); c.classList.remove("meneo"); void c.offsetWidth; c.classList.add("meneo"); }
  if (t.dataset.mas) cambiar(+t.dataset.mas, 1);
  if (t.dataset.menos) cambiar(+t.dataset.menos, -1);
  if (t.dataset.filtro) {
    if (t.dataset.filtro === "prime") $("#prime").scrollIntoView();
    else { categoria = t.dataset.filtro; pintarCategorias(); pintarMenu(); $("#menu").scrollIntoView(); }
  }
  if (t.hasAttribute("data-cerrar")) t.closest("dialog").close();
  if (t.hasAttribute("data-ir-menu")) { abrirCarrito(false); $("#menu").scrollIntoView(); }
  if (t.hasAttribute("data-limpiar")) { texto = ""; $("#buscar").value = ""; categoria = "Todos"; pintarCategorias(); pintarMenu(); }
});
addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.querySelector("dialog[open]")) { abrirCarrito(false); abrirPedidos(false); } });
$("#btnCarrito").onclick = () => abrirCarrito(true);
$("#cerrarCarrito").onclick = () => abrirCarrito(false);
$("#velo").onclick = () => { abrirCarrito(false); abrirPedidos(false); };
$("#btnPedidos").onclick = $("#btnPedidos2").onclick = () => abrirPedidos();
$("#cerrarPedidos").onclick = () => abrirPedidos(false);
$("#buscar").oninput = (e) => { texto = e.target.value.toLowerCase().trim(); pintarMenu(); };
$("#selEntrega").onchange = entregaCambio;

function pintarSesion() {
  $("#btnCuenta").textContent = cliente ? cliente.nombre.trim()[0].toUpperCase() : "👤";
  $("#btnCuenta2").firstChild.textContent = cliente ? "🙂" : "👤";
  $("#btnDir").textContent = "📍 " + (cliente?.direccion || (cliente ? "Agrega tu dirección" : "¿Dónde te lo llevamos?"));
  pintarCarrito(); pintarPedidos();
}
function abrirPerfil() {
  const f = $("#formPerfil");
  f.nombre.value = cliente.nombre; f.telefono.value = cliente.telefono; f.correo.value = cliente.correo;
  f.direccion.value = cliente.direccion || ""; f.clave.value = ""; $("#errPerfil").textContent = "";
  $("#avatar").textContent = cliente.nombre.trim()[0].toUpperCase();
  $("#estadoPrime").textContent = primeActivo() ? "Miembro FoW Prime" + (cliente.vence ? " hasta " + new Date(cliente.vence).toLocaleDateString("es-CO") : "") : "Sin membresía Prime";
  $("#dlgPerfil").showModal();
}
$("#btnCuenta").onclick = $("#btnCuenta2").onclick = () =>
  cliente ? abrirPerfil() : pedirAcceso("Entra con tu cuenta para pedir y ver tus datos.", null);
$("#btnDir").onclick = () => cliente ? (abrirPerfil(), $("#formPerfil").direccion.focus())
  : pedirAcceso("Inicia sesión para guardar tu dirección de entrega.", () => { abrirPerfil(); $("#formPerfil").direccion.focus(); });

/* ===== SESIÓN (Firebase Authentication) =====
   onAuthStateChanged se ejecuta al abrir la página (si ya había sesión) y cada vez que se entra o se sale. */
function dejarDeEscuchar() { quitarEscuchas.forEach((fn) => fn()); quitarEscuchas = []; }
onAuthStateChanged(auth, (user) => {
  dejarDeEscuchar();
  if (!user) { cliente = null; pedidos = []; reclamos = {}; carrito = leerLocal(); pintarSesion(); return; }
  let primera = true;
  // 1) Mis datos (incluye el carrito y si estoy bloqueado). Se actualiza en vivo.
  quitarEscuchas.push(onSnapshot(doc(db, "usuarios", user.uid), async (d) => {
    if (!d.exists()) {
      if (registrando) return;
      await signOut(auth); aviso("Tu cuenta ya no existe."); return;
    }
    cliente = { uid: user.uid, ...d.data() };
    carrito = cliente.carrito || [];
    if (primera) {
      primera = false;
      const local = leerLocal(); // lo que agregó como visitante pasa a su cuenta
      if (local.length) {
        local.forEach((x) => { const e = carrito.find((i) => i.id === x.id); e ? (e.cant += x.cant) : carrito.push({ ...x }); });
        localStorage.removeItem("fow_carrito"); guardarCarrito();
      }
      const sig = despuesDeAcceso; despuesDeAcceso = null;
      if (sig) setTimeout(sig, 50);
    }
    pintarSesion();
  }));
  // 2) Mis pedidos, en vivo (el admin cambia el estado y aquí se ve al instante)
  let iniciales = true;
  quitarEscuchas.push(onSnapshot(query(collection(db, "pedidos"), where("uid", "==", user.uid)), (snap) => {
    const antes = Object.fromEntries(pedidos.map((p) => [p.id, p.estado]));
    pedidos = snap.docs.map((x) => x.data()).sort(ordenFecha).reverse();
    if (!iniciales) pedidos.forEach((p) => { if (antes[p.id] && antes[p.id] !== p.estado) aviso(`Pedido ${codigoPedido(p.id)}: ${p.estado}`); });
    iniciales = false;
    pintarPedidos();
  }));
  // 3) Mis reclamos (para ver si los aprobaron o rechazaron)
  quitarEscuchas.push(onSnapshot(query(collection(db, "reclamos"), where("uid", "==", user.uid)), (snap) => {
    reclamos = Object.fromEntries(snap.docs.map((x) => [x.data().pedidoId, x.data()]));
    pintarPedidos();
  }));
});

$("#formLogin").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector("[type=submit]");
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, f.correo.value.trim().toLowerCase(), f.clave.value);
    f.reset(); $("#errLogin").textContent = ""; $("#dlgLogin").close(); aviso("¡Hola de nuevo!");
  } catch (err) { $("#errLogin").textContent = errorAuth(err); }
  btn.disabled = false;
};
$("#formRegistro").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, btn = f.querySelector("[type=submit]"), correo = f.correo.value.trim().toLowerCase();
  btn.disabled = true; registrando = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, correo, f.clave.value); // la contraseña la guarda Firebase, no nosotros
    await setDoc(doc(db, "usuarios", cred.user.uid), {
      nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim(), correo, direccion: "",
      prime: false, bloqueado: false, carrito: [], creado: new Date().toISOString()
    });
    f.reset(); $("#errRegistro").textContent = ""; $("#dlgRegistro").close(); aviso("Cuenta creada");
  } catch (err) {
    $("#errRegistro").textContent = err.code?.startsWith("auth/") ? errorAuth(err) : "No se pudo crear la cuenta.";
  }
  registrando = false; btn.disabled = false;
};
$("#formPerfil").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await updateDoc(doc(db, "usuarios", cliente.uid), { nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim(), direccion: f.direccion.value.trim() });
    if (f.clave.value) await updatePassword(auth.currentUser, f.clave.value);
    $("#dlgPerfil").close(); aviso("Datos actualizados");
  } catch (err) { $("#errPerfil").textContent = err.code?.startsWith("auth/") ? errorAuth(err) : "No se pudieron guardar los cambios."; }
};
$("#btnSalir").onclick = async () => {
  await signOut(auth);
  $("#dlgPerfil").close(); aviso("Sesión cerrada");
};
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.dataset?.ir) { t.closest("dialog").close(); $("#" + t.dataset.ir).showModal(); }
  if (t.tagName === "DIALOG") t.close(); // clic en el fondo
});

/* Compra de FoW Prime (pago de demostración: no se cobra ni se guarda ningún dato de tarjeta) */
const PLANES = { mensual: ["Mensual", 19900, 30], trimestral: ["Trimestral", 49900, 90], anual: ["Anual", 179900, 365] };
function resumenPrime() {
  const f = $("#formPrime"), tarjeta = f.metodo.value === "tarjeta";
  $("#resumenPrime").textContent = dinero(PLANES[f.plan.value][1]);
  $("#camposTarjeta").hidden = !tarjeta; $("#camposBilletera").hidden = tarjeta;
  $("#camposTarjeta").querySelectorAll("input").forEach((i) => (i.required = tarjeta));
  f.celular.required = !tarjeta;
}
function abrirPrime() {
  if (bloqueado()) return aviso(AVISO_BLOQ);
  if (primeActivo()) return aviso("Tu Prime está activo" + (cliente.vence ? " hasta " + new Date(cliente.vence).toLocaleDateString("es-CO") : ""));
  $("#dlgPrime").showModal(); resumenPrime();
}
$("#btnPrime").onclick = () => cliente ? abrirPrime() : pedirAcceso("Inicia sesión o crea tu cuenta para comprar FoW Prime.", abrirPrime);
$("#formPrime").onchange = resumenPrime;
$("#formPrime").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, pl = PLANES[f.plan.value], ahora = new Date();
  const vence = new Date(ahora.getTime() + pl[2] * 864e5).toISOString();
  try {
    await updateDoc(doc(db, "usuarios", cliente.uid), { prime: true, plan: pl[0], vence });
    await addDoc(collection(db, "membresias"), { uid: cliente.uid, fecha: ahora.toISOString(), correo: cliente.correo, nombre: cliente.nombre, plan: pl[0], precio: pl[1], metodo: f.metodo.value });
    f.reset(); $("#dlgPrime").close(); aviso("¡Bienvenido a FoW Prime!");
  } catch { aviso("No se pudo activar Prime. Intenta de nuevo."); }
};
function aplicarBanner() {
  const b = BANNER, h = $("#hPlato");
  $("#hEtiqueta").textContent = b.etiqueta; $("#hTitulo").textContent = b.titulo; $("#hTexto").textContent = b.texto;
  $("#hBoton").textContent = b.boton; $("#hEmoji").textContent = b.emoji;
  h.classList.toggle("con-imagen", !!b.imagen); h.style.backgroundImage = b.imagen ? `url(${b.imagen})` : "";
}
// Agregar al carrito no pide cuenta; continuar con el pedido sí.
$("#btnContinuar").onclick = () =>
  cliente ? abrirPedido() : pedirAcceso("Para hacer tu pedido inicia sesión o crea una cuenta.", abrirPedido);

$("#formPedido").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target, items = carritoValido();
  if (bloqueado()) { $("#dlgPedido").close(); return aviso(AVISO_BLOQ); }
  if (faltantes(items).length) { // algo se agotó mientras armaba el pedido
    $("#dlgPedido").close(); pintarMenu(); abrirCarrito(true);
    return aviso("Algún producto se agotó. Ajusta tu pedido.");
  }
  // Pedido que luego leerán cocina (administrador) y contador. Estado inicial: "pendiente".
  // El número es consecutivo (#FOW-0001, #FOW-0002…): se reserva y se crea el pedido en una sola transacción.
  const datos = {
    uid: cliente.uid, estado: "pendiente", fecha: new Date().toISOString(), tiempos: { pendiente: Date.now() },
    cliente: { nombre: f.nombre.value, telefono: f.telefono.value, correo: cliente.correo },
    entrega: f.entrega.value, direccion: f.entrega.value === "domicilio" ? f.direccion.value : "", notas: f.notas.value,
    items: items.map((i) => ({ ...i, precio: precioFinal(PRODUCTOS.find((p) => p.id === i.id)) })),
    ...totales()
  };
  const btn = f.querySelector("[type=submit]"); btn.disabled = true;
  try {
    await runTransaction(db, async (tx) => {
      const cref = doc(db, "contadores", "pedidos"), c = await tx.get(cref), n = (c.exists() ? c.data().n : 0) + 1;
      c.exists() ? tx.update(cref, { n }) : tx.set(cref, { n });
      tx.set(doc(db, "pedidos", String(n)), { ...datos, id: n });
    });
  } catch { btn.disabled = false; $("#dlgPedido").close(); return aviso("No se pudo enviar el pedido. Revisa tu conexión."); }
  btn.disabled = false;
  $("#dlgPedido").close();
  carrito = []; pintarCarrito(); guardarCarrito(); abrirCarrito(false);
  aviso("Solicitud enviada. Te contactaremos pronto."); abrirPedidos();
};

/* Estado de mis pedidos (separado del perfil) */
const ETIQ = { pendiente: "Recibido", "en preparación": "Cocinando", listo: "Listo", "en camino": "En camino", entregado: "Entregado" };
const ETIQ_RECOGER = { listo: "Listo para recoger", entregado: "Recogido" };
const terminado = (p) => ["entregado", "cancelado"].includes(p.estado);
const hhmm = (ms) => new Date(ms).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
const MOTIVOS_RECLAMO = { equivocado: "Recibí un pedido equivocado", falto: "Faltó algo", estado: "Llegó en mal estado", otro: "Otro" };
// Lo que va debajo de la ruta: cancelar, reportar un problema o el estado del reclamo
function bloqueAcciones(p) {
  if (p.estado === "pendiente") return `<div class="pedido-acciones"><button class="enlace peligro" type="button" data-cancelar-pedido="${p.id}">Cancelar pedido</button><small>Puedes cancelarlo hasta que empecemos a prepararlo.</small></div>`;
  if (p.estado !== "entregado") return "";
  const r = reclamos[p.id];
  if (r) {
    const txt = r.estado === "abierto" ? "📮 Tu reclamo está en revisión. Te responderemos aquí mismo."
      : r.estado === "rechazado" ? "❌ Tu reclamo fue rechazado."
      : r.resolucion === "reembolso" ? `✅ Reclamo aprobado: te devolveremos ${dinero(r.monto)}.`
      : `✅ Reclamo aprobado: te reenviamos lo que faltó en el pedido ${codigoPedido(r.reposicionId)}.`;
    return `<div class="reclamo-estado ${r.estado}"><b>${txt}</b>${r.respuesta ? `<span>Respuesta del restaurante: “${r.respuesta.replace(/</g, "&lt;")}”</span>` : ""}</div>`;
  }
  const t = p.tiempos?.entregado;
  if (t && Date.now() - t < VENTANA_RECLAMO)
    return `<div class="pedido-acciones"><button class="btn btn-gris btn-mini" type="button" data-reclamo="${p.id}">⚠️ Reportar un problema</button><small>Disponible hasta el ${new Date(t + VENTANA_RECLAMO).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></div>`;
  return "";
}
function tarjetaPedido(p, k) {
  const rec = p.entrega === "recoger", pasos = pasosDe(p.entrega);
  let i = pasos.indexOf(p.estado);
  // Si el pedido tiene un estado que no existe para su tipo de entrega (p. ej. "en camino" al recoger),
  // se muestra en el paso más cercano en lugar de sacar la moto de la ruta.
  if (i < 0) i = p.estado === "en camino" ? pasos.indexOf("listo") : 0;
  const etiqueta = (s) => (rec && ETIQ_RECOGER[s]) || ETIQ[s];
  const items = p.items.map((x) => `${x.cant}× ${nombreDe(x.id)}`).join(", ");
  const desde = p.tiempos?.[p.estado] ? `<p class="pedido-hora">${p.estado === "entregado" ? `${etiqueta("entregado")} a las` : `${etiqueta(pasos[i])} desde las`} ${hhmm(p.tiempos[p.estado])}</p>` : "";
  const ruta = p.estado === "cancelado"
    ? `<p class="pedido-cancel">${p.canceladoPor === "cliente" ? "Cancelaste este pedido" : "El restaurante canceló este pedido"}${p.motivoCancelacion ? `<span>Motivo: ${p.motivoCancelacion.replace(/</g, "&lt;")}</span>` : ""}</p>`
    : `<div class="ruta${rec ? " recoger" : ""}${i === pasos.length - 1 ? " fin" : ""}" style="--p:${i / (pasos.length - 1)};--n:${pasos.length}" role="img" aria-label="Estado: ${etiqueta(pasos[i])}"><i class="barra"></i><span class="moto" aria-hidden="true">${rec ? "🛍️" : "🛵"}</span>${pasos.map((s, n) => `<span class="paso ${n < i ? "hecho" : n === i ? "actual" : ""}"><u></u><small>${etiqueta(s)}</small></span>`).join("")}</div>${desde}`;
  return `<article class="pedido${p.estado === "cancelado" ? " cancelado" : ""}" style="--i:${k}"><header><b>${codigoPedido(p.id)}</b><span>${new Date(p.fecha).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" })}</span></header>${p.reposicionDe ? `<p class="repo">🔁 Reposición sin costo del pedido ${codigoPedido(p.reposicionDe)}</p>` : ""}<p class="pedido-items">${items}</p>${ruta}${bloqueAcciones(p)}<footer><span class="tipo-entrega ${rec ? "recoger" : ""}">${rec ? "🏪 Recoger en el local" : "🛵 Domicilio"}</span><b>${p.reposicionDe ? "Sin costo" : dinero(p.total)}</b></footer></article>`;
}

/* Ventana genérica para cancelar y reclamar (enviar devuelve true o un texto de error) */
function dialogo(titulo, html, enviar, textoBoton) {
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
const opcion = (tipo, name, value, texto, marcado) => `<label class="opcion"><input type="${tipo}" name="${name}" value="${value}" ${marcado ? "checked" : ""}><span>${texto}</span></label>`;
function cancelarMiPedido(id) {
  const p = pedidos.find((x) => x.id == id);
  dialogo(`¿Cancelar el pedido ${codigoPedido(p.id)}?`, `<p class="nota">Como todavía no empezamos a prepararlo, se cancela sin ningún costo.</p>
    <fieldset class="opciones"><legend>¿Por qué lo cancelas?</legend>${["Me equivoqué en el pedido", "Ya no lo necesito", "Está tardando mucho", "Otro motivo"].map((m, i) => opcion("radio", "motivo", m, m, !i)).join("")}</fieldset>`,
  async (fd) => {
    try {
      await updateDoc(doc(db, "pedidos", String(p.id)), { estado: "cancelado", motivoCancelacion: fd.get("motivo"), canceladoPor: "cliente", tiempos: { ...(p.tiempos || {}), cancelado: Date.now() } });
    } catch { return "Ya no se puede cancelar: el restaurante empezó a preparar tu pedido."; }
    aviso("Pedido cancelado"); return true;
  }, "Sí, cancelar");
}
const redimensionar = (file, max) => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => { const im = new Image(); im.onload = () => { const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas"); c.width = im.width * k; c.height = im.height * k; c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); ok(c.toDataURL("image/jpeg", .75)); }; im.onerror = no; im.src = r.result; };
  r.onerror = no; r.readAsDataURL(file);
});
function reportarProblema(id) {
  const p = pedidos.find((x) => x.id == id), sinCosto = !p.total;
  dialogo(`Reportar un problema con ${codigoPedido(p.id)}`, `
    <label>¿Qué pasó?<select name="motivo">${Object.entries(MOTIVOS_RECLAMO).map(([k, t]) => `<option value="${k}">${t}</option>`).join("")}</select></label>
    <fieldset class="opciones"><legend>¿Qué productos tuvieron el problema?</legend>${p.items.map((x, k) => opcion("checkbox", "item", k, `${x.cant}× ${nombreDe(x.id)}`, p.items.length === 1)).join("")}</fieldset>
    <label>Cuéntanos qué pasó<textarea name="descripcion" rows="3" required minlength="10" placeholder="Ej. Pedí 2 bandejas y llegó solo una."></textarea></label>
    <label>Foto de lo que recibiste<input type="file" name="foto" accept="image/*" required></label>
    <img class="prev-foto" id="prevFoto" alt="Vista previa de la foto" hidden>
    <fieldset class="opciones"><legend>¿Qué solución prefieres?</legend>
      ${sinCosto ? "" : opcion("radio", "solicitud", "reembolso", `Que me devuelvan el dinero (${dinero(p.total)})`, true)}
      ${opcion("radio", "solicitud", "reenvio", "Que me reenvíen los productos marcados", sinCosto)}</fieldset>
    <p class="nota">El restaurante revisará tu reclamo y te responderá aquí, en «Mis pedidos».</p>`,
  async (fd) => {
    const marcados = fd.getAll("item").map(Number);
    if (!marcados.length) return "Marca al menos un producto.";
    let foto; try { foto = await redimensionar(fd.get("foto"), 1000); } catch { return "No se pudo leer la foto. Prueba con otra."; }
    if (foto.length > 700000) return "La foto es muy pesada. Prueba con otra.";
    try {
      await setDoc(doc(db, "reclamos", String(p.id)), {
        pedidoId: p.id, uid: cliente.uid, nombre: cliente.nombre, correo: cliente.correo, fecha: new Date().toISOString(),
        motivo: fd.get("motivo"), items: marcados.map((k) => ({ id: p.items[k].id, cant: p.items[k].cant })),
        descripcion: fd.get("descripcion").trim(), foto, solicitud: fd.get("solicitud"), estado: "abierto"
      });
    } catch { return "No se pudo enviar el reclamo. Solo se puede reportar durante las 24 horas siguientes a la entrega."; }
    aviso("Reclamo enviado"); return true;
  }, "Enviar reclamo");
  $("#formGen").foto.onchange = (e) => { const f = e.target.files[0], img = $("#prevFoto"); if (f) { img.src = URL.createObjectURL(f); img.hidden = false; } };
}
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-cancelar-pedido]"), r = e.target.closest("[data-reclamo]");
  if (c) cancelarMiPedido(c.dataset.cancelarPedido);
  if (r) reportarProblema(r.dataset.reclamo);
});
function pintarPedidos() {
  const l = cliente ? pedidos : [], vivos = l.filter((p) => !terminado(p)), pasados = l.filter(terminado);
  $("#contPedidos").textContent = vivos.length; $("#contPedidos").hidden = !vivos.length;
  $("#listaPedidos").innerHTML = l.length
    ? (vivos.length ? `<h3 class="grupo">En curso <span>${vivos.length}</span></h3>` + vivos.map(tarjetaPedido).join("") : "")
      + (pasados.length ? `<h3 class="grupo">Anteriores</h3>` + pasados.map((p, k) => tarjetaPedido(p, k + vivos.length)).join("") : "")
    : `<div class="vacio vacio-grande"><span aria-hidden="true">🧾</span><p>Aún no tienes pedidos. ¡Pide algo rico!</p><button class="btn btn-naranja" type="button" data-ir-pedir>Ver el menú</button></div>`;
}
function abrirPedidos(abrir = true) {
  if (abrir && !cliente) return pedirAcceso("Inicia sesión para ver el estado de tus pedidos.", () => abrirPedidos());
  if (abrir) { abrirCarrito(false); pintarPedidos(); }
  $("#panelPedidos").classList.toggle("abierto", abrir); $("#panelPedidos").setAttribute("aria-hidden", !abrir); $("#velo").hidden = !abrir;
  document.body.classList.toggle("bloqueo", abrir);
  $("#btnPedidos2").classList.toggle("activo", abrir);
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-ir-pedir]")) { abrirPedidos(false); $("#menu").scrollIntoView(); } });
/* Detalles de estilo */
function marcarSeccion() {
  $(".top").classList.toggle("elevado", scrollY > 8);
  const enMenu = $("#menu").getBoundingClientRect().top < innerHeight * .45;
  $('.nav-movil a[href="#inicio"]').classList.toggle("activo", !enMenu);
  $('.nav-movil a[href="#menu"]').classList.toggle("activo", enMenu);
}
addEventListener("scroll", marcarSeccion, { passive: true });
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add("visible"); io.unobserve(x.target); } }), { threshold: .1 });
  document.querySelectorAll(".promos,.menu,.prime").forEach((el) => { el.classList.add("reveal"); io.observe(el); });
}
setTimeout(() => $("#splash").classList.add("fuera"), 900);

/* ===== DATOS EN VIVO =====
   Reemplaza al antiguo evento "storage": ahora cualquier cambio del admin llega desde Firestore, en cualquier dispositivo. */
escucharCatalogo(db, (tipo) => {
  if (tipo === "productos") catalogoListo = true;
  if (tipo === "productos" || tipo === "inventario") {
    if (!PRODUCTOS.some((p) => p.categoria === categoria)) categoria = "Todos";
    pintarCategorias(); pintarMenu(); pintarCarrito(); pintarPedidos();
  }
  if (tipo === "banner") aplicarBanner();
  if (tipo === "promos") pintarPromos();
});
aplicarBanner(); pintarCategorias(); pintarMenu(); pintarPromos(); pintarSesion(); entregaCambio();