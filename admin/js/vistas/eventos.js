// Eventos: descuentos que el admin crea, enciende y apaga cuando quiera (con fechas opcionales).
// Cada uno aplica un % a un producto o a una categoría completa. Si varios aplican al mismo producto, gana el mayor.
import { esc, fechaHora } from "../../../shared/util.js";
import { doc, collection, setDoc, updateDoc, deleteDoc } from "../../../shared/firebase.js";
import { EVENTOS, PRODUCTOS, CATEGORIAS, combos, esCombo, estadoEvento, objetivoDe } from "../../../shared/catalogo.js";
import { db, coincide } from "../estado.js";
import { tabla, campo, editor, aviso, fallo } from "../ui.js";

const ESTADO = { vigente: ["e3", "Vigente"], programado: ["e2", "Programado"], vencido: ["e5", "Vencido"], apagado: ["e4", "Apagado"] };
// <input type="datetime-local"> trabaja en hora local sin zona: se convierte a/desde ISO
const aLocal = (iso) => iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : "";
const aISO = (local) => local ? new Date(local).toISOString() : null;
const vigencia = (e) => e.desde && e.hasta ? `${fechaHora(e.desde)} → ${fechaHora(e.hasta)}` : e.desde ? `Desde ${fechaHora(e.desde)}` : e.hasta ? `Hasta ${fechaHora(e.hasta)}` : "Sin fechas";
const textoObjetivo = (e) => { const o = objetivoDe(e); return o ? `${e.objetivo.tipo === "producto" ? "" : "Sección "}${esc(o.emoji || "")} ${esc(o.nombre)}` : '<span class="neg">Ya no existe</span>'; };

function editar(id) {
  const e = EVENTOS.find((x) => x.id === id) || { porcentaje: 10, activo: true, objetivo: {} };
  const valor = e.objetivo.tipo ? `${e.objetivo.tipo}:${e.objetivo.id}` : "";
  const opt = (v, t) => `<option value="${esc(v)}" ${v === valor ? "selected" : ""}>${t}</option>`;
  editor(id ? "Editar evento" : "Nuevo evento", `
    ${campo("Nombre del evento", "nombre", e.nombre, "text", 'required maxlength="40" placeholder="Ej. Martes de arepas"')}
    ${campo("Texto para el cliente (opcional)", "texto", e.texto, "text", 'maxlength="90" placeholder="Ej. Todas las arepas con descuento"')}
    <div class="dos-col">
      <label>Aplica a<select name="objetivo" required><option value="" disabled ${valor ? "" : "selected"}>Elige un producto o una categoría</option>
        <optgroup label="Categoría completa">${combos().length ? opt("categoria:combos", "🍱 Combos") : ""}${CATEGORIAS.map((c) => opt(`categoria:${c.id}`, `${esc(c.emoji)} ${esc(c.nombre)}`)).join("")}</optgroup>
        <optgroup label="Un producto">${PRODUCTOS.map((p) => opt(`producto:${p.id}`, `${esCombo(p) ? "🍱 " : ""}${esc(p.nombre)}`)).join("")}</optgroup></select></label>
      ${campo("Descuento (%)", "porcentaje", e.porcentaje, "number", 'required min="1" max="90" step="1" inputmode="numeric"')}</div>
    <div class="dos-col">${campo("Empieza (opcional)", "desde", aLocal(e.desde), "datetime-local")}${campo("Termina (opcional)", "hasta", aLocal(e.hasta), "datetime-local")}</div>
    <label class="chk"><input type="checkbox" name="activo" ${e.activo ? "checked" : ""}> Encendido</label>
    <p class="nota">Un evento encendido aplica su descuento y aparece en el inicio del cliente. Si le pones fechas, solo funciona dentro de ese rango: se activa y se apaga solo. Si a un producto le aplican varios eventos, gana el mayor descuento.</p>`,
  async (fd) => {
    const [tipo, oid] = fd.get("objetivo").split(":"), desde = aISO(fd.get("desde")), hasta = aISO(fd.get("hasta"));
    if (desde && hasta && hasta <= desde) return "La fecha de fin debe ser posterior a la de inicio.";
    const datos = { nombre: fd.get("nombre").trim(), texto: fd.get("texto").trim(), porcentaje: +fd.get("porcentaje"), objetivo: { tipo, id: tipo === "producto" ? +oid : oid }, activo: !!fd.get("activo"), desde, hasta };
    if (id) await updateDoc(doc(db, "eventos", id), datos);
    else await setDoc(doc(collection(db, "eventos")), { ...datos, creado: new Date().toISOString() });
    return true;
  });
}

export default {
  id: "eventos", icono: "🎉", titulo: "Eventos",
  contador: () => EVENTOS.filter((e) => estadoEvento(e) === "vigente").length,
  render() {
    const l = EVENTOS.filter((e) => coincide(e.nombre, objetivoDe(e)?.nombre));
    const filas = l.map((e) => { const [c, t] = ESTADO[estadoEvento(e)];
      return `<tr class="${e.activo ? "" : "bloq"}"><td><button class="interruptor" data-a="alternar" data-id="${e.id}" role="switch" aria-checked="${!!e.activo}" aria-label="${e.activo ? "Apagar" : "Encender"} ${esc(e.nombre)}"><i></i></button></td><td><b>${esc(e.nombre)}</b>${e.texto ? `<small class="sub-texto">${esc(e.texto)}</small>` : ""}</td><td>${textoObjetivo(e)}</td><td><b class="disp">-${e.porcentaje}%</b></td><td>${vigencia(e)}</td><td><span class="est ${c}">${t}</span></td><td class="acc"><button data-a="editar" data-id="${e.id}">Editar</button><button class="peli" data-a="eliminar" data-id="${e.id}">Eliminar</button></td></tr>`; });
    return `<section class="caja"><div class="cab"><h2>Eventos (${EVENTOS.length})</h2><button class="btn" data-a="nuevo">＋ Nuevo evento</button></div>
      ${tabla(["", "Evento", "Aplica a", "Descuento", "Vigencia", "Estado", "Acciones"], filas, "Aún no hay eventos. Crea uno para ofrecer descuentos en un producto o en toda una categoría.")}
      <p class="nota">FoW Prime no es un evento: su descuento es una regla global que se configura en Configuración y se aplica además de los eventos.</p></section>`;
  },
  acciones: {
    nuevo: () => PRODUCTOS.length ? editar(null) : aviso("Primero crea productos o categorías."),
    editar: (d) => editar(d.id),
    alternar: (d) => { const e = EVENTOS.find((x) => x.id === d.id); updateDoc(doc(db, "eventos", e.id), { activo: !e.activo }).then(() => aviso(e.activo ? "Evento apagado" : "Evento encendido"), fallo); },
    eliminar: (d) => { const e = EVENTOS.find((x) => x.id === d.id); if (confirm(`¿Eliminar el evento «${e.nombre}»?`)) deleteDoc(doc(db, "eventos", e.id)).then(() => aviso("Evento eliminado"), fallo); }
  }
};
