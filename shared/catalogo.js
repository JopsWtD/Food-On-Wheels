// Catálogo en vivo: productos, combos, categorías, inventario y configuración de la tienda.
// Las variables "export let" son enlaces vivos: quien las importa siempre ve el valor actual.
import { collection, doc, onSnapshot } from "./firebase.js";
import { eventoVigente, estadoEvento, aplicarDescuento } from "./dominio.js";

/* ===== DATOS BASE (se suben una sola vez, la primera vez que entra un admin) =====
   Los productos, combos y categorías NO están en el código: se crean desde el panel admin. */
// [insumo, unidad, stock inicial, mínimo]
export const INSUMOS = [["Arroz","kg",40,15],["Frijol","kg",18,10],["Carne de res","kg",25,12],["Carne de cerdo","kg",20,10],["Pollo","kg",30,12],["Plátano maduro","und",60,30],["Plátano verde","und",50,25],["Huevos","und",120,60],["Aguacate","und",35,20],["Harina de maíz","kg",22,8],["Papa","kg",45,20],["Yuca","kg",9,10],["Queso","kg",12,6],["Limón","kg",8,5],["Coco","und",14,10],["Lulo","kg",6,6],["Panela","kg",10,4],["Aceite","L",16,8]];
export const BANNER_BASE = { etiqueta: "Cocina colombiana", titulo: "Un pedacito de Colombia en cada bocado.", texto: "Sabores que saben a casa. Elige tus favoritos y pide para recoger o recibir en tu puerta.", boton: "Explorar el menú", emoji: "🍛", imagen: "" };
export const TIENDA_BASE = { nombre: "Food on Wheels", nit: "", direccion: "", telefono: "", costoEnvio: 5000, primeDescuento: 25 };
export const inventarioBase = () => INSUMOS.map(([n, u, s, m]) => ({ n, u, s, m }));

/* ===== ESTADO EN VIVO ===== */
export let PRODUCTOS = [];     // productos y combos
export let RECETAS = {};       // id → [[insumo | "@idProducto", cantidad]]
export let CATEGORIAS = [];    // [{ id, nombre, emoji, orden, visible }] ordenadas
export let INVENTARIO = inventarioBase(); // [{ _id, n, u, s, m }]
export let EVENTOS = [];       // [{ id, nombre, texto, porcentaje, objetivo: {tipo, id}, activo, desde, hasta }]
export let BANNER = BANNER_BASE;
export let TIENDA = TIENDA_BASE;
export let POPULARIDAD = {};   // id → unidades entregadas (stats/popularidad)

// Firestore no admite arrays dentro de arrays: la receta se guarda como [{k, c}]
export const recetaADoc = (r = []) => r.map(([k, c]) => ({ k, c }));
const recetaDeDoc = (r = []) => r.map(({ k, c }) => [k, c]);

/* ===== COMBOS =====
   Un combo es un producto con tipo "combo" e incluye: [{id, cant}] (solo productos).
   Internamente su receta es [["@id", cant]], así el stock se calcula a través de sus productos. */
export const esCombo = (p) => p?.tipo === "combo";
export const incluyeDe = (p) => p.incluye || (p.receta || []).filter(({ k }) => String(k).startsWith("@")).map(({ k, c }) => ({ id: +k.slice(1), cant: c }));
export const comboADoc = (p, incluye) => ({ ...p, tipo: "combo", incluye });
export const combosQueUsan = (id) => PRODUCTOS.filter((p) => esCombo(p) && p.incluye.some((i) => i.id === id));
export const producto = (id) => PRODUCTOS.find((p) => p.id == id);

/* ===== DESCUENTOS POR EVENTOS =====
   Si a un producto le aplican varios eventos (el suyo y el de su categoría), gana el mayor descuento. */
const apuntaA = (e, p) => e.objetivo?.tipo === "producto" ? e.objetivo.id == p.id
  : e.objetivo?.id === "combos" ? esCombo(p) : !esCombo(p) && categoriaDe(p)?.id === e.objetivo?.id;
export function descuentoDe(p, ahora = Date.now()) {
  return EVENTOS.filter((e) => eventoVigente(e, ahora) && apuntaA(e, p)).sort((a, b) => b.porcentaje - a.porcentaje)[0] || null;
}
export const precioFinal = (p) => aplicarDescuento(p.precio, descuentoDe(p)?.porcentaje);
export const precioDe = (id) => { const p = producto(id); return p ? precioFinal(p) : null; };
export const eventosVigentes = () => EVENTOS.filter((e) => eventoVigente(e));
// Nombre de lo que afecta un evento ("Bandeja paisa", "Bebidas", "Combos")
export const objetivoDe = (e) => e.objetivo?.tipo === "producto" ? producto(e.objetivo.id)
  : e.objetivo?.id === "combos" ? { id: "combos", nombre: "Combos", emoji: "🍱" } : CATEGORIAS.find((c) => c.id === e.objetivo?.id);
export const sumaSeparado = (incluye) => incluye.reduce((s, i) => { const p = producto(i.id); return s + (p ? precioFinal(p) * i.cant : 0); }, 0);

