# Sala de Cine (microservicios)

Simulación de la compra de boletos de una sala de cine, construida con una arquitectura de microservicios. Los asientos se representan con una matriz, varios clientes pueden ver cuáles están disponibles y comprarlos, y el sistema evita que el mismo asiento se venda dos veces.

La aplicación se divide en cuatro servicios, cada uno con su propia base de datos, más un gateway que funciona como punto de entrada único. Todos se comunican por HTTP con JSON.

## Arquitectura

```
Navegador
      │
      ▼
  Gateway :3000 ──────────────┬───────────────┬──────────────┐
      │                       │               │              │
      ▼                       ▼               ▼              ▼
 Usuarios :3001        Catálogo :3002   Compras :3004   Asientos :3003
 usuarios.db           catalogo.db      compras.db      asientos.db
                                           │  ▲              ▲
                                           │  └── HTTP ──────┤
                                           └─────── HTTP ────┘
                                       (Compras llama a Catálogo y a Asientos)
```

| Componente | Puerto | Responsabilidad | Base de datos |
|---|---|---|---|
| Gateway | 3000 | Entrega la PWA, valida la sesión y reenvía las peticiones | Ninguna |
| Usuarios | 3001 | Cuentas, PIN y sesiones | `usuarios.db` |
| Catálogo | 3002 | Funciones con su película y horario | `catalogo.db` |
| Asientos | 3003 | Matriz de cada sala y disponibilidad | `asientos.db` |
| Compras | 3004 | Coordina la compra y guarda los boletos | `compras.db` |

Cada servicio es el único dueño de sus datos: ningún otro componente lee su base de datos, y si necesita información de otro servicio la pide por HTTP.

## Estructura del proyecto

```
Practica-8/
├── package.json
├── iniciar.js              # Lanza los 5 procesos con un solo comando
├── gateway/
│   ├── index.js
│   └── public/             # La PWA (index.html, sw.js, manifest, íconos)
├── usuarios/index.js
├── catalogo/index.js
├── asientos/index.js
└── compras/index.js
```

Al ejecutar el proyecto se crean además `node_modules/` y la carpeta `datos/`, con un archivo `.db` por servicio. No hace falta crearlos a mano.

## Requisitos

- Node.js 18 o superior (se recomienda una versión LTS reciente; el proyecto se probó con Node 22).
- npm.
- Si `better-sqlite3` no encuentra una versión precompilada para tu sistema, necesitará herramientas de compilación. En Ubuntu o Debian: `sudo apt install build-essential python3`.

## Instalación y uso

```bash
git clone https://github.com/miguelarenas0809/Practica8-Microservicios
cd Practica8-Microservicios
npm install
npm start
```

Abre `http://localhost:3000`. El comando inicia los cinco procesos y muestra sus mensajes en la consola con el nombre del servicio como prefijo, por ejemplo `[compras] ...`. Para detenerlos, pulsa `Ctrl + C`.

### Scripts disponibles

| Comando | Qué hace |
|---|---|
| `npm start` | Inicia los cinco servicios |
| `npm run usuarios` | Inicia solo el servicio de Usuarios |
| `npm run catalogo` | Inicia solo el servicio de Catálogo |
| `npm run asientos` | Inicia solo el servicio de Asientos |
| `npm run compras` | Inicia solo el servicio de Compras |
| `npm run gateway` | Inicia solo el gateway |
| `npm run reset` | Borra la carpeta `datos/` (la próxima vez se crea una sala nueva, sin compras ni cuentas) |

Los scripts individuales sirven para ver qué pasa cuando un servicio no está disponible. Por ejemplo, la compra necesita que Catálogo y Asientos estén en marcha.

### Probar desde otro dispositivo

El gateway escucha en todas las interfaces de red. Con el celular conectado a la misma red wifi, abre `http://IP_DE_TU_PC:3000`. Para ver la IP en Linux, ejecuta `hostname -I`.

> Los navegadores solo ofrecen instalar la app como PWA desde `localhost` o con HTTPS. Por una IP sin HTTPS puedes usarla, pero no instalarla.

### Variables de entorno (opcionales)

| Variable | Valor por defecto | Para qué sirve |
|---|---|---|
| `PORT` | `3000` | Puerto del gateway |
| `PORT_USUARIOS`, `PORT_CATALOGO`, `PORT_ASIENTOS`, `PORT_COMPRAS` | `3001` a `3004` | Puerto de cada servicio |
| `USUARIOS_URL`, `CATALOGO_URL`, `ASIENTOS_URL`, `COMPRAS_URL` | `http://localhost:300X` | Dirección con la que se llama a cada servicio |
| `DATA_DIR` | `./datos` | Carpeta donde se guardan las bases de datos |

Si cambias un puerto, cambia también la URL correspondiente.

## API pública (a través del gateway)

| Método y ruta | Descripción | Requiere sesión |
|---|---|---|
| `POST /api/sesion` | Inicia sesión o crea la cuenta. Recibe `nombre` y `pin`. Devuelve un token. | No |
| `GET /api/funciones` | Lista las funciones | No |
| `GET /api/funciones/:id/asientos` | Devuelve la matriz de la función (0 libre, 1 vendido) | No |
| `POST /api/compras` | Compra asientos. Recibe `funcionId` y `asientos` (pares `[fila, columna]`). Responde 409 si alguno ya está vendido. | Sí |
| `GET /api/mis-compras` | Devuelve las compras del usuario de la sesión | Sí |

Las rutas protegidas esperan el encabezado `Authorization: Bearer <token>`.

## API interna entre servicios

Estas rutas las usan los servicios entre sí y no deben exponerse a internet.

| Servicio | Ruta | Quién la llama | Descripción |
|---|---|---|---|
| Usuarios | `GET /verificar` | Gateway | Dado un token, devuelve el usuario |
| Catálogo | `GET /funciones/:id` | Compras | Devuelve película y horario de una función |
| Asientos | `POST /reservar` | Compras | Marca los asientos como vendidos, todos o ninguno |
| Asientos | `POST /liberar` | Compras | Deshace una reserva si falló el registro del boleto |

## Cómo funciona una compra

1. El navegador envía `POST /api/compras` al gateway con su token.
2. El gateway pregunta a Usuarios de quién es el token (`GET /verificar`). Si no es válido, responde 401.
3. El gateway reenvía la petición a Compras con el encabezado `X-Usuario-Id`.
4. Compras valida los datos y consulta a Catálogo si la función existe (404 si no).
5. Compras pide a Asientos que reserve los lugares. Esa operación es una transacción: se reservan todos o ninguno. Si alguno ya estaba vendido, responde 409.
6. Compras guarda el boleto en su base de datos, junto con una copia de la película y el horario. Si este paso falla, llama a `POST /liberar` para devolver los asientos (compensación).
7. La respuesta con el folio regresa por el gateway al navegador.