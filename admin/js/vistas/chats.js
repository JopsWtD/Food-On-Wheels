// Chats con los clientes: uno por pedido. Cada conversación muestra como portada el nombre del cliente,
// el código del pedido, el estado, el último mensaje y los no leídos. Apenas un cliente escribe, su chat
// aparece en «En curso» y se abre desde aquí. Se cierra solo cuando el pedido se entrega o se cancela
// (lo exigen también las reglas de Firestore).
import { $, esc, hora, fecha } from "../../../shared/util.js";
import { collection, onSnapshot } from "../../../shared/firebase.js";
import { crearChat, sinLeer, vistaPrevia, ms } from "../../../shared/chat.js";
import { codigoPedido, etiquetaAdmin, terminado } from "../../../shared/dominio.js";
import { S, db, auth, coincide, ganchos } from "../estado.js";
import { aviso, badge, chips } from "../ui.js";

const mismo = (a, b) => String(a) === String(b); // el id del pedido puede llegar como número o como texto
const chatDe = (pid) => S.chats.find((c) => mismo(c.pedidoId, pid));
const pedidoDe = (c) => S.pedidos.find((p) => mismo(p.id, c.pedidoId));

const chat = crearChat({
  db, rol: "admin", aviso,
  yo: () => ({ uid: auth.currentUser.uid, nombre: S.nombreAdmin }),
  cabecera: (p, pid) => {
    const nombre = p?.cliente?.nombre || chatDe(pid)?.nombre || "Cliente";
    return {
      avatar: nombre.trim()[0]?.toUpperCase() || "💬", titulo: nombre,
      sub: p ? [codigoPedido(pid), etiquetaAdmin(p), p.cliente?.telefono ? "📞 " + p.cliente.telefono : ""].filter(Boolean).join(" · ") : codigoPedido(pid)
    };
  }
});
export const abrirChat = (pid) => chat.abrir(pid);
// Abierto mientras el pedido sigue en curso. Si el pedido no está cargado (más de N días) se considera terminado.
const abierto = (c) => { const p = pedidoDe(c); return !!p && !terminado(p); };

/* ===== Escucha en vivo de la colección chats =====
   Si Firestore la corta (p. ej. permisos antes de publicar las reglas nuevas), se reintenta sola
   y la sección muestra el motivo, en lugar de quedarse vacía para siempre. */
let antes = null, error = null, quitarEscucha = () => {}, reintento = 0, espera = null;
const tituloBase = document.title;
export function escucharChats() {
  detenerChats();
  quitarEscucha = onSnapshot(collection(db, "chats"), (snap) => {
    error = null; reintento = 0;
    alLlegar(snap);
    ganchos.render();
  }, (err) => {
    console.error("chats:", err);
    error = err.code === "permission-denied"
      ? "Firestore no deja leer los chats. Publica las reglas nuevas (firestore.rules) en la consola de Firebase; la lista se reconecta sola."
      : "Se perdió la conexión con los chats. Reintentando…";
    ganchos.render();
    espera = setTimeout(escucharChats, Math.min(30000, 2000 * 2 ** reintento++)); // 2 s, 4 s, 8 s… máximo 30 s
  });
  return detenerChats;
}
function detenerChats() { quitarEscucha(); quitarEscucha = () => {}; clearTimeout(espera); }
export function reiniciarChats() { detenerChats(); antes = null; error = null; reintento = 0; S.chats = []; document.title = tituloBase; chat.cerrar(); }

function alLlegar(snap) {
  S.chats = snap.docs.map((d) => d.data({ serverTimestamps: "estimate" }));
  const ahora = Object.fromEntries(S.chats.map((c) => [c.pedidoId, sinLeer(c, "admin")]));
  if (antes) S.chats.forEach((c) => {
    if (ahora[c.pedidoId] > (antes[c.pedidoId] || 0) && !mismo(chat.viendo(), c.pedidoId)) avisarMensaje(c);
  });
  if (antes || !snap.metadata.fromCache) antes = ahora; // la caché local responde primero: se avisa lo que llegue después
  const total = Object.values(ahora).reduce((a, b) => a + b, 0);
  document.title = (total ? `(${total}) 💬 ` : "") + tituloBase;
}

