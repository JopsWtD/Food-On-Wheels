// Ventas + reportes (antes eran dos secciones con los mismos datos).
import { esc, dinero } from "../../../shared/util.js";
import { S, activos, nombreDe } from "../estado.js";
import { kpi, chips } from "../ui.js";
import { producto } from "../../../shared/catalogo.js";

let rango = "7";
const inicioDe = (r) => r === "hoy" ? new Date(new Date().toDateString()) : new Date(Date.now() - (r === "todo" ? S.diasPedidos : +r) * 864e5);
export const rangoDe = (r, lista = activos()) => { const d = inicioDe(r); return lista.filter((p) => new Date(p.fecha) >= d); };

// Línea con área: ventas acumuladas por hora (hoy) o ventas por día (otros rangos)
export function grafica(r, lista) {
  let valores, etiquetas;
  if (r === "hoy") {
    valores = Array(15).fill(0); lista.forEach((p) => { const k = new Date(p.fecha).getHours() - 8; if (k >= 0 && k < 15) valores[k] += p.total; });
    let ac = 0; valores = valores.map((v) => (ac += v)); etiquetas = valores.map((_, i) => `${8 + i}h`);
  } else {
    const dias = r === "todo" ? S.diasPedidos : +r, d0 = inicioDe(r);
    valores = Array(dias).fill(0); etiquetas = valores.map((_, i) => { const d = new Date(d0.getTime() + i * 864e5); return `${d.getDate()}/${d.getMonth() + 1}`; });
    lista.forEach((p) => { const k = Math.floor((new Date(p.fecha) - d0) / 864e5); if (k >= 0 && k < dias) valores[k] += p.total; });
  }
  const n = valores.length, max = Math.max(...valores, 1), paso = Math.ceil(n / 8);
  const pts = valores.map((v, i) => [40 + i * (540 / Math.max(1, n - 1)), 190 - (v / max) * 160]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  return `<svg viewBox="0 0 600 220" class="graf" role="img" aria-label="Gráfica de ventas"><path class="area" d="${d} L${pts[n - 1][0]} 190 L40 190Z"/><path class="linea" pathLength="1" d="${d}"/>${pts.map((p, i) => i % paso ? "" : `<text x="${p[0]}" y="212" text-anchor="middle">${etiquetas[i]}</text>`).join("")}<circle class="punto" cx="${pts[n - 1][0]}" cy="${pts[n - 1][1]}" r="5"/></svg>`;
}
export function ranking(lista, n) {
  const m = {}; lista.forEach((p) => p.items.forEach((i) => (m[i.id] = (m[i.id] || 0) + i.cant)));
  return Object.entries(m).map(([id, c]) => ({ id, c })).sort((a, b) => b.c - a.c).slice(0, n);
}
export function barras(lista, n) {
  const r = ranking(lista, n), max = r[0]?.c || 1;
  return r.length ? `<ol class="barras">${r.map((x, i) => `<li style="--w:${x.c / max * 100}%;--i:${i}"><span>${esc(producto(x.id)?.emoji || "🍽️")} ${esc(nombreDe(x.id))}</span><i></i><b>${x.c} vendidos</b></li>`).join("")}</ol>` : '<p class="vacio">Sin ventas en este periodo.</p>';
}

export default {
  id: "ventas", icono: "📈", titulo: "Ventas",
  render() {
    const l = rangoDe(rango), t = l.reduce((s, p) => s + p.total, 0), d0 = inicioDe(rango);
    const cancelados = rangoDe(rango, S.pedidos).filter((p) => p.estado === "cancelado").length;
    const prime = S.membresias.filter((m) => new Date(m.fecha) >= d0).reduce((s, m) => s + m.precio, 0);
    const reembolsos = S.reclamos.filter((r) => r.resolucion === "reembolso" && new Date(r.fechaRespuesta) >= d0).reduce((s, r) => s + (r.monto || 0), 0);
    const estrella = ranking(l, 1)[0];
    return `${chips([["hoy", "Hoy"], ["7", "7 días"], ["30", "30 días"], ["todo", `${S.diasPedidos} días`]], rango, "rango")}
    <div class="kpis">${kpi("💰", "c2", "Ventas", t, "$")}${kpi("🛍️", "c1", "Pedidos", l.length)}${kpi("🎟️", "c3", "Ticket promedio", l.length ? t / l.length : 0, "$")}${kpi("🛵", "c4", "Domicilios", l.filter((p) => p.entrega === "domicilio").length)}
    ${kpi("⭐", "c1", "Unidades vendidas", l.reduce((n, p) => n + p.items.reduce((x, i) => x + i.cant, 0), 0))}${kpi("🚫", "c3", "Cancelados", cancelados)}${kpi("👑", "c2", "Ingresos Prime", prime, "$")}${kpi("↩️", "c4", "Reembolsos", reembolsos, "$")}</div>
    <div class="dos"><section class="caja"><h2>${rango === "hoy" ? "Ventas acumuladas de hoy" : "Ventas por día"}</h2><p class="gran">${dinero(t)}</p>${grafica(rango, l)}</section>
    <section class="caja"><h2>Más vendidos</h2>${estrella ? `<p class="estrella">🏆 Producto estrella: <b>${esc(nombreDe(estrella.id))}</b> (${estrella.c} unidades)</p>` : ""}${barras(l, 8)}</section></div>`;
  },
  acciones: { rango: (d) => { rango = d.v; } }
};
