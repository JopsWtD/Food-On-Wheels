// Reglas de negocio puras: no leen ni escriben en Firebase, solo calculan.
// Cliente y admin las comparten, así una regla se cambia en un solo lugar.

/* ===== ESTADOS DE UN PEDIDO ===== */
export const PASOS = {
  domicilio: ["pendiente", "en preparación", "listo", "en camino", "entregado"],
  recoger: ["pendiente", "en preparación", "listo", "entregado"]
};
export const ESTADOS = ["pendiente", "en preparación", "listo", "en camino", "entregado", "cancelado"];
export const FINALES = ["entregado", "cancelado"];
export const pasosDe = (entrega) => PASOS[entrega] || PASOS.domicilio;
export const terminado = (p) => FINALES.includes(p.estado);
// Siguiente paso (null si ya terminó). Un estado antiguo que no aplica (p. ej. "en camino" al recoger) pasa a entregado.
export function siguiente(p) {
  if (terminado(p)) return null;
  const pasos = pasosDe(p.entrega), i = pasos.indexOf(p.estado);
  return i >= 0 ? pasos[i + 1] : "entregado";
}
// Nombre de cada estado para el cliente y para el admin
const CLIENTE = { pendiente: "Recibido", "en preparación": "Cocinando", listo: "Listo", "en camino": "En camino", entregado: "Entregado", cancelado: "Cancelado" };
const CLIENTE_RECOGER = { listo: "Listo para recoger", entregado: "Recogido" };
export const etiquetaCliente = (p, e = p.estado) => (p.entrega === "recoger" && CLIENTE_RECOGER[e]) || CLIENTE[e];
export const etiquetaAdmin = (p, e = p.estado) => p.entrega === "recoger" ? ({ listo: "listo para recoger", entregado: "recogido" }[e] || e) : e;
const ACCION = { "en preparación": "Empezar a preparar", listo: "Marcar listo", "en camino": "Enviar", entregado: "Marcar entregado" };
export const textoAccion = (p, e) => p.entrega === "recoger" ? ({ listo: "Listo para recoger", entregado: "Marcar recogido" }[e] || ACCION[e]) : ACCION[e];

/* ===== CÓDIGOS ===== */
// Los pedidos nuevos usan un consecutivo (#FOW-0001); los muy antiguos usaban la hora como id.
const numero = (id) => id > 99999 ? String(id).slice(-4) : String(id).padStart(4, "0");
export const codigoPedido = (id) => "#FOW-" + numero(id);
export const codigoFactura = (id) => "FAC-" + numero(id);
export const ordenFecha = (a, b) => new Date(a.fecha) - new Date(b.fecha);

/* ===== RECLAMOS ===== */
export const VENTANA_RECLAMO = 24 * 3600 * 1000; // se puede reclamar hasta 24 h después de entregado
export const MOTIVOS_RECLAMO = { equivocado: "Recibí un pedido equivocado", falto: "Faltó algo", estado: "Llegó en mal estado", otro: "Otro" };
export const puedeReclamar = (p) => p.estado === "entregado" && !!p.tiempos?.entregado && Date.now() - p.tiempos.entregado < VENTANA_RECLAMO;

/* ===== EVENTOS (descuentos) =====
   Un evento aplica un % de descuento a un producto o a una categoría completa.
   Está vigente si el admin lo tiene encendido y, si tiene fechas, la hora actual está dentro del rango. */
export function estadoEvento(e, ahora = Date.now()) {
  if (!e.activo) return "apagado";
  if (e.desde && ahora < Date.parse(e.desde)) return "programado";
  if (e.hasta && ahora >= Date.parse(e.hasta)) return "vencido";
  return "vigente";
}
export const eventoVigente = (e, ahora) => estadoEvento(e, ahora) === "vigente";
export const aplicarDescuento = (precio, pct) => Math.round(precio * (1 - (pct || 0) / 100));

/* ===== TOTALES =====
   precioDe(id) devuelve el precio unitario final (ya con el descuento del evento). tienda = { primeDescuento, costoEnvio }.
   Prime se aplica sobre el subtotal, después de los descuentos de los eventos (se acumulan). */
export function calcularTotales(items, precioDe, { prime = false, entrega = "domicilio", tienda }) {
  const sub = items.reduce((s, i) => s + (precioDe(i.id) ?? 0) * i.cant, 0);
  const descPrime = prime ? sub * (tienda.primeDescuento || 0) / 100 : 0;
  const envio = entrega === "domicilio" && sub > 0 ? (tienda.costoEnvio || 0) : 0;
  return { sub, prime: descPrime, envio, total: sub - descPrime + envio };
}
