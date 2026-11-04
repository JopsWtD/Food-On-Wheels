// Catálogo compartido por cliente y admin: datos base + lectura en vivo desde Firestore.
import { collection, doc, onSnapshot } from "./firebase.js";

// Los productos y combos NO están en el código: se crean desde el panel admin y viven en Firestore.
// Estos datos base (promociones, insumos, banner y puntos de venta) se suben la primera vez que entra un admin.
export const PROMOCIONES_BASE = [
  { titulo: "Martes de arepas",   texto: "20% menos en la arepa rellena.",           filtro: "Entradas" },
  { titulo: "Combos en familia",  texto: "Hasta 15% menos en combos seleccionados.", filtro: "Combos" },
  { titulo: "FoW Prime",          texto: "25% de descuento en todas tus compras.",   filtro: "prime" }
];

/* ===== INSUMOS DEL INVENTARIO ===== */
// [insumo, unidad, stock inicial, mínimo]
export const INSUMOS = [["Arroz","kg",40,15],["Frijol","kg",18,10],["Carne de res","kg",25,12],["Carne de cerdo","kg",20,10],["Pollo","kg",30,12],["Plátano maduro","und",60,30],["Plátano verde","und",50,25],["Huevos","und",120,60],["Aguacate","und",35,20],["Harina de maíz","kg",22,8],["Papa","kg",45,20],["Yuca","kg",9,10],["Queso","kg",12,6],["Limón","kg",8,5],["Coco","und",14,10],["Lulo","kg",6,6],["Panela","kg",10,4],["Aceite","L",16,8]];
export const BANNER_BASE = { etiqueta: "Cocina colombiana", titulo: "Un pedacito de Colombia en cada bocado.", texto: "Sabores que saben a casa. Elige tus favoritos y pide para recoger o recibir en tu puerta.", boton: "Explorar el menú", emoji: "🍛", imagen: "" };
export const PUNTOS_BASE = [{ id: 1, nombre: "Sede Principal", dir: "Cll 72 # 12-34", activo: true }, { id: 2, nombre: "Centro Comercial", dir: "Local 214", activo: true }, { id: 3, nombre: "Zona Norte", dir: "Av. 5 # 30-10", activo: true }, { id: 4, nombre: "Domicilio", dir: "Cobertura 8 km", activo: true }];
export const inventarioBase = () => INSUMOS.map(([n, u, s, m]) => ({ n, u, s, m }));

/* ===== ESTADOS DE UN PEDIDO =====
   Recoger en el local no tiene "en camino". Cliente y admin usan esta misma lista. */
export const PASOS = {
  domicilio: ["pendiente", "en preparación", "listo", "en camino", "entregado"],
  recoger: ["pendiente", "en preparación", "listo", "entregado"]
};
export const pasosDe = (entrega) => PASOS[entrega] || PASOS.domicilio;

/* ===== ESTADO EN VIVO =====
   Estas variables se actualizan solas con onSnapshot. Quien las importa siempre ve el valor actual
   (los "export let" de los módulos son enlaces vivos). Mientras no haya datos en Firestore se usan los valores base. */
export let PRODUCTOS = [];
export let RECETAS = {};
export let PROMOCIONES = PROMOCIONES_BASE;
export let BANNER = BANNER_BASE;
export let INVENTARIO = inventarioBase(); // [{ _id, n, u, s, m }]

// Firestore no admite arrays dentro de arrays, así que la receta se guarda como [{k, c}]
// y aquí se convierte de vuelta a [[k, c]] para que el resto del código no cambie.
export const recetaADoc = (r = []) => r.map(([k, c]) => ({ k, c }));
const recetaDeDoc = (r = []) => r.map(({ k, c }) => [k, c]);

/* ===== COMBOS =====
   Un combo es un documento de "productos" con tipo: "combo" e incluye: [{id, cant}] (solo productos, no insumos).
   Internamente su receta es [["@id", cant]], así necesidades() calcula sus insumos a través de los productos. */
