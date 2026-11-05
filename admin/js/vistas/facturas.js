import { esc, dinero, fechaHora } from "../../../shared/util.js";
import { codigoFactura, codigoPedido } from "../../../shared/dominio.js";
import { abrirFactura } from "../../../shared/pedidos.js";
import { TIENDA } from "../../../shared/catalogo.js";
import { S, coincide, nombreDe, ganchos } from "../estado.js";
import { tabla } from "../ui.js";

// Una factura por cada pedido entregado (las reposiciones sin costo no generan factura)
const facturables = () => S.pedidos.filter((p) => p.estado === "entregado" && !p.reposicionDe).reverse();
export default {
  id: "facturas", icono: "📄", titulo: "Facturas",
  render() {
    const l = facturables().filter((p) => coincide(codigoFactura(p.id), codigoPedido(p.id), p.cliente.nombre));
    return `<section class="caja"><div class="cab"><h2>Facturas emitidas</h2><button class="btn gris" data-a="anteriores">Cargar pedidos anteriores</button></div>
      ${!TIENDA.nit ? '<p class="alerta">ℹ️ Completa los datos del negocio (NIT, dirección, teléfono) en Configuración para que salgan en las facturas.</p>' : ""}
      ${tabla(["Factura", "Pedido", "Fecha", "Cliente", "Total", ""], l.map((p) => `<tr><td><b>${codigoFactura(p.id)}</b></td><td>${codigoPedido(p.id)}</td><td>${fechaHora(p.tiempos?.entregado || p.fecha)}</td><td>${esc(p.cliente.nombre)}</td><td>${dinero(p.total)}</td><td class="acc"><button data-a="ver" data-id="${p.id}">🖨️ Ver factura</button></td></tr>`), "Aún no hay pedidos entregados.")}
      <p class="nota">Se muestran los pedidos de los últimos ${S.diasPedidos} días.</p></section>`;
  },
  acciones: {
    ver: (d) => abrirFactura(S.pedidos.find((p) => p.id == d.id), TIENDA, nombreDe),
    anteriores: () => ganchos.ampliarPedidos(90)
  }
};
