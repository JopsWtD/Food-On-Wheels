// Piezas de interfaz reutilizables del panel admin.
import { $, esc, IMG, redimensionar } from "../../shared/util.js";
import { ESTADOS, etiquetaAdmin } from "../../shared/dominio.js";

export function aviso(m) { const a = $("#aviso"); a.textContent = m; a.classList.add("ver"); clearTimeout(aviso.t); aviso.t = setTimeout(() => a.classList.remove("ver"), 2400); }
export const fallo = () => aviso("No se pudo guardar. Revisa tu conexión o tus permisos.");

export const kpi = (ico, color, titulo, valor, prefijo = "") => `<article class="kpi"><span class="ico ${color}">${ico}</span><div><p>${titulo}</p><b data-n="${valor}" data-f="${prefijo}">0</b></div></article>`;
export const tabla = (cab, filas, vacio = "Sin resultados") => `<div class="tabla"><table><thead><tr>${cab.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${filas.join("") || `<tr><td colspan="${cab.length}" class="vacio">${vacio}</td></tr>`}</tbody></table></div>`;
export const campo = (etiqueta, nombre, valor = "", tipo = "text", extra = "") => `<label>${etiqueta}<input name="${nombre}" type="${tipo}" value="${esc(valor)}" ${extra}></label>`;
export const chips = (opciones, actual, atributo) => `<div class="chips">${opciones.map(([v, t]) => `<button class="chip" data-a="${atributo}" data-v="${esc(v)}" aria-pressed="${v === actual}">${t}</button>`).join("")}</div>`;
export const mini = (p) => p.imagen ? `<img class="thumb" src="${p.imagen}" alt="">` : `<span class="em">${esc(p.emoji)}</span>`;
export const badge = (e, p) => `<span class="est e${ESTADOS.indexOf(e)}">${p ? etiquetaAdmin(p, e) : e}</span>`;
export const vacioCaja = (titulo, texto, boton = "") => `<section class="caja vacio-caja"><h2>${titulo}</h2><p>${texto}</p>${boton}</section>`;

// Ventana genérica de edición. guardar(FormData) devuelve true o un texto de error.
export function editor(titulo, html, guardar, textoBoton = "Guardar") {
  const f = $("#formDlg");
  f.innerHTML = `<h2>${titulo}</h2>${html}<p class="error" id="errDlg" role="alert"></p><div class="acciones"><button class="btn gris" type="button" data-x>Volver</button><button class="btn" type="submit">${textoBoton}</button></div>`;
  f.onsubmit = async (e) => {
    e.preventDefault(); const btn = f.querySelector("[type=submit]"); btn.disabled = true;
    let r; try { r = await guardar(new FormData(f)); } catch (err) { console.error(err); r = "No se pudo guardar. Revisa tu conexión."; }
    btn.disabled = false;
    if (r === true) { $("#dlg").close(); aviso("Listo"); } else $("#errDlg").textContent = r || "No se pudo guardar.";
  };
  $("#dlg").showModal();
}
export function mostrar(titulo, html) { // ventana solo de lectura (p. ej. una foto)
  const f = $("#formDlg");
  f.innerHTML = `<h2>${titulo}</h2>${html}<div class="acciones"><button class="btn gris" type="button" data-x>Cerrar</button></div>`;
  f.onsubmit = (e) => e.preventDefault();
  $("#dlg").showModal();
}

/* Imagen de producto: genera la miniatura (va en el producto) y la grande (va en imagenes/{id}) */
export const campoImagen = (e) => `<label>Imagen (opcional)<input type="file" name="img" accept="image/*"></label>${e.imagen ? `<img class="prev" src="${e.imagen}" alt=""><label class="chk"><input type="checkbox" name="quitar"> Quitar imagen actual</label>` : ""}`;
export async function leerImagen(fd, actual = "") {
  const f = fd.get("img");
  if (f && f.size) {
    const [mini, grande] = await Promise.all([redimensionar(f, IMG.MINI, .72), redimensionar(f, IMG.GRANDE, .8)]);
    if (grande.length > IMG.MAX) throw new Error("La imagen es muy pesada. Usa una más pequeña.");
    return { imagen: mini, grande };
  }
  return fd.get("quitar") ? { imagen: "", grande: null, quitar: true } : { imagen: actual, grande: null };
}

// Animación de los números de los indicadores
export function contarNumeros(raiz) {
  raiz.querySelectorAll("[data-n]").forEach((el) => {
    const n = +el.dataset.n, pre = el.dataset.f, t0 = performance.now();
    const paso = (t) => { const k = Math.min(1, (t - t0) / 700); el.textContent = (pre || "") + Math.round(n * (1 - Math.pow(1 - k, 3))).toLocaleString("es-CO"); if (k < 1) requestAnimationFrame(paso); };
    requestAnimationFrame(paso);
  });
}
