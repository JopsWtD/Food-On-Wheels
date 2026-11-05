// Sesión (Firebase Authentication), registro, perfil y compra de FoW Prime.
import { $, fecha } from "../../shared/util.js";
import { doc, collection, setDoc, updateDoc, getDocs, onSnapshot, query, where, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updatePassword, errorAuth } from "../../shared/firebase.js";
import { ordenFecha, codigoPedido, etiquetaCliente } from "../../shared/dominio.js";
import { S, db, auth, emitir, primeActivo, bloqueado, AVISO_BLOQ } from "./estado.js";
import { crearMembresia, abrirFacturaSuscripcion } from "../../shared/pedidos.js";
import { TIENDA } from "../../shared/catalogo.js";
import { aviso, acceso, pedirAcceso } from "./ui.js";
import { leerLocal, guardarCarrito } from "./carrito.js";

let registrando = false, recuperando = false; // evita confundir "cuenta recién creada" con "cuenta sin datos"
let quitar = [];

function abrirPerfil(enfocarDireccion = false) {
  const f = $("#formPerfil"), c = S.cliente;
  f.nombre.value = c.nombre; f.telefono.value = c.telefono; f.correo.value = c.correo; f.direccion.value = c.direccion || ""; f.clave.value = "";
  $("#errPerfil").textContent = ""; $("#avatar").textContent = c.nombre.trim()[0].toUpperCase();
  $("#estadoPrime").textContent = primeActivo() ? "Miembro FoW Prime" + (c.vence ? " hasta el " + fecha(c.vence) : "") : "Sin membresía Prime";
  // Factura de la suscripción (solo si alguna vez compró Prime)
  let btn = $("#btnFacturaPrime");
  if (!btn) { $("#estadoPrime").insertAdjacentHTML("afterend", '<button class="enlace" type="button" id="btnFacturaPrime" hidden>🧾 Ver factura de mi suscripción</button>'); btn = $("#btnFacturaPrime"); btn.onclick = verFacturaPrime; }
  btn.hidden = !c.prime;
  $("#dlgPerfil").showModal();
  if (enfocarDireccion) f.direccion.focus();
}
function pintarSesion() {
  const c = S.cliente;
  $("#btnCuenta").textContent = c ? c.nombre.trim()[0].toUpperCase() : "👤";
  $("#btnCuenta2").firstChild.textContent = c ? "🙂" : "👤";
  const dir = c?.direccion || (c ? "Agrega tu dirección" : "¿Dónde te lo llevamos?");
  $("#btnDir").innerHTML = `<span aria-hidden="true">📍</span><span class="dir-txt"></span>`;
  $("#btnDir .dir-txt").textContent = dir; $("#btnDir").title = $("#btnDir").ariaLabel = "Dirección de entrega: " + dir;
}

/* onAuthStateChanged se ejecuta al abrir la página (si ya había sesión) y cada vez que se entra o se sale */
function alCambiarSesion(user) {
  quitar.forEach((fn) => fn()); quitar = [];
  if (!user) { S.cliente = null; S.pedidos = []; S.reclamos = {}; S.carrito = leerLocal(); pintarSesion(); emitir("sesion"); emitir("carrito"); return; }
  let primera = true;
  quitar.push(onSnapshot(doc(db, "usuarios", user.uid), async (d) => { // mis datos y mi carrito, en vivo
    if (!d.exists()) { // cuenta sin datos (borrados con la antigua opción «Eliminar»): se recupera
      if (registrando || recuperando) return;
      recuperando = true;
      try {
        await setDoc(doc(db, "usuarios", user.uid), { nombre: user.email.split("@")[0], telefono: "", correo: user.email, direccion: "", prime: false, bloqueado: false, carrito: [], creado: new Date().toISOString(), recuperada: true });
        aviso("Recuperamos tu cuenta. Completa tus datos en tu perfil.");
        acceso.siguiente = () => abrirPerfil();
      } catch { await signOut(auth); aviso("No se pudo recuperar tu cuenta. Contacta al restaurante."); }
      recuperando = false; return;
    }
    S.cliente = { uid: user.uid, ...d.data() };
    S.carrito = S.cliente.carrito || [];
    if (primera) {
      primera = false;
      const local = leerLocal(); // lo que agregó como visitante pasa a su cuenta
      if (local.length) { local.forEach((x) => { const e = S.carrito.find((i) => i.id === x.id); e ? (e.cant += x.cant) : S.carrito.push({ ...x }); }); localStorage.removeItem("fow_carrito"); guardarCarrito(); }
      const sig = acceso.siguiente; acceso.siguiente = null; if (sig) setTimeout(sig, 50);
    }
    pintarSesion(); emitir("sesion"); emitir("carrito");
  }));
  let iniciales = true;
  quitar.push(onSnapshot(query(collection(db, "pedidos"), where("uid", "==", user.uid)), (snap) => { // mis pedidos, en vivo
    const antes = Object.fromEntries(S.pedidos.map((p) => [p.id, p.estado]));
    S.pedidos = snap.docs.map((x) => x.data()).sort(ordenFecha).reverse();
    if (!iniciales) S.pedidos.forEach((p) => { if (antes[p.id] && antes[p.id] !== p.estado) aviso(`Pedido ${codigoPedido(p.id)}: ${etiquetaCliente(p)}`); });
    if (!snap.metadata.fromCache) iniciales = false; // la caché local responde primero
    emitir("pedidos");
  }));
  quitar.push(onSnapshot(query(collection(db, "reclamos"), where("uid", "==", user.uid)), (snap) => {
    S.reclamos = Object.fromEntries(snap.docs.map((x) => [x.data().pedidoId, x.data()])); emitir("pedidos");
  }));
}