export const esCombo = (p) => p?.tipo === "combo";
// Combos guardados con el formato anterior (categoría "Combos" + receta con "@id")
export const incluyeDe = (p) => p.incluye || (p.receta || []).filter(({ k }) => String(k).startsWith("@")).map(({ k, c }) => ({ id: +k.slice(1), cant: c }));
export const comboADoc = (p, incluye) => ({ ...p, tipo: "combo", categoria: "Combos", incluye, descuento: 0 });
export const combosQueUsan = (id) => PRODUCTOS.filter((p) => esCombo(p) && p.incluye.some((i) => i.id === id));

export function escucharCatalogo(db, alCambiar) {
  onSnapshot(collection(db, "productos"), (snap) => {
    if (snap.empty) { PRODUCTOS = []; RECETAS = {}; }
    else {
      const lista = snap.docs.map((d) => d.data()).sort((a, b) => a.id - b.id)
        .map((p) => p.tipo === "combo" || p.categoria === "Combos" ? { ...p, tipo: "combo", incluye: incluyeDe(p), receta: undefined } : p);
      RECETAS = Object.fromEntries(lista.map((p) => [p.id, esCombo(p) ? p.incluye.map((i) => ["@" + i.id, i.cant]) : recetaDeDoc(p.receta)]).filter(([, r]) => r.length));
      PRODUCTOS = lista.map(({ receta, ...p }) => p);
    }
    alCambiar("productos");
  });
  onSnapshot(collection(db, "inventario"), (snap) => {
    INVENTARIO = snap.empty ? inventarioBase() : snap.docs.map((d) => ({ _id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.n.localeCompare(b.n));
    alCambiar("inventario");
  });
  onSnapshot(doc(db, "config", "banner"), (d) => { BANNER = { ...BANNER_BASE, ...(d.data() || {}) }; alCambiar("banner"); });
  onSnapshot(doc(db, "config", "promos"), (d) => { PROMOCIONES = d.exists() ? d.data().lista : PROMOCIONES_BASE; alCambiar("promos"); });
}

/* ===== CÁLCULOS DE INVENTARIO (sin cambios) ===== */
export function necesidades(items) { // items: [{id, cant}] → { insumo: cantidad total }
  const t = {};
  const sumar = (id, veces, d = 0) => d < 6 && (RECETAS[id] || []).forEach(([k, c]) => k[0] === "@" ? sumar(+k.slice(1), c * veces, d + 1) : (t[k] = (t[k] || 0) + c * veces));
  items.forEach((i) => sumar(i.id, i.cant));
  return t;
}
export function faltantes(items, inv = INVENTARIO) { // insumos que no alcanzan para esos items
  const t = necesidades(items);
  return Object.keys(t).filter((k) => { const x = inv.find((i) => i.n === k); return !x || x.s < t[k] - 1e-9; });
}
export const agotado = (p, inv = INVENTARIO) => faltantes([{ id: p.id, cant: 1 }], inv).length > 0;
// Cuántas unidades se pueden preparar con el inventario actual (null = sin receta, no se controla)
export function disponibles(id, inv = INVENTARIO) {
  const t = necesidades([{ id, cant: 1 }]), ks = Object.keys(t);
  if (!ks.length) return null;
  return Math.min(...ks.map((k) => { const x = inv.find((i) => i.n === k); return x ? Math.floor(x.s / t[k] + 1e-9) : 0; }));
}

/* ===== PEDIDOS ===== */
// Código visible del pedido. Los nuevos usan un consecutivo (#FOW-0001); los antiguos usaban la hora.
export const codigoPedido = (id) => "#FOW-" + (id > 99999 ? String(id).slice(-4) : String(id).padStart(4, "0"));
export const ordenFecha = (a, b) => new Date(a.fecha) - new Date(b.fecha);
export const VENTANA_RECLAMO = 24 * 3600 * 1000; // 24 horas después de entregado
export const precioFinal = (p) => p.descuento ? p.precio * (1 - p.descuento / 100) : p.precio;