/* ===== CATEGORÍAS =====
   Los productos guardan categoriaId. Los creados antes de existir las categorías guardaban el nombre
   en "categoria": mientras el admin no los migre, se agrupan por ese nombre. */
export function categoriaDe(p) {
  return CATEGORIAS.find((c) => c.id === p.categoriaId) || CATEGORIAS.find((c) => c.nombre === p.categoria)
    || (p.categoria ? { id: "nombre:" + p.categoria, nombre: p.categoria, emoji: "🍽️", orden: 999, visible: true } : null);
}
export function categoriasVisibles() {
  const usadas = new Map();
  PRODUCTOS.filter((p) => !esCombo(p)).forEach((p) => { const c = categoriaDe(p); if (c && c.visible !== false) usadas.set(c.id, c); });
  return [...usadas.values()].sort((a, b) => (a.orden ?? 999) - (b.orden ?? 999) || a.nombre.localeCompare(b.nombre));
}
export const productosDeCategoria = (id) => PRODUCTOS.filter((p) => !esCombo(p) && categoriaDe(p)?.id === id);
export const combos = () => PRODUCTOS.filter(esCombo);
export const masPedidos = (n = 8) => PRODUCTOS.filter((p) => (POPULARIDAD[p.id] || 0) > 0).sort((a, b) => POPULARIDAD[b.id] - POPULARIDAD[a.id]).slice(0, n);

/* ===== ESCUCHA EN TIEMPO REAL ===== */
export function escucharCatalogo(db, alCambiar) {
  onSnapshot(collection(db, "productos"), (snap) => {
    const lista = snap.docs.map((d) => d.data()).sort((a, b) => a.id - b.id)
      .map((p) => p.tipo === "combo" || p.categoria === "Combos" ? { ...p, tipo: "combo", incluye: incluyeDe(p) } : p);
    RECETAS = Object.fromEntries(lista.map((p) => [p.id, esCombo(p) ? p.incluye.map((i) => ["@" + i.id, i.cant]) : recetaDeDoc(p.receta)]).filter(([, r]) => r.length));
    PRODUCTOS = lista.map(({ receta, ...p }) => p);
    alCambiar("productos");
  });
  onSnapshot(collection(db, "categorias"), (snap) => {
    CATEGORIAS = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    alCambiar("categorias");
  });
  onSnapshot(collection(db, "inventario"), (snap) => {
    INVENTARIO = snap.empty ? inventarioBase() : snap.docs.map((d) => ({ _id: d.id, ...d.data() })).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || a.n.localeCompare(b.n));
    alCambiar("inventario");
  });
  onSnapshot(doc(db, "config", "banner"), (d) => { BANNER = { ...BANNER_BASE, ...(d.data() || {}) }; alCambiar("banner"); });
  onSnapshot(collection(db, "eventos"), (snap) => {
    EVENTOS = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.creado || "").localeCompare(a.creado || ""));
    alCambiar("eventos"); programarCambioDeEventos(alCambiar);
  });
  onSnapshot(doc(db, "config", "tienda"), (d) => { TIENDA = { ...TIENDA_BASE, ...(d.data() || {}) }; alCambiar("tienda"); });
  onSnapshot(doc(db, "stats", "popularidad"), (d) => { POPULARIDAD = d.data()?.vendidos || {}; alCambiar("popularidad"); });
}

// Cuando un evento empieza o termina por fecha, avisa en ese momento para que los precios se actualicen solos
let temporizador;
function programarCambioDeEventos(alCambiar) {
  clearTimeout(temporizador);
  const ahora = Date.now(), proximos = EVENTOS.flatMap((e) => [e.desde, e.hasta]).filter(Boolean).map(Date.parse).filter((t) => t > ahora);
  if (!proximos.length) return;
  const espera = Math.min(...proximos) - ahora + 500;
  if (espera < 2 ** 31 - 1) temporizador = setTimeout(() => { alCambiar("eventos"); programarCambioDeEventos(alCambiar); }, espera);
}
export { estadoEvento };

/* ===== STOCK (calculado con las recetas y el inventario de insumos) ===== */
export function necesidades(items) { // items: [{id, cant}] → { insumo: cantidad total }
  const t = {};
  const sumar = (id, veces, d = 0) => d < 6 && (RECETAS[id] || []).forEach(([k, c]) => k[0] === "@" ? sumar(+k.slice(1), c * veces, d + 1) : (t[k] = (t[k] || 0) + c * veces));
  items.forEach((i) => sumar(i.id, i.cant));
  return t;
}
export function faltantes(items, inv = INVENTARIO) {
  const t = necesidades(items);
  return Object.keys(t).filter((k) => { const x = inv.find((i) => i.n === k); return !x || x.s < t[k] - 1e-9; });
}
export const agotado = (p, inv = INVENTARIO) => faltantes([{ id: p.id, cant: 1 }], inv).length > 0;
// Unidades que se pueden preparar (null = sin receta, no se controla el stock)
export function disponibles(id, inv = INVENTARIO) {
  const t = necesidades([{ id, cant: 1 }]), ks = Object.keys(t);
  if (!ks.length) return null;
  return Math.min(...ks.map((k) => { const x = inv.find((i) => i.n === k); return x ? Math.floor(x.s / t[k] + 1e-9) : 0; }));
}
