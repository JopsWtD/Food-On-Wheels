// Utilidades de interfaz compartidas por cliente y admin (sin dependencias de Firebase).
export const $ = (s, raiz = document) => raiz.querySelector(s);
export const $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];

// Escapa texto antes de insertarlo como HTML. Evita XSS: que un nombre como "<img onerror=...>" se ejecute.
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const dinero = (n) => "$" + Math.round(n || 0).toLocaleString("es-CO");
export const hora = (f) => new Date(f).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit" });
export const fechaHora = (f) => new Date(f).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" });
export const fecha = (f) => new Date(f).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
export const haceDias = (n) => new Date(Date.now() - n * 864e5).toISOString();

// Reinicia una animación CSS de una clase (para "rebotes" al agregar al carrito, etc.)
export function animar(el, clase) { if (!el) return; el.classList.remove(clase); void el.offsetWidth; el.classList.add(clase); }

/* ===== IMÁGENES =====
   Plan Spark: no hay Storage, así que las imágenes se guardan como texto (data URL) en Firestore.
   - miniatura (~15-30 KB): va dentro del producto y se descarga con el menú
   - grande (~100-300 KB): va en imagenes/{id} y solo se descarga al abrir el detalle */
export const IMG = { MINI: 360, GRANDE: 1100, MAX: 700000 };
export const redimensionar = (file, max, calidad = .78) => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => {
    const im = new Image();
    im.onload = () => {
      const k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement("canvas");
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      ok(c.toDataURL("image/jpeg", calidad));
    };
    im.onerror = no; im.src = r.result;
  };
  r.onerror = no; r.readAsDataURL(file);
});
