import { esc, dinero } from "../../../shared/util.js";
import { S, activos } from "../estado.js";
import { kpi, tabla } from "../ui.js";
import { filaPedido } from "./pedidos.js";
import { grafica, rangoDe, barras } from "./ventas.js";

export default {
  id: "inicio", icono: "🏠", titulo: "Inicio",
  render() {
    const h = rangoDe("hoy"), v = h.reduce((a, p) => a + p.total, 0);
    return `<section class="banner"><div><h1>¡Hola, ${esc(S.nombreAdmin.split(" ")[0])}!</h1><p>Aquí tienes el resumen de Food on Wheels hoy.</p></div><span class="moto" aria-hidden="true">🛵</span><em>Grandes sabores, mejores resultados</em></section>
    <div class="kpis">${kpi("🛍️", "c1", "Pedidos hoy", h.length)}${kpi("💰", "c2", "Ventas hoy", v, "$")}${kpi("⏳", "c3", "Pendientes", S.pedidos.filter((p) => p.estado === "pendiente").length)}${kpi("📮", "c4", "Reclamos por revisar", S.reclamos.filter((r) => r.estado === "abierto").length)}</div>
    <div class="dos"><section class="caja"><h2>Pedidos en tiempo real <small class="vivo">En línea</small></h2>${tabla(["Hora", "Pedido", "Cliente", "Entrega", "Total", "Estado"], S.pedidos.slice(-6).reverse().map((p) => filaPedido(p, false)), "Aún no hay pedidos.")}<a class="ver" href="#pedidos">Ver todos los pedidos →</a></section>
    <section class="caja"><h2>Ventas de hoy</h2><p class="gran">${dinero(v)}</p>${grafica("hoy", h)}</section></div>
    <section class="caja"><h2>Productos más vendidos <small class="nota">últimos ${S.diasPedidos} días</small></h2>${barras(activos(), 6)}</section>`;
  }
};
