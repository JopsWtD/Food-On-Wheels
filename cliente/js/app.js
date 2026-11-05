// Punto de entrada de la web del cliente: arranca cada módulo y conecta el catálogo en vivo.
import { $ } from "../../shared/util.js";
import { escucharCatalogo } from "../../shared/catalogo.js";
import { S, db, emitir } from "./estado.js";
import { aviso, panel } from "./ui.js";
import { iniciarCarrito, agregar } from "./carrito.js";
import { iniciarMenu } from "./menu.js";
import { iniciarDetalle } from "./detalle.js";
import { iniciarPedidos } from "./pedidos.js";
import { iniciarCuenta } from "./cuenta.js";
import { iniciarChat } from "./chat.js";

iniciarCarrito(); iniciarMenu(); iniciarDetalle(); iniciarPedidos(); iniciarChat(); iniciarCuenta();

// Catálogo en vivo: cualquier cambio del admin llega aquí desde Firestore, en cualquier dispositivo
const inicio = Date.now();
escucharCatalogo(db, (tipo) => {
  if (tipo === "productos" && !S.catalogoListo) { // quita la pantalla de carga cuando ya hay datos
    S.catalogoListo = true;
    setTimeout(() => $("#splash").classList.add("fuera"), Math.max(0, 450 - (Date.now() - inicio)));
  }
  emitir("catalogo", tipo);
});
setTimeout(() => $("#splash").classList.add("fuera"), 4000); // por si no hay conexión

/* Eventos generales */
document.addEventListener("click", (e) => {
  const t = e.target.closest("button, a"); if (!t) return;
  if (t.classList.contains("btn-anadir") && t.dataset.id && agregar(+t.dataset.id, 1)) aviso("Añadido al pedido");
  if (t.hasAttribute("data-cerrar")) t.closest("dialog").close();
  if (t.hasAttribute("data-ir-menu")) { panel(null, false); $("#menu").scrollIntoView({ behavior: "smooth" }); }
  if (t.dataset.ir && t.closest("dialog")) { t.closest("dialog").close(); $("#" + t.dataset.ir).showModal(); } // cambiar entre login y registro
});
document.addEventListener("click", (e) => { if (e.target.tagName === "DIALOG") e.target.close(); }); // clic en el fondo
$("#velo").onclick = () => panel(null, false);
addEventListener("keydown", (e) => { if (e.key === "Escape" && !document.querySelector("dialog[open]")) panel(null, false); });

// Barra superior y barra inferior del celular
function alDesplazar() {
  $(".top").classList.toggle("elevado", scrollY > 8);
  const enMenu = $("#menu").getBoundingClientRect().top < innerHeight * .45;
  $('.nav-movil a[href="#inicio"]').classList.toggle("activo", !enMenu);
  $('.nav-movil a[href="#menu"]').classList.toggle("activo", enMenu);
}
addEventListener("scroll", alDesplazar, { passive: true });
// Alto real del encabezado (cambia en el celular) para fijar la barra de categorías justo debajo
const medir = () => document.documentElement.style.setProperty("--alto-top", $(".top").offsetHeight + "px");
addEventListener("resize", medir); medir();
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add("visible"); io.unobserve(x.target); } }), { threshold: .05 });
  document.querySelectorAll(".promos,.menu,.prime").forEach((el) => { el.classList.add("reveal"); io.observe(el); });
}
