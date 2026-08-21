# TalkSphere

Chat en tiempo real + llamadas WebRTC 1-to-1 (voz/video) + llamadas grupales LiveKit (voz/video) + notificaciones push.

## Arquitectura

```
App (React Native / Expo) ←→ REST + Socket.io ←→ Backend propio del cliente
                         ←→ LiveKit Cloud (WebRTC SFU) ←→ Llamadas grupales
```

**Backend incluido:** Node.js (Express) + Socket.io + PostgreSQL 16 (en Docker), con migraciones automáticas al arranque.

**Llamadas 1-to-1:** WebRTC directo (P2P) con señalización vía Socket.io.
**Llamadas grupales:** LiveKit Cloud (SFU) — el cliente obtiene un token via `POST /livekit/token` y se conecta a una room.

La app se conecta a **cualquier backend** que implemente el contrato OpenAPI. No depende del backend Express incluido.

## Multi-workspace y sistema de invitaciones

Cada usuario tiene un **workspace propio** al registrarse y puede unirse a más workspaces por código de invitación o creándolos. No hay roles globales: **todos los miembros de un workspace son admin** (generan códigos, agregan/suspenden/eliminan usuarios). Los usuarios solo chatean y se llaman con miembros de sus workspaces.

### Flujo de registro e invitación

1. **Registro sin código** (descarga directa): el servidor crea automáticamente el **workspace personal** del usuario (admin) y lo deja como activo.
2. **Registro con código**: además del workspace propio, el usuario se une al workspace del código como admin, y ese workspace queda como **activo**.
3. Un miembro abre la tab **Admin** en la app → "Generar código"; el servidor crea un código `<SLUG>-<8hex>` (ej: `ACMECORP-7A3F9B2E`).
4. El código se comparte por cualquier canal (WhatsApp, email, etc.); el servidor valida (`!revocado`, `!expirado`, `use_count < max_uses`, `max_seats`).

### Cambiar de workspace

- El header del **Dashboard** muestra el workspace activo con un selector (chevron) y un chip con el **rol del usuario** en ese workspace (`Admin`/`Miembro`). El modal lista los workspaces del usuario **agrupados en "Tuyos" e "Invitados"**, con badge en cada fila e indica **"invitado por <username>"** cuando corresponde; permite cambiar entre ellos o crear uno nuevo.
- Cambiar de workspace = `PATCH /api/workspaces/activate/:id`; los chats/contactos/grupos se recargan con el nuevo workspace activo.
- `GET /api/workspaces` devuelve para cada workspace: `role`, `invited_by`, `invited_by_username` e `is_owner` (true si el usuario actual es su creador). El registro sin código solo crea el workspace personal (`is_owner=true`); el registro con código añade además el workspace del invitador (`is_owner=false`, `invited_by` = quien generó el código).

### Restricciones de workspace

- `GET /users/contacts` y `/users/search` filtran por los workspaces del usuario (membership N:N)
- `GET /messages/conversations` y `GET /messages/:userId` bloquean cross-workspace
- `POST /groups` y `POST /groups/:id/members` validan que todos los `memberIds` compartan un workspace
- Socket.io `send_message`, `typing`, `mark_read`, `call_user` validan workspace-match antes de emitir
- Broadcast de presencia `user_status` scopeado a `io.to('workspace:<id>')` (no fan-out global)

## Requisitos previos

- **Node.js** ≥ 20 y npm
- **Docker** (para PostgreSQL)
- **JDK 17** + **Android SDK** (solo para compilar APK localmente)
- **adb** (depuración USB) para instalar/probar en dispositivos físicos
- Celular y PC en la **misma red WiFi** para probar por WiFi

## Desarrollo local (paso a paso)

> ⚠️ Importante: ejecutar cada servicio **desde su propia carpeta**. El servidor usa
> `ts-node-dev`, que resuelve `tsconfig.json` relativo al directorio actual; si lo
> lanzás desde otra ruta falla con `TS5109` (`moduleResolution`/`module` NodeNext).