// Aviso de mensaje nuevo: al tocarlo lleva a «Chats · En curso» y abre esa conversación
function avisarMensaje(c) {
  let caja = $("#avisosChat");
  if (!caja) { document.body.insertAdjacentHTML("beforeend", '<div id="avisosChat" class="avisos-chat" aria-live="polite"></div>'); caja = $("#avisosChat"); }
  caja.querySelector(`[data-pid="${c.pedidoId}"]`)?.remove(); // uno por chat
  const b = document.createElement("button");
  b.className = "aviso-chat"; b.type = "button"; b.dataset.pid = c.pedidoId;
  b.innerHTML = `<span class="ci-avatar" aria-hidden="true">${esc(c.nombre.trim()[0]?.toUpperCase() || "?")}</span><span><b>${esc(c.nombre)} · ${codigoPedido(c.pedidoId)}</b><small>${esc(c.ultimo?.texto || "")}</small></span><i>Abrir</i>`;
  b.onclick = () => { b.remove(); irAChat(c.pedidoId); };
  caja.prepend(b);
  [...caja.children].slice(3).forEach((x) => x.remove()); // máximo 3 a la vez
  setTimeout(() => b.remove(), 9000);
}
function irAChat(pid) {
  tab = "abiertos";
  if (location.hash !== "#chats") location.hash = "chats"; else ganchos.render();
  abrirChat(pid);
}

/* ===== Vista ===== */
let tab = "abiertos";
const cuando = (t) => { const f = ms(t); return !f ? "" : new Date(f).toDateString() === new Date().toDateString() ? hora(f) : fecha(f); };
function tarjeta(c) {
  const p = pedidoDe(c), n = sinLeer(c, "admin");
  return `<button class="chat-item${n ? " sin-leer" : ""}" data-a="abrir" data-pid="${c.pedidoId}">
    <span class="ci-avatar" aria-hidden="true">${esc(c.nombre.trim()[0]?.toUpperCase() || "?")}</span>
    <span class="ci-cuerpo">
      <span class="ci-fila"><b>${esc(c.nombre)}</b><time>${cuando(c.actualizado)}</time></span>
      <span class="ci-fila ci-pedido"><span>${codigoPedido(c.pedidoId)}</span>${p ? badge(p.estado, p) : `<span class="est">anterior</span>`}${abierto(c) ? "" : `<span class="ci-cerrado">🔒 cerrado</span>`}</span>
      <span class="ci-previa">${esc(vistaPrevia(c, "admin")) || "<i>Sin mensajes</i>"}</span>
    </span>
    ${n ? `<b class="chat-cont" aria-label="${n} sin leer">${n}</b>` : ""}
  </button>`;
}

export default {
  id: "chats", icono: "💬", titulo: "Chats",
  contador: () => S.chats.filter((c) => sinLeer(c, "admin")).length,
  render() {
    const nAbiertos = S.chats.filter(abierto).length;
    const l = S.chats
      .filter((c) => (tab === "todos" || (tab === "abiertos") === abierto(c)) && coincide(c.nombre, codigoPedido(c.pedidoId), c.ultimo?.texto || ""))
      .sort((a, b) => (sinLeer(b, "admin") > 0) - (sinLeer(a, "admin") > 0) || ms(b.actualizado) - ms(a.actualizado)); // primero los que tienen mensajes nuevos
    const vacio = tab === "abiertos" ? "No hay chats en curso. Cuando un cliente escriba desde su pedido, su chat aparecerá aquí." : "No hay chats aquí.";
    return `<section class="caja"><div class="cab"><h2>Chats con clientes</h2><small class="nota">Uno por pedido · se cierran solos al entregar o cancelar el pedido</small></div>
      ${error ? `<p class="chats-error" role="alert">⚠️ ${esc(error)}</p>` : ""}
      ${chips([["abiertos", `En curso (${nAbiertos})`], ["cerrados", `Cerrados (${S.chats.length - nAbiertos})`], ["todos", "Todos"]], tab, "tab")}
      <div class="chats-lista">${l.map(tarjeta).join("") || `<p class="vacio">${vacio}</p>`}</div></section>`;
  },
  acciones: {
    tab: (d) => { tab = d.v; },
    abrir: (d) => abrirChat(d.pid)
  }
};
