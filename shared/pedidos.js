// Operaciones compartidas: crear pedidos y suscripciones con número consecutivo, e imprimir facturas.
import { doc, runTransaction } from "./firebase.js";
import { esc, dinero, fechaHora, fecha } from "./util.js";
import { codigoFactura, codigoPedido, codigoSuscripcion } from "./dominio.js";

// Reserva el siguiente número del contador y crea el documento en una sola transacción.
// "extra(tx, n)" permite escribir algo más en la misma transacción.
function crearConsecutivo(db, contador, coleccion, armar, extra = () => {}) {
  return runTransaction(db, async (tx) => {
    const cref = doc(db, "contadores", contador), c = await tx.get(cref), n = (c.exists() ? c.data().n : 0) + 1;
    c.exists() ? tx.update(cref, { n }) : tx.set(cref, { n });
    tx.set(doc(db, coleccion, String(n)), armar(n));
    extra(tx, n);
    return n;
  });
}
// Pedido #FOW-0001…
export const crearPedido = (db, datos, extra) => crearConsecutivo(db, "pedidos", "pedidos", (n) => ({ ...datos, id: n }), extra);
// Suscripción FoW Prime SUS-0001…
export const crearMembresia = (db, datos) => crearConsecutivo(db, "membresias", "membresias", (n) => ({ ...datos, numero: n }));

/* ===== FACTURAS ===== Una sola plantilla para pedidos y suscripciones, lista para imprimir o guardar como PDF */
function ventanaFactura({ titulo, codigo, referencia, fechaTexto, tienda, cliente, detalleDerecha, filas, totales }) {
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return alert("Permite las ventanas emergentes para ver la factura.");
  const fila = ([t, v, c = ""]) => `<tr class="${c}"><td colspan="3">${t}</td><td>${v}</td></tr>`;
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${codigo}</title><style>
    body{font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:#1b2b24;max-width:640px;margin:32px auto;padding:0 24px}
    header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:16px;border-bottom:3px solid #0f3d2e}
    h1{margin:0;font-size:1.6rem;color:#0f3d2e}h2{margin:0;font-size:1.1rem;text-align:right;color:#f26a1b}header>div:last-child{text-align:right}
    .datos{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.datos b{display:block;font-size:.75rem;text-transform:uppercase;color:#6b7a73}
    table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:8px 6px;text-align:left;border-bottom:1px solid #e5e1d6}
    th{font-size:.75rem;text-transform:uppercase;color:#6b7a73}td:last-child,th:last-child{text-align:right}
    td small{display:block;color:#6b7a73}.total td{font-weight:800;font-size:1.1rem;border-bottom:0}
    footer{margin-top:28px;color:#6b7a73;font-size:.8rem;text-align:center}button{margin-top:20px;padding:10px 18px;border:0;border-radius:999px;background:#0f3d2e;color:#fff;font-weight:700;cursor:pointer}
    @media print{button{display:none}body{margin:0}}</style></head><body>
    <header><div><h1>${esc(tienda.nombre)}</h1>${tienda.nit ? `<div>NIT ${esc(tienda.nit)}</div>` : ""}${tienda.direccion ? `<div>${esc(tienda.direccion)}</div>` : ""}${tienda.telefono ? `<div>Tel. ${esc(tienda.telefono)}</div>` : ""}</div>
    <div><h2>${titulo} ${codigo}</h2>${referencia ? `<div>${referencia}</div>` : ""}<div>${fechaTexto}</div></div></header>
    <div class="datos"><div><b>Cliente</b>${cliente}</div><div>${detalleDerecha}</div></div>
    <table><thead><tr><th>Cant.</th><th>Concepto</th><th>Precio</th><th>Total</th></tr></thead><tbody>${filas}${totales.map(fila).join("")}</tbody></table>
    <footer>Gracias por tu compra. Documento generado por ${esc(tienda.nombre)}.</footer>
    <button onclick="print()">Imprimir o guardar como PDF</button></body></html>`);
  w.document.close();
}
const datosCliente = (c) => `${esc(c.nombre)}<br>${esc(c.correo || "")}${c.telefono ? "<br>" + esc(c.telefono) : ""}`;

// Factura de un pedido entregado
export function abrirFactura(p, tienda, nombreDe) {
  ventanaFactura({
    titulo: "Factura", codigo: codigoFactura(p.id), referencia: `Pedido ${codigoPedido(p.id)}`, fechaTexto: fechaHora(p.tiempos?.entregado || p.fecha), tienda,
    cliente: datosCliente(p.cliente),
    detalleDerecha: `<b>Entrega</b>${p.entrega === "domicilio" ? "Domicilio<br>" + esc(p.direccion) : "Recogido en el local"}`,
    filas: p.items.map((i) => `<tr><td>${i.cant}</td><td>${esc(nombreDe(i.id))}${i.evento ? `<small>Evento «${esc(i.evento)}»: -${i.descuento}%</small>` : ""}${i.nota ? `<small>${esc(i.nota)}</small>` : ""}</td><td>${dinero(i.precio)}</td><td>${dinero(i.precio * i.cant)}</td></tr>`).join(""),
    totales: [["Subtotal", dinero(p.sub)], ...(p.prime ? [["Descuento Prime", "-" + dinero(p.prime)]] : []), ...(p.envio ? [["Envío", dinero(p.envio)]] : []), ["Total", dinero(p.total), "total"]]
  });
}
// Factura de una suscripción FoW Prime
export const METODOS = { tarjeta: "Tarjeta", nequi: "Nequi", daviplata: "Daviplata", pse: "PSE" };
export function abrirFacturaSuscripcion(m, tienda) {
  ventanaFactura({
    titulo: "Factura", codigo: codigoSuscripcion(m), referencia: "Suscripción FoW Prime", fechaTexto: fechaHora(m.fecha), tienda,
    cliente: datosCliente(m),
    detalleDerecha: `<b>Vigencia</b>${fecha(m.desde || m.fecha)}${m.vence ? " → " + fecha(m.vence) : ""}<br><b style="margin-top:8px">Método de pago</b>${esc(METODOS[m.metodo] || m.metodo || "—")}`,
    filas: `<tr><td>1</td><td>FoW Prime — plan ${esc(m.plan)}${m.dias ? `<small>${m.dias} días de descuento en todas las compras</small>` : ""}</td><td>${dinero(m.precio)}</td><td>${dinero(m.precio)}</td></tr>`,
    totales: [["Total", dinero(m.precio), "total"]]
  });
}
