// Estado compartido del panel admin. Las vistas leen de aquí; app.js lo llena con onSnapshot.
import { conectar } from "../../shared/firebase.js";
import { producto } from "../../shared/catalogo.js";

export const { db, auth } = conectar("admin");
export const S = {
  pedidos: [], cuentas: [], membresias: [], historial: [], reclamos: [], chats: [],
  busq: "", nombreAdmin: "Admin",
  diasPedidos: 60 // solo se cargan los pedidos de los últimos N días (escala mejor con muchos pedidos)
};
// Funciones que app.js registra y las vistas pueden pedir (evita importaciones circulares)
export const ganchos = { render: () => {}, ampliarPedidos: () => {} };

export const coincide = (...t) => t.join(" ").toLowerCase().includes(S.busq);
export const activos = () => S.pedidos.filter((p) => p.estado !== "cancelado");
export const nombreDe = (id) => producto(id)?.nombre ?? "Producto eliminado";
