# Food on Wheels (FoW)

Web de restaurante con dos interfaces en HTML, CSS y JavaScript puro (sin compilación), conectadas a **Firebase**: Authentication para las cuentas y Cloud Firestore para los datos. Todo se sincroniza en tiempo real entre dispositivos.

## Estructura

```
shared/                  código común a cliente y admin
├── firebase.js          conexión y traducción de errores
├── firebase-config.js   configuración de tu proyecto (ver «Configurar Firebase»)
├── util.js              utilidades de interfaz: escape de HTML, formato de dinero y fechas, imágenes
├── dominio.js           reglas de negocio puras: estados del pedido, precios, totales, reclamos
├── catalogo.js          catálogo en vivo: productos, combos, categorías, inventario, tienda, stock
└── pedidos.js           crear pedidos con número consecutivo y generar la factura imprimible

cliente/js/
├── app.js               punto de entrada: arranca los módulos y escucha el catálogo
├── estado.js            estado compartido y bus de eventos (en / emitir)
├── ui.js                avisos, ventana genérica, acceso y paneles laterales
├── menu.js              inicio por secciones, «Ver todo», búsqueda, promociones y banner
├── detalle.js           hoja de detalle del producto (cantidad y nota para la cocina)
├── carrito.js           carrito y envío del pedido
├── pedidos.js           mis pedidos: seguimiento, cancelar, reclamar, volver a pedir, factura
└── cuenta.js            sesión, registro, perfil y FoW Prime

admin/js/
├── app.js               núcleo: sesión, datos en vivo, navegación y reparto de eventos
├── estado.js            estado compartido del panel
├── ui.js                piezas de interfaz (tablas, indicadores, editor, imágenes)
├── servicios.js         operaciones delicadas: cambio de estado, productos, migraciones
└── vistas/              una sección por archivo (pedidos, productos, combos, categorías…)
```

**Agregar una sección al admin:** crea `admin/js/vistas/mi-seccion.js` exportando `{ id, icono, titulo, render(), acciones }`, impórtala en `admin/js/app.js` y agrégala a `VISTAS`. Cada botón con `data-a="nombre"` ejecuta `acciones.nombre(dataset, boton)` de la sección activa.

## Configurar Firebase (una sola vez)
1. Crea un proyecto en https://console.firebase.google.com (plan Spark, gratis).
2. **Authentication** → habilita **Correo electrónico/contraseña**.
3. **Firestore Database** → crea la base de datos (p. ej. `southamerica-east1`) en modo producción.
4. Firestore → pestaña **Reglas** → pega `firestore.rules` → Publicar. *(Vuelve a publicarlas cada vez que cambien.)*
5. Configuración del proyecto → App web (`</>`) → copia `firebaseConfig` en `shared/firebase-config.js`.
6. Crea el administrador: Authentication → Agregar usuario → copia su UID → en Firestore crea la colección `admins`, documento con ID = ese UID y campo `nombre`.
7. Entra al panel admin: carga la configuración inicial. Luego crea las **Categorías**, después los **Productos** y por último los **Combos**.
8. En **Configuración** completa los datos del negocio (salen en las facturas), el costo del domicilio y el descuento Prime.

Abre la carpeta en VS Code y usa Live Server (los archivos son módulos: no funcionan con doble clic).

## Colecciones de Firestore
| Colección / documento | Qué guarda |
|---|---|
| `usuarios/{uid}` | datos del cliente, Prime, bloqueo y carrito |
| `admins/{uid}` | quién es administrador (se crea a mano) |
| `categorias/{id}` | nombre, emoji, orden y visibilidad de cada sección del menú |
| `productos/{id}` | productos (con receta de insumos y `categoriaId`) y combos (`tipo: "combo"`, `incluye`, precio fijo); llevan la miniatura de la imagen |
| `imagenes/{id}` | imagen grande del producto (se descarga solo al abrir el detalle) |
| `inventario/{id}` | insumos con stock y mínimo |
| `pedidos/{n}` | pedidos con estado, hora de cada estado, notas por producto y envío |
| `contadores/pedidos` | último número de pedido (#FOW-0001…) |
| `reclamos/{n}` | reclamos con foto; el cliente elige reembolso o reenvío |
| `stats/popularidad` | unidades entregadas por producto («Los más pedidos») |
| `config/tienda` | datos del negocio, costo del domicilio y % de Prime |
| `config/banner`, `config/promos` | apariencia del inicio |
| `historial`, `membresias` | movimientos de inventario y membresías vendidas |

## Reglas de negocio
- **Pedidos:** el admin solo avanza al paso siguiente o cancela con motivo; un pedido entregado o cancelado ya no cambia. El cliente puede cancelar mientras está pendiente.
- **Inventario:** se descuenta al empezar a preparar y se devuelve al cancelar (en una transacción). Si no alcanza, el pedido no avanza.
- **Combos:** se arman con productos y cantidades, tienen precio fijo y se agotan cuando alguno de sus productos no alcanza.
- **Reclamos:** hasta 24 horas después de la entrega, con foto. El reembolso se registra; el dinero se devuelve a mano.
- **Facturas:** una por pedido entregado, imprimible o guardable como PDF (admin y cliente).
- **Escalabilidad:** el admin carga solo los pedidos de los últimos 60 días (ampliable desde Facturas) para no agotar las lecturas del plan Spark.

## Limitaciones conocidas
- **Prime es de demostración:** no se cobra y un cliente con conocimientos técnicos podría activárselo. Cobrar de verdad requiere una pasarela de pagos y un backend (Cloud Functions, plan Blaze).
- **Precios calculados en el navegador:** el admin ve «⚠️ Revisar precios» si un pedido no cuadra con el catálogo, pero bloquearlo exige un backend.