1. **PostgreSQL** (única dependencia en Docker):

   ```bash
   docker compose up -d db
   ```

2. **Servidor API + Socket.io en :3000** (migraciones automáticas al arrancar):

   ```bash
   cd server
   cp .env.example .env      # ajustar credenciales si hace falta
   npm install
   npm run dev               # escuchará en 0.0.0.0:3000
   ```

3. **Configurar la app** — copiar `app/.env.example` como `app/.env` y elegir modo:

   - **WiFi (recomendado para dispositivos físicos):** poner la IP LAN del host

     ```
     API_URL=http://192.168.X.X:3000/api
     SOCKET_URL=http://192.168.X.X:3000
     ```

   - **USB:** dejar `localhost` y crear el túnel `adb reverse tcp:3000 tcp:3000`.

   Estos valores se hornean en la app vía `extra` de Expo (`app.config.js`) al
   momento del bundle; si cambian, hay que re-generar el bundle (ver Compilación).

4. **Metro (dev server de React Native):**

   ```bash
   cd app
   npx expo start --lan --port 8083
   ```

   En esta máquina el puerto 8081 está ocupado (gestor-nginx), por eso se usa 8083.
   La app dev-client se conecta a Metro por la IP LAN que muestra la terminal.

5. **Instalar la app en un dispositivo**: build debug desde Android Studio, o
   `cd app/android && ./gradlew app:assembleDebug` e instalar
   `app/build/outputs/apk/debug/app-debug.apk` con `adb install -r`.

## Para clientes con backend existente

1. **Implementar el contrato** — usar `server/openapi.yaml` como especificación
   - Endpoints REST: auth, mensajes, grupos, upload, admin (tenants, invitaciones, usuarios)
   - Eventos Socket.io: mensajes en tiempo real, typing, llamadas WebRTC
2. **Configurar la app** — editar `app/src/config/appConfig.ts`:
   - `appName`: nombre de la aplicación
   - `appColor`: color primario (hex)
   - `apiUrl` / `socketUrl`: URL del servidor
3. **Compilar APK**:
   ```bash
   cd app
   eas build --platform android --profile preview
   ```

## Contrato OpenAPI

`server/openapi.yaml` define **todo**:

| Recurso | Endpoint | Propósito |
|---|---|---|
| Auth | `POST /api/auth/register` | Registro (`invitationCode` opcional) |
| Auth | `POST /api/auth/login` | Inicio de sesión (JWT) |
| Auth | `GET /api/auth/me` | Perfil del usuario autenticado |
| Mensajes | `GET /api/messages/conversations` | Lista de conversaciones (same-workspace) |
| Mensajes | `GET /api/messages/{userId}` | Mensajes con un usuario (same-workspace) |
| Grupos | `GET /api/groups` | Lista de grupos del usuario |
| Grupos | `POST /api/groups` | Crear grupo (members same-workspace) |
| Grupos | `GET/PUT /api/groups/{id}` | Info/editar grupo |
| Grupos | `GET /api/groups/{id}/members` | Miembros del grupo |
| Grupos | `POST /api/groups/{id}/members` | Agregar miembros (same-workspace) |
| Grupos | `DELETE /api/groups/{id}/members/{userId}` | Eliminar miembro |
| Grupos | `DELETE /api/groups/{id}/members/me` | Salir del grupo |
| Grupos | `POST /api/groups/{id}/transfer` | Transferir propiedad |
| Grupos | `GET /api/groups/{id}/messages` | Mensajes del grupo |
| Admin | `POST /api/workspaces` | Crear workspace (cualquier usuario) |
| Admin | `GET /api/workspaces` | Listar los workspaces del usuario |
| Admin | `PATCH /api/workspaces/activate/{id}` | Cambiar workspace activo |
| Admin | `PATCH /api/workspaces/{id}` | Editar workspace (miembro) |
| Admin | `POST /api/workspaces/{id}/members` | Agregar miembro al workspace |
| Admin | `POST /api/tenants/{id}/seed-admin` | Crear primer admin de un workspace (alias compat) |
| Admin | `POST /api/invitations` | Crear código de invitación |
| Admin | `GET /api/invitations` | Listar códigos |
| Admin | `DELETE /api/invitations/{id}` | Revocar código |
| Admin | `GET /api/admin/users` | Listar usuarios del workspace activo |
| Admin | `PATCH /api/admin/users/{id}` | Suspender/activar usuario |
| Admin | `DELETE /api/admin/users/{id}` | Eliminar usuario (quita membership) |
| Upload | `POST /api/upload` | Subir imagen |
| Upload | `POST /api/users/avatar` | Subir avatar |
| Push | `PUT /api/users/push-token` | Registrar push token |
| LiveKit | `POST /api/livekit/token` | Obtener token para room de LiveKit |

