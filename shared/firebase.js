// Conexión a Firebase. Todas las demás partes importan las funciones desde aquí.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export * from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
export * from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Cliente y admin usan "apps" con nombre distinto: así cada uno tiene su propia sesión
// aunque estén abiertos en el mismo navegador (si no, entrar como admin cerraría la del cliente).
// Con caché local: Firestore guarda una copia de los datos en el navegador (IndexedDB), así las visitas
// siguientes muestran todo al instante y luego se actualizan con el servidor. Funciona con varias pestañas.
export function conectar(nombre) {
  const app = initializeApp(firebaseConfig, nombre);
  let db;
  try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch { db = getFirestore(app); } // navegador sin IndexedDB (p. ej. algunos modos privados): sin caché
  return { db, auth: getAuth(app) };
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
