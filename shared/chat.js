// Chat entre un cliente y el restaurante. Cada chat pertenece a UN pedido:
//   chats/{pedidoId}            portada: cliente, último mensaje y no leídos de cada lado
//   chats/{pedidoId}/mensajes   los mensajes, en orden de llegada
// El chat está abierto mientras el pedido está en curso. Cuando el pedido pasa a entregado o
// cancelado se cierra solo: desaparece el campo de escribir y las reglas de Firestore rechazan
// cualquier mensaje nuevo. El historial queda visible en solo lectura.
// Cliente y admin usan el mismo componente; solo cambia el "rol" y la cabecera.
import { doc, collection, query, orderBy, limitToLast, onSnapshot, writeBatch, updateDoc, serverTimestamp, increment } from "./firebase.js";
import { esc, hora } from "./util.js";
import { codigoPedido, terminado } from "./dominio.js";

export const MAX_MENSAJE = 500;
const OTRO = { cliente: "admin", admin: "cliente" };
const campoSinLeer = (rol) => (rol === "cliente" ? "sinLeerCliente" : "sinLeerAdmin");
/** Mensajes sin leer de un chat para el rol dado ("cliente" o "admin") */
export const sinLeer = (chat, rol) => chat?.[campoSinLeer(rol)] || 0;
/** Fecha de Firestore (Timestamp) o número → milisegundos */
export const ms = (t) => (t?.toMillis ? t.toMillis() : +t || 0);
/** Cómo se ve un mensaje en la portada: "Tú: hola…" */
export const vistaPrevia = (chat, rol) => !chat?.ultimo ? "" : (chat.ultimo.de === rol ? "Tú: " : "") + chat.ultimo.texto.replace(/\s+/g, " ").slice(0, 80);

const RAPIDAS = {
  cliente: () => ["¿Cuánto falta para mi pedido?", "Quiero agregar una indicación", "¿Me pueden llamar?"],
  admin: (p) => ["¡Hola! Ya estamos con tu pedido 🍳", "¿Nos confirmas la dirección?",
    p?.entrega === "recoger" ? "Tu pedido está listo para recoger 🛍️" : "Tu pedido va en camino 🛵", "Gracias por esperar 🙏"]
};
const dia = (f) => {
  const d = new Date(f), hoy = new Date(), ayer = new Date(Date.now() - 864e5), igual = (a, b) => a.toDateString() === b.toDateString();
  return igual(d, hoy) ? "Hoy" : igual(d, ayer) ? "Ayer" : d.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" });
};

/**
 * Crea la ventana de chat (una sola por página).
 * @param {object} o
 * @param {Firestore} o.db
 * @param {"cliente"|"admin"} o.rol
 * @param {() => {uid:string, nombre:string}} o.yo         quién escribe
 * @param {(pedido, pid) => {avatar, titulo, sub}} o.cabecera  texto de la cabecera
 * @param {(pedido) => string} [o.textoCierre]              explicación cuando el chat está cerrado
 * @param {(msg:string) => void} o.aviso
 */
