import { esc, fecha } from "../../../shared/util.js";
import { doc, updateDoc } from "../../../shared/firebase.js";
import { S, db, coincide } from "../estado.js";
import { tabla, campo, editor, aviso, fallo } from "../ui.js";

function editar(uid) {
  const e = S.cuentas.find((x) => x.uid === uid);
  editor("Editar cliente", `${campo("Nombre", "nombre", e.nombre, "text", "required")}${campo("Teléfono", "telefono", e.telefono, "tel", 'required pattern="[0-9 ]{7,15}"')}${campo("Correo", "correo", e.correo, "email", "readonly")}${campo("Dirección", "direccion", e.direccion)}<p class="nota">La contraseña la cambia cada cliente desde su perfil.</p>`, async (fd) => {
    await updateDoc(doc(db, "usuarios", uid), { nombre: fd.get("nombre").trim(), telefono: fd.get("telefono").trim(), direccion: fd.get("direccion").trim() });
    return true;
  });
}
export default {
  id: "clientes", icono: "👥", titulo: "Clientes",
  render() {
    const c = S.cuentas.filter((x) => coincide(x.nombre, x.correo));
    return `<section class="caja"><div class="cab"><h2>Clientes (${c.length})</h2></div><p class="nota">Para impedir que un cliente compre, bloquéalo: conserva su historial de pedidos y facturas.</p>${tabla(["Nombre", "Correo", "Teléfono", `Pedidos (${S.diasPedidos} d)`, "Prime", "Estado", "Acciones"], c.map((x) => `<tr class="${x.bloqueado ? "bloq" : ""}"><td><b>${esc(x.nombre)}</b></td><td>${esc(x.correo)}</td><td>${esc(x.telefono)}</td><td>${S.pedidos.filter((p) => p.uid === x.uid).length}</td><td>${x.prime ? "👑 " + (x.vence ? "hasta " + fecha(x.vence) : "Sí") : "No"}</td><td>${x.bloqueado ? '<span class="est e5">Bloqueado</span>' : '<span class="est e3">Activo</span>'}</td><td class="acc"><button data-a="editar" data-c="${x.uid}">Editar</button><button data-a="bloquear" data-c="${x.uid}">${x.bloqueado ? "Desbloquear" : "Bloquear"}</button></td></tr>`), "Aún no hay clientes registrados.")}</section>`;
  },
  acciones: {
    editar: (d) => editar(d.c),
    bloquear: (d) => { const c = S.cuentas.find((x) => x.uid === d.c); updateDoc(doc(db, "usuarios", d.c), { bloqueado: !c.bloqueado }).then(() => aviso(!c.bloqueado ? "Cliente bloqueado: ya no puede comprar" : "Cliente desbloqueado"), fallo); }
  }
};
