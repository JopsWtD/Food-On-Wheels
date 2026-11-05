// Piezas compartidas por Productos y Combos
import { esc } from "../../../shared/util.js";
import { disponibles, POPULARIDAD } from "../../../shared/catalogo.js";

export const vendidos = (p) => POPULARIDAD[p.id] || 0;
export const dispTxt = (p) => { const d = disponibles(p.id); return d === null ? '<span title="Sin receta: no se controla el stock">—</span>' : `<b class="disp">${d}</b>`; };
export const estadoStock = (p) => { const d = disponibles(p.id); return d === 0 ? '<span class="est e5">Agotado</span>' : d !== null && d <= 3 ? `<span class="est e1">Quedan ${d}</span>` : '<span class="est e3">Disponible</span>'; };
export const emojiCampo = (v) => `<label>Emoji (si no hay imagen)<input name="emoji" value="${esc(v)}" maxlength="8"></label>`;