export function crearChat({ db, rol, yo, cabecera, textoCierre = () => "", aviso }) {
  const el = document.createElement("dialog");
  el.className = "chat";
  el.setAttribute("aria-labelledby", "chatTitulo");
  el.innerHTML = `<div class="chat-caja">
    <header class="chat-cab">
      <span class="chat-avatar" aria-hidden="true"></span>
      <div class="chat-titulo"><b id="chatTitulo"></b><small></small></div>
      <button class="chat-x" type="button" aria-label="Cerrar chat">✕</button>
    </header>
    <div class="chat-cuerpo" role="log" aria-live="polite" aria-label="Mensajes"></div>
    <button class="chat-nuevos" type="button" hidden>↓ Mensajes nuevos</button>
    <div class="chat-rapidas" aria-label="Respuestas rápidas"></div>
    <form class="chat-form" autocomplete="off">
      <textarea rows="1" maxlength="${MAX_MENSAJE}" placeholder="Escribe un mensaje…" aria-label="Mensaje"></textarea>
      <button class="chat-enviar" type="submit" aria-label="Enviar mensaje" disabled>➤</button>
      <small class="chat-cuenta" aria-live="polite"></small>
    </form>
    <p class="chat-cerrado" hidden></p>
  </div>`;
  document.body.append(el);
  const $ = (s) => el.querySelector(s);
  const cuerpo = $(".chat-cuerpo"), form = $(".chat-form"), txt = $("textarea"), btnEnviar = $(".chat-enviar");

  let pid = null, pedido, chat, mensajes = [], listos = { pedido: false, chat: false, mensajes: false }, quitar = [], marcando = false, ultimoVisto = 0;

  const abiertoChat = () => listos.pedido && !!pedido && !terminado(pedido);
  const ref = () => doc(db, "chats", String(pid));

  /* ===== Pintar ===== */
  function pintarCab() {
    const c = cabecera(pedido, pid);
    $(".chat-avatar").textContent = c.avatar;
    $(".chat-titulo b").textContent = c.titulo;
    $(".chat-titulo small").textContent = c.sub;
  }
  function pintarEstado() {
    const abierto = abiertoChat(), cerrado = listos.pedido && !abierto;
    form.hidden = !abierto;
    $(".chat-cerrado").hidden = !cerrado;
    if (cerrado) {
      $(".chat-cerrado").innerHTML = !pedido ? "Este pedido ya no existe. El chat está cerrado."
        : `🔒 <b>Chat cerrado.</b> El pedido ${pedido.estado === "cancelado" ? "fue cancelado" : "ya fue entregado"}, así que la conversación quedó en solo lectura.${textoCierre(pedido) ? " " + textoCierre(pedido) : ""}`;
      txt.blur();
    }
    pintarRapidas();
  }
  function pintarRapidas() {
    const ver = abiertoChat() && (rol === "admin" || (listos.mensajes && !mensajes.length));
    $(".chat-rapidas").hidden = !ver;
    $(".chat-rapidas").innerHTML = ver ? RAPIDAS[rol](pedido).map((t) => `<button type="button" class="chat-rapida">${esc(t)}</button>`).join("") : "";
  }
  function pintarMensajes() {
    if (!listos.mensajes) { cuerpo.innerHTML = `<p class="chat-cargando">Cargando mensajes…</p>`; return; }
    const cerca = cuerpo.scrollHeight - cuerpo.scrollTop - cuerpo.clientHeight < 90;
    const yoUid = yo().uid;
    let html = "", diaAnterior = "";
    if (!mensajes.length) {
      html = abiertoChat() || !listos.pedido
        ? `<div class="chat-vacio"><span aria-hidden="true">💬</span><p>${rol === "cliente" ? `¿Tienes alguna duda sobre tu pedido ${codigoPedido(pid)}? Escríbenos y te respondemos aquí.` : `Aún no hay mensajes. Escríbele al cliente sobre su pedido ${codigoPedido(pid)}.`}</p></div>`
        : `<div class="chat-vacio"><span aria-hidden="true">🔒</span><p>No hubo mensajes en este pedido.</p></div>`;
    }
    mensajes.forEach((m, k) => {
      const f = ms(m.fecha) || Date.now(), d = dia(f), mio = m.de === rol, sig = mensajes[k + 1];
      if (d !== diaAnterior) { html += `<p class="chat-dia"><span>${d}</span></p>`; diaAnterior = d; }
      const finGrupo = !sig || sig.de !== m.de || dia(ms(sig.fecha) || Date.now()) !== d;
      // Entre administradores: se ve quién respondió
      const autor = rol === "admin" && m.de === "admin" && m.uid !== yoUid && (k === 0 || mensajes[k - 1].de !== "admin" || mensajes[k - 1].uid !== m.uid) ? `<i class="chat-autor">${esc(m.nombre)}</i>` : "";
      const estado = mio && m.pendiente ? " · Enviando…" : "";
      html += `<div class="msj ${mio ? "mio" : "suyo"}${finGrupo ? " fin" : ""}">${autor}<p>${esc(m.texto)}</p><small>${hora(f)}${estado}</small></div>`;
    });
    // "Visto": el último mensaje es mío y el otro lado ya no tiene mensajes sin leer
    const ult = mensajes[mensajes.length - 1];
    if (ult && ult.de === rol && !ult.pendiente && chat && !sinLeer(chat, OTRO[rol])) html += `<p class="chat-visto">Visto ✓✓</p>`;
    if (listos.pedido && pedido && terminado(pedido) && mensajes.length) {
      const t = pedido.tiempos?.[pedido.estado];
      html += `<p class="chat-dia cierre"><span>🔒 Chat cerrado${t ? " · " + hora(t) : ""}</span></p>`;
    }
    cuerpo.innerHTML = html;
    // Baja al final si ya estaba abajo o si el último mensaje es mío; si no, avisa que hay nuevos
    const nuevoSuyo = ult && ms(ult.fecha) > ultimoVisto && ult.de !== rol;
    if (cerca || !ultimoVisto || (ult && ult.de === rol)) { bajar(); }
    else if (nuevoSuyo) $(".chat-nuevos").hidden = false;
    ultimoVisto = ult ? Math.max(ultimoVisto, ms(ult.fecha)) : ultimoVisto || 1;
  }
  const bajar = () => { cuerpo.scrollTop = cuerpo.scrollHeight; $(".chat-nuevos").hidden = true; };

  /* ===== Leído ===== Al ver el chat se ponen en 0 mis mensajes sin leer */
  function marcarLeido() {
    if (!pid || !el.open || document.visibilityState !== "visible" || !chat || !sinLeer(chat, rol) || marcando) return;
    marcando = true;
    updateDoc(ref(), { [campoSinLeer(rol)]: 0 }).catch((e) => console.error("chat: marcar leído", e)).finally(() => (marcando = false));
  }
  document.addEventListener("visibilitychange", marcarLeido);

  /* ===== Enviar ===== */
  // Espera a que lleguen el pedido y la portada (si se escribe apenas se abre el chat)
  const cargado = () => new Promise((ok, no) => {
    const t0 = Date.now(), mirar = () => listos.pedido && listos.chat ? ok() : Date.now() - t0 > 8000 ? no(Object.assign(new Error("sin cargar"), { code: "unavailable" })) : setTimeout(mirar, 100);
    mirar();
  });
  async function enviar(texto, reintento = false) {
    texto = texto.trim().slice(0, MAX_MENSAJE);
    if (!texto) return false;
    const deEste = pid;
    await cargado();
    if (pid !== deEste) throw new Error("chat cambiado");
    if (!abiertoChat()) throw Object.assign(new Error("cerrado"), { code: "permission-denied" });
    const quien = yo(), ahora = serverTimestamp(), existia = !!chat, b = writeBatch(db);
    const ultimo = { texto, de: rol, fecha: ahora };
    if (existia) b.update(ref(), { ultimo, actualizado: ahora, [campoSinLeer(OTRO[rol])]: increment(1) });
    // El primer mensaje crea la portada del chat con los datos del pedido (las reglas los comparan)
    else b.set(ref(), { pedidoId: pedido.id, uid: pedido.uid, nombre: pedido.cliente.nombre, creado: ahora, actualizado: ahora, ultimo, sinLeerCliente: rol === "admin" ? 1 : 0, sinLeerAdmin: rol === "cliente" ? 1 : 0 });
    b.set(doc(collection(ref(), "mensajes")), { de: rol, uid: quien.uid, nombre: String(quien.nombre || "").slice(0, 80), texto, fecha: ahora });
    try { await b.commit(); return true; }
    catch (e) {
      // Los dos lados escribieron el primer mensaje a la vez: la portada ya existe, se reintenta como actualización
      if (!existia && chat && !reintento) return enviar(texto, true);
      console.error("chat: enviar", e);
      throw e;
    }
  }
  async function alEnviar(e) {
    e?.preventDefault();
    const texto = txt.value;
    if (!texto.trim()) return;
    txt.value = ""; ajustar(); // se ve al instante: Firestore lo muestra como "Enviando…" hasta confirmarlo
    try { await enviar(texto); }
    catch (err) {
      if (!txt.value) { txt.value = texto; ajustar(); }
      aviso(err?.code === "permission-denied" ? "No se pudo enviar: el chat de este pedido ya está cerrado." : "No se pudo enviar el mensaje. Revisa tu conexión.");
    }
  }
  function ajustar() {
    txt.style.height = "auto"; txt.style.height = Math.min(txt.scrollHeight + 2, 120) + "px"; // +2: el borde
    const n = txt.value.length;
    $(".chat-cuenta").textContent = n > MAX_MENSAJE - 100 ? `${n}/${MAX_MENSAJE}` : "";
    btnEnviar.disabled = !txt.value.trim();
  }
  form.onsubmit = alEnviar;
  txt.oninput = ajustar;
  txt.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) alEnviar(e); }; // Shift+Enter: salto de línea
  $(".chat-rapidas").onclick = (e) => {
    const b = e.target.closest(".chat-rapida"); if (!b) return;
    txt.value = b.textContent; ajustar(); txt.focus();
  };
  $(".chat-nuevos").onclick = bajar;
  cuerpo.onscroll = () => { if (cuerpo.scrollHeight - cuerpo.scrollTop - cuerpo.clientHeight < 40) $(".chat-nuevos").hidden = true; };
  $(".chat-x").onclick = () => el.close();
  el.addEventListener("click", (e) => { if (e.target === el) el.close(); }); // clic en el fondo
  el.addEventListener("close", detener);

  /* ===== Abrir y cerrar ===== */
  function detener() { quitar.forEach((fn) => fn()); quitar = []; pid = null; }
  function abrir(id) {
    id = Number(id);
    if (pid === id && el.open) return;
    detener();
    pid = id; pedido = undefined; chat = null; mensajes = []; ultimoVisto = 0; listos = { pedido: false, chat: false, mensajes: false };
    txt.value = ""; ajustar(); $(".chat-nuevos").hidden = true;
    pintarCab(); pintarEstado(); pintarMensajes();
    if (!el.open) el.showModal();
    const error = (que) => (err) => { console.error(`chat: ${que}`, err); if (err.code === "permission-denied") aviso("No tienes permiso para ver este chat. ¿Publicaste las reglas nuevas (firestore.rules)?"); };
    // El pedido manda: si pasa a entregado o cancelado, el chat se cierra en vivo
    quitar.push(onSnapshot(doc(db, "pedidos", String(id)), (s) => {
      pedido = s.exists() ? s.data() : null; listos.pedido = true;
      pintarCab(); pintarEstado(); pintarMensajes();
      if (abiertoChat() && matchMedia("(hover:hover)").matches && document.activeElement !== txt) txt.focus();
    }, error("pedido")));
    quitar.push(onSnapshot(ref(), (s) => { chat = s.exists() ? s.data() : null; listos.chat = true; pintarMensajes(); marcarLeido(); }, error("portada")));
    quitar.push(onSnapshot(query(collection(db, "chats", String(id), "mensajes"), orderBy("fecha"), limitToLast(300)), (s) => {
      mensajes = s.docs.map((d) => ({ id: d.id, pendiente: d.metadata.hasPendingWrites, ...d.data({ serverTimestamps: "estimate" }) }));
      listos.mensajes = true; pintarMensajes(); pintarRapidas(); marcarLeido();
    }, error("mensajes")));
  }
  function cerrar() { if (el.open) el.close(); }
  /** Pedido del chat que se está viendo ahora (para no avisar de mensajes que ya se están leyendo) */
  const viendo = () => (el.open && document.visibilityState === "visible" ? pid : null);

  return { abrir, cerrar, viendo };
}
