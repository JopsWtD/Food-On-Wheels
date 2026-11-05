import { esc, fechaHora } from "../../../shared/util.js";
import { doc, collection, addDoc, updateDoc } from "../../../shared/firebase.js";
import { INVENTARIO } from "../../../shared/catalogo.js";
import { S, db, coincide } from "../estado.js";
import { tabla, campo, editor, chips, aviso, fallo } from "../ui.js";
import { registrar, actualizarRecetas } from "../servicios.js";

let tab = "existencias", rango = "todo";
const r2 = (n) => +(+n).toFixed(2);
function gastos() {
  const hoy = new Date().toDateString(), h = S.historial.filter((x) => rango === "todo" || new Date(x.f).toDateString() === hoy);
  const res = {}; h.forEach((x) => { const r = (res[x.n] ||= { g: 0, r: 0 }); if (/^(Pedido|Devolución)/.test(x.motivo)) r.g -= x.c; else if (x.c > 0) r.r += x.c; });
  return `${chips([["hoy", "Hoy"], ["todo", "Todo el historial"]], rango, "rango")}
  ${tabla(["Insumo", "Gastado", "Repuesto", "Stock actual"], INVENTARIO.map((i) => `<tr><td><b>${esc(i.n)}</b></td><td>${r2(res[i.n]?.g || 0)} ${esc(i.u)}</td><td>${r2(res[i.n]?.r || 0)} ${esc(i.u)}</td><td>${r2(i.s)} ${esc(i.u)}</td></tr>`))}
  <h3 class="sub">Últimos movimientos</h3>
  ${tabla(["Fecha", "Insumo", "Cantidad", "Motivo"], h.slice(0, 40).map((x) => `<tr><td>${fechaHora(x.f)}</td><td>${esc(x.n)}</td><td class="${x.c < 0 ? "neg" : "pos"}">${x.c > 0 ? "+" : ""}${x.c}</td><td>${esc(x.motivo)}</td></tr>`), "Sin movimientos.")}`;
}
function editar(k) {
  const e = INVENTARIO[k] || {};
  editor(k >= 0 ? "Editar insumo" : "Nuevo insumo", `${campo("Nombre", "n", e.n, "text", "required")}${campo("Unidad (kg, und, L…)", "u", e.u || "kg", "text", "required")}<div class="dos-col">${campo("Stock", "s", e.s ?? 0, "number", 'required min="0" step="any"')}${campo("Mínimo", "m", e.m ?? 0, "number", 'required min="0" step="any"')}</div>`, async (fd) => {
    const n = fd.get("n").trim();
    if (INVENTARIO.some((x, j) => x.n === n && j !== k)) return "Ya existe un insumo con ese nombre.";
    const nuevo = { n, u: fd.get("u").trim(), s: +fd.get("s"), m: +fd.get("m") };
    if (k >= 0) {
      if (e.n !== n) await actualizarRecetas((r) => r.map(([x, c]) => [x === e.n ? n : x, c])); // renombrar en las recetas
      await updateDoc(doc(db, "inventario", e._id), nuevo);
      if (nuevo.s !== e.s) await registrar(n, nuevo.s - e.s, "Ajuste manual");
    } else { await addDoc(collection(db, "inventario"), { ...nuevo, orden: Date.now() }); await registrar(n, nuevo.s, "Stock inicial"); }
    return true;
  });
}

export default {
  id: "inventario", icono: "🥬", titulo: "Inventario",
  contador: () => INVENTARIO.filter((i) => i._id && i.s <= i.m).length,
  render() {
    const pestañas = chips([["existencias", "Existencias"], ["gastos", "Gastos e historial"]], tab, "tab");
    if (tab === "gastos") return `<section class="caja"><h2>Gasto de insumos</h2>${pestañas}${gastos()}</section>`;
    const bajos = INVENTARIO.filter((i) => i.s <= i.m).length;
    return `${bajos ? `<p class="alerta">⚠️ ${bajos} insumo${bajos > 1 ? "s" : ""} con stock bajo. Repón antes de que se agote la cocina.</p>` : ""}
    <section class="caja"><div class="cab"><h2>Inventario de insumos</h2><button class="btn" data-a="nuevo">＋ Añadir insumo</button></div>${pestañas}
    ${tabla(["Insumo", "Stock", "Mínimo", "Nivel", "Ajustar", "Acciones"], INVENTARIO.map((i, k) => [i, k]).filter(([i]) => coincide(i.n)).map(([i, k]) => `<tr class="${i.s <= i.m ? "bajo" : ""}"><td><b>${esc(i.n)}</b></td><td>${r2(i.s)} ${esc(i.u)}</td><td>${i.m} ${esc(i.u)}</td><td><div class="nivel"><i style="width:${Math.min(100, i.s / ((i.m || 1) * 3) * 100)}%"></i></div></td><td class="ajuste"><button data-a="ajustar" data-k="${k}" data-d="-1">−1</button><button data-a="ajustar" data-k="${k}" data-d="1">+1</button><button data-a="ajustar" data-k="${k}" data-d="10">+10</button></td><td class="acc"><button data-a="editar" data-k="${k}">Editar</button><button class="peli" data-a="eliminar" data-k="${k}">Eliminar</button></td></tr>`))}</section>`;
  },
  acciones: {
    tab: (d) => { tab = d.v; }, rango: (d) => { rango = d.v; },
    nuevo: () => editar(-1), editar: (d) => editar(+d.k),
    async ajustar(d) {
      const i = INVENTARIO[+d.k], nuevo = Math.max(0, Math.round((i.s + +d.d) * 1000) / 1000);
      try { await updateDoc(doc(db, "inventario", i._id), { s: nuevo }); await registrar(i.n, nuevo - i.s, "Ajuste manual"); } catch (e) { fallo(e); }
    },
    async eliminar(d) {
      const i = INVENTARIO[+d.k];
      if (!confirm(`¿Eliminar «${i.n}»? También se quitará de las recetas.`)) return;
      try { await actualizarRecetas((r) => r.filter(([x]) => x !== i.n), (b) => b.delete(doc(db, "inventario", i._id))); aviso("Insumo eliminado"); } catch (e) { fallo(e); }
    }
  }
};
