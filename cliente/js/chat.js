// Chat del cliente con el restaurante: se abre desde cada pedido en «Mis pedidos».
// La ventana es el componente compartido (shared/chat.js); aquí solo va lo propio del cliente:
// la cabecera, el contador de mensajes sin leer y el aviso cuando el restaurante escribe.
import { $$ } from "../../shared/util.js";
import { crearChat, sinLeer } from "../../shared/chat.js";
import { codigoPedido, etiquetaCliente, puedeReclamar } from "../../shared/dominio.js";
import { TIENDA } from "../../shared/catalogo.js";
import { S, db, en } from "./estado.js";
import { aviso } from "./ui.js";

const chat = crearChat({
  db, rol: "cliente", aviso,
  yo: () => ({ uid: S.cliente.uid, nombre: S.cliente.nombre }),
  cabecera: (p, pid) => ({ avatar: "🛵", titulo: TIENDA.nombre || "Food on Wheels", sub: `Pedido ${codigoPedido(pid)}${p ? " · " + etiquetaCliente(p) : ""}` }),
  textoCierre: (p) => (puedeReclamar(p) ? "Si algo salió mal, usa «Reportar un problema» en el pedido." : "")
});

export const abrirChat = (pid) => { if (S.cliente) chat.abrir(pid); };
export const sinLeerDe = (pid) => sinLeer(S.chats[pid], "cliente");
const totalSinLeer = () => Object.values(S.chats).reduce((s, c) => s + sinLeer(c, "cliente"), 0);

// Punto en el botón «Mis pedidos» cuando hay mensajes sin leer
function pintarPunto() {
  const n = totalSinLeer();
  $$(".punto-chat").forEach((el) => { el.hidden = !n; el.title = `${n} mensaje${n === 1 ? "" : "s"} sin leer`; });
}

export function iniciarChat() {
  let antes = null; // no leídos por pedido en la última foto del servidor (null = aún no hay base)
  en("chats", (snap) => {
    const ahora = Object.fromEntries(Object.values(S.chats).map((c) => [c.pedidoId, sinLeer(c, "cliente")]));
    if (antes) Object.entries(ahora).forEach(([pid, n]) => {
      if (n > (antes[pid] || 0) && chat.viendo() != pid) aviso(`💬 El restaurante te escribió sobre el pedido ${codigoPedido(+pid)}`);
    });
    if (antes || !snap?.metadata.fromCache) antes = ahora; // la caché local responde primero: se avisa solo lo que llegue después
    pintarPunto();
  });
  en("sesion", () => { if (!S.cliente) { chat.cerrar(); antes = null; pintarPunto(); } });
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-chat]"); if (b) abrirChat(b.dataset.chat); });
}
