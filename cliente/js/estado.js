// Estado compartido de la web del cliente y un pequeño bus de eventos.
// Cada módulo se suscribe a lo que le interesa (en("carrito", fn)) y se redibuja solo.
import { conectar } from "../../shared/firebase.js";
import { producto } from "../../shared/catalogo.js";

export const { db, auth } = conectar("cliente");
export const S = {
  cliente: null,        // datos de usuarios/{uid} o null si es visitante
  carrito: [],          // [{ id, cant, nota }]
  pedidos: [], reclamos: {},
  chats: {},            // chats/{pedidoId} de mis pedidos: { ultimo, sinLeerCliente, … }
  catalogoListo: false,
  texto: "",            // búsqueda
  vista: { tipo: "inicio", cat: null } // "inicio" (secciones) o "categoria" (ver todo)
};
const oyentes = {};
export const en = (evento, fn) => (oyentes[evento] ||= []).push(fn);
export const emitir = (evento, dato) => (oyentes[evento] || []).forEach((fn) => fn(dato));

export const nombreDe = (id) => producto(id)?.nombre ?? "Producto";
export const primeActivo = () => !!S.cliente?.prime && (!S.cliente.vence || new Date(S.cliente.vence) > new Date());
export const bloqueado = () => !!S.cliente?.bloqueado;
export const AVISO_BLOQ = "Tu cuenta está bloqueada y no puede comprar. Contacta al restaurante.";
