# Food on Wheels (FoW)

Web de restaurante con dos interfaces (HTML, CSS y JS puro) que comparten datos en **Firebase**: Authentication para las cuentas y Cloud Firestore para todo lo demás. Funciona entre dispositivos: un pedido o un carrito empezado en el computador se ve y se continúa en el celular.

```
food-on-wheels/
├── shared/            → código común a cliente y admin
│   ├── firebase-config.js   ← AQUÍ va la configuración de tu proyecto
│   ├── firebase.js          conexión y traducción de errores
│   └── catalogo.js          datos base, catálogo en vivo y cálculos de inventario
├── cliente/   → menú, carrito, seguimiento de pedidos, cuenta/perfil, compra de FoW Prime
├── admin/     → pedidos, productos y combos, inventario e historial, puntos de venta, clientes, banner y promos
└── firestore.rules    → reglas de seguridad (se pegan en la consola de Firebase)
```

## Configurar Firebase (una sola vez)
1. Crea un proyecto en https://console.firebase.google.com (plan Spark, gratis).
2. **Authentication** → Comenzar → Método de acceso → habilita **Correo electrónico/contraseña**.
3. **Firestore Database** → Crear base de datos → elige una ubicación (p. ej. `southamerica-east1`) → modo producción.
4. Firestore → pestaña **Reglas** → pega el contenido de `firestore.rules` → Publicar.
5. ⚙️ Configuración del proyecto → Tus apps → **App web** (`</>`) → copia el objeto `firebaseConfig` en `shared/firebase-config.js`.
6. Crea el **administrador**:
   - Authentication → Usuarios → Agregar usuario (correo y contraseña del admin) → copia su **UID**.
   - Firestore → Iniciar colección `admins` → ID del documento = **ese UID** → campo `nombre` (string), p. ej. `María López`.
7. Entra al panel admin con esa cuenta. La primera vez sube solo el catálogo base (productos, recetas, inventario, promos y puntos de venta).

## Abrir en local
Abre la carpeta `food-on-wheels` en VS Code y usa Live Server en `cliente/index.html` y `admin/index.html`.
Los archivos JS son **módulos** (`type="module"`): no funcionan abriendo el HTML con doble clic, necesitan servidor.
Ya no importa el host ni el navegador: los datos están en la nube.

Para probarlo desde el celular en la misma red Wi-Fi: abre `http://IP-DEL-COMPUTADOR:5501/cliente/index.html`
(o publica la carpeta con Firebase Hosting).

## Dónde se guarda cada cosa
| Colección / documento | Qué guarda | Quién escribe |
|---|---|---|
| Authentication | correo y contraseña de cada cuenta | Firebase (nunca guardamos contraseñas) |
| `usuarios/{uid}` | nombre, teléfono, dirección, Prime, bloqueado y **carrito** | el cliente (el admin edita y bloquea) |
| `admins/{uid}` | quién es administrador | solo a mano desde la consola |
| `pedidos/{id}` | pedidos con su estado, la hora de cada estado y el `uid` del cliente | el cliente crea (y cancela si está pendiente), el admin avanza o cancela |
| `contadores/pedidos` | último número de pedido (#FOW-0001, #FOW-0002…) | se reserva en la misma transacción que crea el pedido |
| `reclamos/{idPedido}` | reclamo con motivo, productos, descripción, foto y solución pedida | el cliente lo crea, el admin aprueba o rechaza |
| `productos/{id}` | productos (con receta de insumos) y combos (`tipo: "combo"`, `incluye: [{id, cant}]`, precio fijo) | admin |
| `inventario/{id}` | insumos con stock y mínimo | admin |
| `historial/{id}` | movimientos de inventario | admin |
| `membresias/{id}` | membresías Prime vendidas | el cliente al comprar |
| `config/banner`, `config/promos`, `config/puntos` | apariencia y puntos de venta | admin |

## Cómo funciona
- **Tiempo real:** cliente y admin escuchan Firestore con `onSnapshot`; cualquier cambio aparece al instante en todos los dispositivos.
- **Carrito:** un visitante lo guarda en su dispositivo; al iniciar sesión se suma al carrito de su cuenta y desde ahí se sincroniza. Para continuar con el pedido hay que iniciar sesión.
- **Estados del pedido:** el admin solo puede avanzar al paso siguiente o cancelar (con motivo). Un pedido entregado o cancelado ya no cambia. Las reglas de Firestore exigen lo mismo.
- **Cancelación del cliente:** solo mientras el pedido está pendiente.
- **Reclamos:** hasta 24 horas después de la entrega, con foto. El cliente elige reembolso total o reenvío de lo marcado; si el admin aprueba un reenvío, se crea un pedido sin costo enlazado al original. El reembolso se registra, pero el dinero se devuelve a mano.
- **Combos:** se arman con productos y cantidades y tienen precio fijo. Se agotan cuando alguno de sus productos no alcanza. No se puede eliminar un producto que esté en un combo.
- **Inventario:** se descuenta cuando un pedido pasa a «en preparación» y se devuelve si se cancela, dentro de una transacción. Si no alcanza, el pedido no puede avanzar.
- **Clientes:** cada cliente se registra desde la web. El admin puede editar sus datos, bloquearlo o eliminarlo. Eliminarlo borra sus datos y le impide entrar; su correo sigue en Authentication (se puede borrar a mano desde la consola).
- **Imágenes:** con el plan Spark no hay Storage, así que se reducen y se guardan dentro del documento (máx. ~700 KB cada una).

## Notas
- La compra de Prime sigue siendo **de demostración**: no cobra ni guarda datos de tarjeta. Para cobrar de verdad se necesita una pasarela (Wompi, PayU, Mercado Pago…) y un backend (Cloud Functions, plan Blaze).
- Por lo mismo, un cliente técnico podría activarse Prime sin pagar; se resuelve cuando exista la pasarela.

## Pendiente
Interfaz del contador, fotos reales y pasarela de pagos.