## Eventos Socket.io

### Cliente → Servidor
| Evento | Payload | Propósito |
|---|---|---|
| `send_message` | `{ receiverId?, groupId?, content, messageType }` | Enviar mensaje (valida workspace) |
| `typing` | `{ receiverId?, groupId?, isTyping }` | Indicar escritura (valida workspace) |
| `mark_read` | `{ senderId }` | Marcar mensajes como leídos (valida workspace) |
| `call_user` | `{ targetId, offer, callType }` | Iniciar llamada (valida workspace) |
| `answer_call` | `{ targetId, answer }` | Responder llamada |
| `ice_candidate` | `{ targetId, candidate }` | Intercambiar ICE candidates |
| `end_call` | `{ targetId }` | Finalizar llamada |
| `toggle_audio` | `{ targetId, enabled }` | Silenciar/activar micrófono |
| `toggle_video` | `{ targetId, enabled }` | Activar/desactivar cámara |
| `group_call_started` | `{ groupId, roomName, callType }` | Iniciar llamada grupal LiveKit |
| `group_call_ended` | `{ groupId, roomName }` | Finalizar llamada grupal |
| `group_call_declined` | `{ groupId }` | Rechazar llamada grupal |

### Servidor → Cliente
| Evento | Payload | Propósito |
|---|---|---|
| `new_message` | `Message` | Mensaje recibido |
| `typing_indicator` | `{ userId, groupId?, isTyping }` | Alguien escribe |
| `incoming_call` | `{ callerId, offer, callType }` | Llamada 1-to-1 entrante |
| `group_call_started` | `{ groupId, groupName, roomName, callType, startedBy, startedByName }` | Llamada grupal entrante |
| `group_call_ended` | `{ groupId }` | Llamada grupal finalizada |
| `group_call_declined` | `{ groupId }` | Llamada grupal rechazada |
| `call_answered` | `{ answererId, answer }` | Llamada aceptada |
| `call_ended` | `{ endedBy }` | Llamada finalizada |
| `user_status` | `{ userId, isOnline }` | Cambio online/offline (scopeado a `workspace:<id>`) |
| `audio_toggled` | `{ userId, enabled }` | Peer silenció/activó audio |
| `video_toggled` | `{ userId, enabled }` | Peer activó/desactivó video |
| `online_users` | `{ onlineIds }` | Lista de IDs en línea (filtrado por workspace) |
| `added_to_group` | `{ group }` | Agregado a un grupo |
| `removed_from_group` | `{ groupId }` | Eliminado de un grupo |
| `group_members_updated` | `{ groupId }` | Miembros del grupo actualizados |
| `group_info_updated` | `{ groupId }` | Info del grupo actualizada |

## Modelo de datos (PostgreSQL)