// Abre la factura de la última suscripción del cliente
async function verFacturaPrime() {
  try {
    const subs = (await getDocs(query(collection(db, "membresias"), where("uid", "==", S.cliente.uid)))).docs.map((d) => ({ _id: d.id, ...d.data() }));
    const ultima = subs.sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
    ultima ? abrirFacturaSuscripcion(ultima, TIENDA) : aviso("No encontramos facturas de tu suscripción.");
  } catch { aviso("No se pudo cargar la factura. Intenta de nuevo."); }
}

/* ===== Prime (pago de demostración: no se cobra ni se guarda ningún dato de tarjeta) ===== */
const PLANES = { mensual: ["Mensual", 19900, 30], trimestral: ["Trimestral", 49900, 90], anual: ["Anual", 179900, 365] };
function resumenPrime() {
  const f = $("#formPrime"), tarjeta = f.metodo.value === "tarjeta";
  $("#resumenPrime").textContent = "$" + PLANES[f.plan.value][1].toLocaleString("es-CO");
  $("#camposTarjeta").hidden = !tarjeta; $("#camposBilletera").hidden = tarjeta;
  $("#camposTarjeta").querySelectorAll("input").forEach((i) => (i.required = tarjeta));
  f.celular.required = !tarjeta;
}
function abrirPrime() {
  if (bloqueado()) return aviso(AVISO_BLOQ);
  if (primeActivo()) return aviso("Tu Prime está activo" + (S.cliente.vence ? " hasta el " + fecha(S.cliente.vence) : ""));
  $("#dlgPrime").showModal(); resumenPrime();
}

export function iniciarCuenta() {
  onAuthStateChanged(auth, alCambiarSesion);
  $("#btnCuenta").onclick = $("#btnCuenta2").onclick = () => S.cliente ? abrirPerfil() : pedirAcceso("Entra con tu cuenta para pedir y ver tus datos.");
  $("#btnDir").onclick = () => S.cliente ? abrirPerfil(true) : pedirAcceso("Inicia sesión para guardar tu dirección de entrega.", () => abrirPerfil(true));
  $("#formLogin").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target, btn = f.querySelector("[type=submit]"); btn.disabled = true;
    try { await signInWithEmailAndPassword(auth, f.correo.value.trim().toLowerCase(), f.clave.value); f.reset(); $("#errLogin").textContent = ""; $("#dlgLogin").close(); aviso("¡Hola de nuevo!"); }
    catch (err) { $("#errLogin").textContent = errorAuth(err); }
    btn.disabled = false;
  };
  $("#formRegistro").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("[type=submit]"), correo = f.correo.value.trim().toLowerCase();
    btn.disabled = true; registrando = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, correo, f.clave.value); // la contraseña la guarda Firebase, no nosotros
      await setDoc(doc(db, "usuarios", cred.user.uid), { nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim(), correo, direccion: "", prime: false, bloqueado: false, carrito: [], creado: new Date().toISOString() });
      f.reset(); $("#errRegistro").textContent = ""; $("#dlgRegistro").close(); aviso("Cuenta creada");
    } catch (err) { $("#errRegistro").textContent = err.code?.startsWith("auth/") ? errorAuth(err) : "No se pudo crear la cuenta."; }
    registrando = false; btn.disabled = false;
  };
  $("#formPerfil").onsubmit = async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      await updateDoc(doc(db, "usuarios", S.cliente.uid), { nombre: f.nombre.value.trim(), telefono: f.telefono.value.trim(), direccion: f.direccion.value.trim() });
      if (f.clave.value) await updatePassword(auth.currentUser, f.clave.value);
      $("#dlgPerfil").close(); aviso("Datos actualizados");
    } catch (err) { $("#errPerfil").textContent = err.code?.startsWith("auth/") ? errorAuth(err) : "No se pudieron guardar los cambios."; }
  };
  $("#btnSalir").onclick = async () => { await signOut(auth); $("#dlgPerfil").close(); aviso("Sesión cerrada"); };
  $("#btnPrime").onclick = () => S.cliente ? abrirPrime() : pedirAcceso("Inicia sesión o crea tu cuenta para comprar FoW Prime.", abrirPrime);
  $("#formPrime").onchange = resumenPrime;
  $("#formPrime").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, pl = PLANES[f.plan.value], ahora = new Date(), vence = new Date(ahora.getTime() + pl[2] * 864e5).toISOString();
    const btn = f.querySelector("[type=submit]"); btn.disabled = true;
    try {
      // La suscripción queda registrada con número de factura propio (SUS-0001…)
      await crearMembresia(db, { uid: S.cliente.uid, fecha: ahora.toISOString(), desde: ahora.toISOString(), vence, correo: S.cliente.correo, nombre: S.cliente.nombre, telefono: S.cliente.telefono || "", plan: pl[0], dias: pl[2], precio: pl[1], metodo: f.metodo.value });
      await updateDoc(doc(db, "usuarios", S.cliente.uid), { prime: true, plan: pl[0], vence });
      f.reset(); $("#dlgPrime").close(); aviso("¡Bienvenido a FoW Prime! Tu factura está en tu perfil.");
    } catch { aviso("No se pudo activar Prime. Intenta de nuevo."); }
    btn.disabled = false;
  };
}
