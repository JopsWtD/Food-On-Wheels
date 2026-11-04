// Conexión a Firebase. Todas las demás partes importan las funciones desde aquí.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export * from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
export * from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Cliente y admin usan "apps" con nombre distinto: así cada uno tiene su propia sesión
// aunque estén abiertos en el mismo navegador (si no, entrar como admin cerraría la del cliente).
export function conectar(nombre) {
  const app = initializeApp(firebaseConfig, nombre);
  return { db: getFirestore(app), auth: getAuth(app) };
}

// Traduce los errores de Firebase Authentication al español.
export function errorAuth(e) {
  return ({
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/wrong-password": "Correo o contraseña incorrectos.",
    "auth/user-not-found": "Correo o contraseña incorrectos.",
    "auth/invalid-email": "El correo no es válido.",
    "auth/email-already-in-use": "Ese correo ya tiene una cuenta. Inicia sesión.",
    "auth/weak-password": "La contraseña debe tener mínimo 6 caracteres.",
    "auth/too-many-requests": "Demasiados intentos. Espera un momento.",
    "auth/network-request-failed": "Sin conexión a internet.",
    "auth/requires-recent-login": "Por seguridad, cierra sesión y vuelve a entrar para cambiar la contraseña."
  })[e?.code] || "Ocurrió un error. Intenta de nuevo.";
}