```
workspaces (id, name, slug, max_seats, is_active, created_at, deleted_at)
users (id, username, email, password_hash, avatar_url, is_online, last_seen,
       workspace_id, active_workspace_id, invited_by, invited_at, is_suspended, created_at)
workspace_invitations (id, code, workspace_id, created_by, used_by, max_uses, use_count,
                       is_revoked, expires_at, created_at, used_at)
workspace_members (workspace_id, user_id, role: admin|member, invited_by)
workspace_contacts (id, workspace_id, user_id, name, email, phone,
                    registered_user_id, invitation_id, invited_at, dedup_key)
groups (id, name, description, avatar_url, created_by, workspace_id)
group_members (group_id, user_id, role: admin|member)
messages (id, sender_id, receiver_id?, group_id?, content, message_type, created_at, read_at, reply_to_id)
push_tokens (id, user_id, token, platform)
```

Las migraciones viven en `server/src/db/migrations/` y se aplican automáticamente al arrancar el servidor (tabla `_migrations`).

## Compilación

### Opción A — EAS cloud (producción / distribución)

```bash
cd app
npm install
npx eas login
npx eas build --platform android --profile preview
```

### Opción B — Build release local (APK standalone)

Genera un APK con el **bundle JS embebido** (Hermes): no necesita Metro para
funcionar y es necesario para que las **notificaciones push con la app cerrada**
puedan ejecutar el task en background.

1. Configurar `app/.env` (ver Desarrollo local, paso 3) — estos valores quedan
   horneados en el build.
2. Compilar:

   ```bash
   cd app/android
   ./gradlew app:assembleRelease
   ```

3. Instalar en los dispositivos:

   ```bash
   adb install -r app/build/outputs/apk/release/app-release.apk
   ```

Notas:
- Firma con `debug.keystore` (config por defecto del template); para Play Store
  configurar signing propio.
- Si cambiaste `.env` y el bundle no se regenera, forzar con
  `./gradlew app:createBundleReleaseJsAndAssets --rerun-tasks` y volver a
  `app:assembleRelease`.
- El upgrade instala conserva datos (misma firma), pero la sesión pide login de nuevo.

## Notificaciones push

- La app registra el token Expo Push (`PUT /api/users/push-token`) al iniciar sesión.
- **Llamada entrante**: el servidor envía un push *data-only* de prioridad high;
  un task headless (`expo-task-manager`, task `onIncomingCall`) presenta la
  notificación local con botones **Aceptar / Rechazar** aunque la app esté en
  segundo plano o el proceso muerto (no force-stopped).
- **Limitación de Android**: si la app está en *force-stop* (deslizarla en
  recents en muchos OEM como Huawei/Xiaomi/Unisoc, o optimización agresiva de
  batería), el sistema **bloquea la entrega FCM** hasta que el usuario la abra.
  No tiene arreglo a nivel código; por eso la app muestra un **wizard de
  batería** (`BatteryWizardModal`) la primera vez que inicia sesión en un
  dispositivo de OEM agresivo (Xiaomi/Huawei/Oppo/Vivo/Samsung/Doogee/etc.),
  con instrucciones por fabricante y acceso directo a ajustes. Se puede volver
  a abrir desde **Panel Admin → "Llamadas en segundo plano (batería)"**. En
  build debug además el task headless requiere Metro activo; usar build release
  para probar ese caso.

## Personalización por cliente

Editar `app/src/config/appConfig.ts`:

```ts
const APP_CONFIG = {
  appName: 'MiApp',           // Nombre visible
  appColor: '#FF0000',         // Color primario (hex)
  companyName: 'Mi Empresa',   // Opcional
  supportEmail: 'soporte@...', // Opcional
};
```

## Server demo (Express + PostgreSQL)

Solo para testing. Las instrucciones completas están en la sección
**Desarrollo local (paso a paso)** de este mismo archivo.

### Levantar en local

1. Levantar PostgreSQL (solo la DB):

   ```bash
   docker compose up -d db
   ```

2. Configurar y arrancar el servidor:

   ```bash
   cd server
   cp .env.example .env   # ajustar credenciales si hace falta
   npm install
   npm run dev            # migraciones automáticas + API en :3000
   ```

   Stack completo (DB + server) en contenedores:

   ```bash
   docker compose up --build
   # app expuesta en http://localhost:8080
   ```

3. Tests:

   ```bash
   cd server && npm test
   ```
