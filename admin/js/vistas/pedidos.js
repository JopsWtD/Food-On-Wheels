import { esc, dinero, hora } from "../../../shared/util.js";
import { ESTADOS, siguiente, textoAccion, codigoPedido, etiquetaAdmin, aplicarDescuento, terminado } from "../../../shared/dominio.js";
import { faltantes, producto, precioFinal, EVENTOS } from "../../../shared/catalogo.js";
import { S, coincide, nombreDe } from "../estado.js";
import { tabla, badge, editor, aviso } from "../ui.js";
import { cambiarEstado, errorEstado } from "../servicios.js";

let filtro = "todos";

// Alerta si los precios del pedido no cuadran con el catálogo (p. ej. alguien alteró el total desde el navegador)
function alertaPrecio(p) {
  if (p.reposicionDe || terminado(p)) return ""; // en pedidos terminados ya no tiene sentido (los eventos pudieron cambiar)
  const suma = p.items.reduce((s, i) => s + i.precio * i.cant, 0);
  // Un precio menor al actual se acepta si coincide con el descuento de un evento que existe con ese nombre
  const valido = (i, x) => i.precio >= precioFinal(x) - 1 || (i.descuento && EVENTOS.some((e) => e.nombre === i.evento && e.porcentaje >= i.descuento) && i.precio >= aplicarDescuento(x.precio, i.descuento) - 1);
  const masBarato = p.items.some((i) => { const x = producto(i.id); return x && !valido(i, x); });
  const primeSinMembresia = p.prime > 0 && !S.cuentas.find((c) => c.uid === p.uid)?.prime;
  const noCuadra = Math.abs(suma - p.sub) > 1 || Math.abs(p.sub - p.prime + (p.envio || 0) - p.total) > 1;
  return masBarato || primeSinMembresia || noCuadra ? `<small class="alerta-precio" title="Los precios o el descuento no coinciden con el catálogo actual">⚠️ Revisar precios</small>` : "";
}
export function filaPedido(p, editable) {
  const det = p.items.map((i) => `${i.cant}× ${esc(nombreDe(i.id))}${i.descuento ? ` <span class="ev-mini" title="${esc(i.evento)}">-${i.descuento}%</span>` : ""}${i.nota ? ` <i class="nota-item">(${esc(i.nota)})</i>` : ""}`).join(", ");
  const rec = p.entrega === "recoger", sig = siguiente(p);
  const contacto = [!rec && p.direccion ? `📍 ${esc(p.direccion)}` : "", p.cliente.telefono ? `📞 ${esc(p.cliente.telefono)}` : ""].filter(Boolean).join(" · ");
  const falta = p.estado === "pendiente" && !p.descontado ? faltantes(p.items) : [];
  const desde = p.tiempos?.[p.estado] ? `<small class="desde">${sig ? "desde" : "a las"} ${hora(p.tiempos[p.estado])}</small>` : "";
  // Un botón para el siguiente paso y otro para cancelar; un pedido terminado ya no se toca
  const control = `<div class="control-estado">${badge(p.estado, p)}${desde}${sig ? `<div class="botones-estado">
      <button class="btn-estado" data-a="avanzar" data-id="${p.id}" ${falta.length ? `disabled title="Falta: ${esc(falta.join(", "))}"` : ""}>${textoAccion(p, sig)} →</button>
      <button class="btn-cancelar" data-a="cancelar" data-id="${p.id}" aria-label="Cancelar pedido ${codigoPedido(p.id)}">Cancelar</button></div>` : ""}
    ${falta.length ? `<small class="falta">⚠️ Falta inventario: ${esc(falta.join(", "))}</small>` : ""}</div>`;
  const extra = [p.reposicionDe ? `<em class="repo">🔁 Reposición sin costo de ${codigoPedido(p.reposicionDe)}</em>` : "",
    p.estado === "cancelado" && p.motivoCancelacion ? `<em class="cancel">Cancelado por ${p.canceladoPor === "cliente" ? "el cliente" : "el restaurante"}: ${esc(p.motivoCancelacion)}</em>` : "",
    p.notas ? `<em>Nota: ${esc(p.notas)}</em>` : "", alertaPrecio(p)].join("");
  return `<tr class="${p.estado === "pendiente" ? "nuevo" : ""}"><td>${hora(p.fecha)}</td><td><b>${codigoPedido(p.id)}</b></td><td>${esc(p.cliente.nombre)}</td>${editable ? `<td class="det">${det}${contacto ? `<small class="contacto">${contacto}</small>` : ""}${extra}</td>` : ""}<td>${rec ? "🏪 Recoger" : "🛵 Domicilio"}</td><td>${p.reposicionDe ? "Sin costo" : dinero(p.total)}</td><td>${editable ? control : badge(p.estado, p)}</td></tr>`;
}

export default {
  id: "pedidos", icono: "🧾", titulo: "Pedidos",
  contador: () => S.pedidos.filter((p) => p.estado === "pendiente").length,
  render() {
    const l = S.pedidos.slice().reverse().filter((p) => (filtro === "todos" || p.estado === filtro) && coincide(codigoPedido(p.id), p.cliente.nombre));
    return `<section class="caja"><div class="cab"><h2>Pedidos</h2><small class="nota">Últimos ${S.diasPedidos} días</small></div>
      <div class="chips">${["todos", ...ESTADOS].map((e) => `<button class="chip" data-a="filtro" data-v="${e}" aria-pressed="${e === filtro}">${e}${e === "todos" ? "" : " (" + S.pedidos.filter((p) => p.estado === e).length + ")"}</button>`).join("")}</div>
      ${tabla(["Hora", "Pedido", "Cliente", "Detalle", "Entrega", "Total", "Estado"], l.map((p) => filaPedido(p, true)), "No hay pedidos con este filtro.")}</section>`;
  },
  acciones: {
    filtro: (d) => { filtro = d.v; },
    async avanzar(d, btn) {
      const p = S.pedidos.find((x) => x.id == d.id), sig = siguiente(p);
      if (sig === "entregado" && !confirm(`¿Confirmas que ${codigoPedido(p.id)} fue ${p.entrega === "recoger" ? "recogido" : "entregado"}? Después ya no se podrá cambiar.`)) return;
      btn.disabled = true;
      try { await cambiarEstado(p, sig); aviso(`${codigoPedido(p.id)}: ${etiquetaAdmin(p, sig)}`); } catch (e) { errorEstado(e); btn.disabled = false; }
    },
    cancelar(d) {
      const p = S.pedidos.find((x) => x.id == d.id);
      editor(`Cancelar ${codigoPedido(p.id)}`, `<p class="nota">El cliente verá el motivo en «Mis pedidos». ${p.descontado ? "Los insumos ya descontados vuelven al inventario." : ""}</p>
        <label>Motivo<select name="motivo">${["No hay ingredientes suficientes", "No hay cobertura en esa dirección", "No se pudo contactar al cliente", "El cliente lo pidió por teléfono", "Otro"].map((m) => `<option>${m}</option>`).join("")}</select></label>
        <label>Detalle (opcional)<textarea name="detalle" rows="2"></textarea></label>`, async (fd) => {
        const motivo = fd.get("motivo") + (fd.get("detalle").trim() ? ": " + fd.get("detalle").trim() : "");
        try { await cambiarEstado(p, "cancelado", { motivoCancelacion: motivo, canceladoPor: "restaurante" }); } catch (e) { errorEstado(e); }
        return true;
      }, "Cancelar pedido");
    }
  }
};
