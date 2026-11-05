import { esc, dinero, fechaHora } from "../../../shared/util.js";
import { codigoPedido, MOTIVOS_RECLAMO } from "../../../shared/dominio.js";
import { crearPedido } from "../../../shared/pedidos.js";
import { doc, updateDoc } from "../../../shared/firebase.js";
import { S, db, coincide, nombreDe } from "../estado.js";
import { editor, mostrar } from "../ui.js";

let tab = "abiertos";
const textoItems = (items) => items.map((i) => `${i.cant}× ${esc(nombreDe(i.id))}`).join(", ");

function tarjeta(r) {
  const p = S.pedidos.find((x) => x.id === r.pedidoId);
  const pide = r.solicitud === "reembolso" ? `Reembolso total (${dinero(p?.total ?? 0)})` : `Reenvío de: ${textoItems(r.items)}`;
  const resultado = r.estado === "abierto" ? "" : `<p class="respuesta ${r.estado}"><b>${r.estado === "aprobado" ? (r.resolucion === "reembolso" ? `✅ Reembolso aprobado: ${dinero(r.monto)}` : `✅ Reenvío creado: ${codigoPedido(r.reposicionId)}`) : "❌ Rechazado"}</b>${r.respuesta ? ` — ${esc(r.respuesta)}` : ""}</p>`;
  return `<article class="reclamo caja"><button class="foto" data-a="foto" data-r="${r.pedidoId}" aria-label="Ver foto en grande"><img src="${r.foto}" alt="Foto adjunta por el cliente"></button>
    <div><header><b>${codigoPedido(r.pedidoId)}</b> · ${esc(r.nombre)} <span class="est ${r.estado === "abierto" ? "e0" : r.estado === "aprobado" ? "e3" : "e5"}">${r.estado}</span><small>${fechaHora(r.fecha)}</small></header>
    <p><b>${MOTIVOS_RECLAMO[r.motivo] || esc(r.motivo)}</b> · Productos: ${textoItems(r.items)}</p>
    <p class="desc">“${esc(r.descripcion)}”</p><p class="pide">El cliente pide: <b>${pide}</b></p>${resultado}
    ${r.estado === "abierto" ? `<div class="acc"><button data-a="aprobar" data-r="${r.pedidoId}">Aprobar</button><button class="peli" data-a="rechazar" data-r="${r.pedidoId}">Rechazar</button></div>` : ""}</div></article>`;
}
function resolver(pid, aprobar) {
  const r = S.reclamos.find((x) => x.pedidoId == pid), p = S.pedidos.find((x) => x.id === r.pedidoId);
  if (aprobar && !p) return alert("El pedido original ya no está cargado. Amplía el periodo en Facturas → «Cargar pedidos anteriores».");
  const que = r.solicitud === "reembolso" ? `Se registrará un reembolso de <b>${dinero(p.total)}</b>. Recuerda devolver el dinero al cliente.` : `Se creará un pedido sin costo con: <b>${textoItems(r.items)}</b>.`;
  editor(aprobar ? "Aprobar reclamo" : "Rechazar reclamo", `${aprobar ? `<p class="nota">${que}</p>` : ""}<label>Mensaje para el cliente${aprobar ? " (opcional)" : ""}<textarea name="respuesta" rows="3" ${aprobar ? "" : 'required minlength="5"'} placeholder="${aprobar ? "Ej. Lamentamos lo ocurrido." : "Explica por qué se rechaza"}"></textarea></label>`, async (fd) => {
    const base = { respuesta: fd.get("respuesta").trim(), fechaRespuesta: new Date().toISOString() }, ref = doc(db, "reclamos", String(r.pedidoId));
    if (!aprobar) { await updateDoc(ref, { ...base, estado: "rechazado" }); return true; }
    if (r.solicitud === "reembolso") { await updateDoc(ref, { ...base, estado: "aprobado", resolucion: "reembolso", monto: p.total }); return true; }
    await crearPedido(db, { uid: r.uid, estado: "pendiente", fecha: new Date().toISOString(), cliente: p.cliente, entrega: p.entrega, direccion: p.direccion || "", notas: `Reposición del pedido ${codigoPedido(p.id)}`, items: r.items.map((i) => ({ ...i, precio: 0 })), sub: 0, prime: 0, envio: 0, total: 0, reposicionDe: p.id, tiempos: { pendiente: Date.now() } },
      (tx, n) => tx.update(ref, { ...base, estado: "aprobado", resolucion: "reenvio", reposicionId: n }));
    return true;
  }, aprobar ? "Aprobar" : "Rechazar");
}

export default {
  id: "reclamos", icono: "📮", titulo: "Reclamos",
  contador: () => S.reclamos.filter((r) => r.estado === "abierto").length,
  render() {
    const abiertos = S.reclamos.filter((r) => r.estado === "abierto").length;
    const l = S.reclamos.filter((r) => (tab === "abiertos") === (r.estado === "abierto") && coincide(codigoPedido(r.pedidoId), r.nombre)).sort((a, b) => b.fecha.localeCompare(a.fecha));
    return `<div class="cab"><h2>Reclamos</h2></div><div class="chips">${[["abiertos", `Por revisar (${abiertos})`], ["resueltos", "Resueltos"]].map(([k, t]) => `<button class="chip" data-a="tab" data-v="${k}" aria-pressed="${k === tab}">${t}</button>`).join("")}</div>${l.map(tarjeta).join("") || '<p class="vacio caja">No hay reclamos aquí.</p>'}`;
  },
  acciones: {
    tab: (d) => { tab = d.v; },
    aprobar: (d) => resolver(d.r, true),
    rechazar: (d) => resolver(d.r, false),
    foto: (d) => { const r = S.reclamos.find((x) => x.pedidoId == d.r); mostrar(`Foto del reclamo ${codigoPedido(r.pedidoId)}`, `<img class="foto-grande" src="${r.foto}" alt="Foto adjunta por el cliente">`); }
  }
};
