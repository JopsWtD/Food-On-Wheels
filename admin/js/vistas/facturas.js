// Facturas con dos subsecciones: pedidos entregados y suscripciones FoW Prime
import { esc, dinero, fechaHora, fecha } from "../../../shared/util.js";
import { codigoFactura, codigoPedido, codigoSuscripcion } from "../../../shared/dominio.js";
import { abrirFactura, abrirFacturaSuscripcion, METODOS } from "../../../shared/pedidos.js";
import { TIENDA } from "../../../shared/catalogo.js";
import { S, coincide, nombreDe, ganchos } from "../estado.js";
import { tabla, chips, kpi } from "../ui.js";

let tab = "pedidos";
// Una factura por cada pedido entregado (las reposiciones sin costo no generan factura)
const facturables = () => S.pedidos.filter((p) => p.estado === "entregado" && !p.reposicionDe).reverse();
const suscripciones = () => S.membresias.slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
const vigente = (m) => m.vence && new Date(m.vence) > new Date();

function vistaPedidos() {
  const l = facturables().filter((p) => coincide(codigoFactura(p.id), codigoPedido(p.id), p.cliente.nombre));
  return `<div class="cab"><h3 class="sub">Facturas de pedidos</h3><button class="btn gris" data-a="anteriores">Cargar pedidos anteriores</button></div>
    ${tabla(["Factura", "Pedido", "Fecha", "Cliente", "Total", ""], l.map((p) => `<tr><td><b>${codigoFactura(p.id)}</b></td><td>${codigoPedido(p.id)}</td><td>${fechaHora(p.tiempos?.entregado || p.fecha)}</td><td>${esc(p.cliente.nombre)}</td><td>${dinero(p.total)}</td><td class="acc"><button data-a="ver" data-id="${p.id}">🖨️ Ver factura</button></td></tr>`), "Aún no hay pedidos entregados.")}
    <p class="nota">Se muestran los pedidos de los últimos ${S.diasPedidos} días.</p>`;
}
function vistaSuscripciones() {
  const todas = suscripciones(), l = todas.filter((m) => coincide(codigoSuscripcion(m), m.nombre, m.correo, m.plan));
  const total = todas.reduce((s, m) => s + (m.precio || 0), 0), activas = new Set(todas.filter(vigente).map((m) => m.uid)).size;
  return `<div class="kpis">${kpi("👑", "c1", "Suscripciones vendidas", todas.length)}${kpi("💰", "c2", "Ingresos por Prime", total, "$")}${kpi("✅", "c3", "Miembros activos", activas)}</div>
    <h3 class="sub">Facturas de suscripciones</h3>
    ${tabla(["Factura", "Fecha", "Cliente", "Plan", "Vigencia", "Pago", "Total", ""], l.map((m) => `<tr><td><b>${codigoSuscripcion(m)}</b></td><td>${fechaHora(m.fecha)}</td><td>${esc(m.nombre)}<small class="sub-texto">${esc(m.correo)}</small></td><td>👑 ${esc(m.plan)}</td><td>${m.vence ? `hasta ${fecha(m.vence)} ${vigente(m) ? '<span class="est e3">Vigente</span>' : '<span class="est e5">Vencida</span>'}` : "—"}</td><td>${esc(METODOS[m.metodo] || m.metodo || "—")}</td><td>${dinero(m.precio)}</td><td class="acc"><button data-a="verSus" data-id="${esc(m._id)}" title="Ver factura ${codigoSuscripcion(m)}">🖨️ Ver</button></td></tr>`), "Aún no se han vendido suscripciones FoW Prime.")}`;
}

export default {
  id: "facturas", icono: "📄", titulo: "Facturas",
  render() {
    return `<section class="caja"><div class="cab"><h2>Facturas</h2></div>
      ${chips([["pedidos", `🧾 Pedidos (${facturables().length})`], ["suscripciones", `👑 Suscripciones (${S.membresias.length})`]], tab, "tab")}
      ${!TIENDA.nit ? '<p class="alerta">ℹ️ Completa los datos del negocio (NIT, dirección, teléfono) en Configuración para que salgan en las facturas.</p>' : ""}
      ${tab === "pedidos" ? vistaPedidos() : vistaSuscripciones()}</section>`;
  },
  acciones: {
    tab: (d) => { tab = d.v; },
    ver: (d) => abrirFactura(S.pedidos.find((p) => p.id == d.id), TIENDA, nombreDe),
    verSus: (d) => abrirFacturaSuscripcion(S.membresias.find((m) => m._id === d.id), TIENDA),
    anteriores: () => ganchos.ampliarPedidos(90)
  }
};
