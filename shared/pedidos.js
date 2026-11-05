// Operaciones de pedidos compartidas: crear con número consecutivo e imprimir la factura.
import { doc, runTransaction } from "./firebase.js";
import { esc, dinero, fechaHora } from "./util.js";
import { codigoFactura, codigoPedido } from "./dominio.js";

// Reserva el siguiente número (#FOW-0001…) y crea el pedido en una sola transacción.
// "extra(tx, n)" permite escribir algo más en la misma transacción (p. ej. el reclamo que originó una reposición).
export function crearPedido(db, datos, extra = () => {}) {
  return runTransaction(db, async (tx) => {
    const cref = doc(db, "contadores", "pedidos"), c = await tx.get(cref), n = (c.exists() ? c.data().n : 0) + 1;
    c.exists() ? tx.update(cref, { n }) : tx.set(cref, { n });
    tx.set(doc(db, "pedidos", String(n)), { ...datos, id: n });
    extra(tx, n);
    return n;
  });
}

// Abre la factura de un pedido entregado en una ventana lista para imprimir o guardar como PDF.
export function abrirFactura(p, tienda, nombreDe) {
  const filas = p.items.map((i) => `<tr><td>${i.cant}</td><td>${esc(nombreDe(i.id))}${i.nota ? `<small>${esc(i.nota)}</small>` : ""}</td><td>${dinero(i.precio)}</td><td>${dinero(i.precio * i.cant)}</td></tr>`).join("");
  const fila = (t, v, c = "") => `<tr class="${c}"><td colspan="3">${t}</td><td>${v}</td></tr>`;
  const w = window.open("", "_blank", "width=720,height=900");
  if (!w) return alert("Permite las ventanas emergentes para ver la factura.");
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${codigoFactura(p.id)}</title><style>
    body{font:14px/1.5 "Segoe UI",system-ui,sans-serif;color:#1b2b24;max-width:640px;margin:32px auto;padding:0 24px}
    header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:16px;border-bottom:3px solid #0f3d2e}
    h1{margin:0;font-size:1.6rem;color:#0f3d2e}h2{margin:0;font-size:1.1rem;text-align:right;color:#f26a1b}
    .datos{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}.datos b{display:block;font-size:.75rem;text-transform:uppercase;color:#6b7a73}
    table{width:100%;border-collapse:collapse;margin-top:8px}th,td{padding:8px 6px;text-align:left;border-bottom:1px solid #e5e1d6}
    th{font-size:.75rem;text-transform:uppercase;color:#6b7a73}td:last-child,th:last-child{text-align:right}
    td small{display:block;color:#6b7a73}.total td{font-weight:800;font-size:1.1rem;border-bottom:0}
    footer{margin-top:28px;color:#6b7a73;font-size:.8rem;text-align:center}button{margin-top:20px;padding:10px 18px;border:0;border-radius:999px;background:#0f3d2e;color:#fff;font-weight:700;cursor:pointer}
    @media print{button{display:none}body{margin:0}}</style></head><body>
    <header><div><h1>${esc(tienda.nombre)}</h1>${tienda.nit ? `<div>NIT ${esc(tienda.nit)}</div>` : ""}${tienda.direccion ? `<div>${esc(tienda.direccion)}</div>` : ""}${tienda.telefono ? `<div>Tel. ${esc(tienda.telefono)}</div>` : ""}</div>
    <div><h2>Factura ${codigoFactura(p.id)}</h2><div>Pedido ${codigoPedido(p.id)}</div><div>${fechaHora(p.tiempos?.entregado || p.fecha)}</div></div></header>
    <div class="datos"><div><b>Cliente</b>${esc(p.cliente.nombre)}<br>${esc(p.cliente.correo || "")}<br>${esc(p.cliente.telefono || "")}</div>
    <div><b>Entrega</b>${p.entrega === "domicilio" ? "Domicilio<br>" + esc(p.direccion) : "Recogido en el local"}</div></div>
    <table><thead><tr><th>Cant.</th><th>Producto</th><th>Precio</th><th>Total</th></tr></thead><tbody>${filas}
    ${fila("Subtotal", dinero(p.sub))}${p.prime ? fila("Descuento Prime", "-" + dinero(p.prime)) : ""}${p.envio ? fila("Envío", dinero(p.envio)) : ""}${fila("Total", dinero(p.total), "total")}</tbody></table>
    <footer>Gracias por tu compra. Documento generado por ${esc(tienda.nombre)}.</footer>
    <button onclick="print()">Imprimir o guardar como PDF</button></body></html>`);
  w.document.close();
}
