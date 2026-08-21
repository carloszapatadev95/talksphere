# Push Notifications — Setup y resolución

## 1. Análisis del problema

Las notificaciones push en Android requieren 3 capas coordinadas:

```
App (expo-notifications)
  → Expo Push Service (exp.host)
    → Firebase Cloud Messaging (FCM)
      → Dispositivo Android
```

El error inicial era: `"Unable to retrieve the FCM server key for the recipient's app"` (código `InvalidCredentials`). Ocurría porque Expo Push Service necesita una credencial de Firebase autorizada para entregar notificaciones a Android.

### Causa raíz

Google **deprecó la FCM Legacy API** (junio 2024). La API heredada solo requería una "Server Key" (string estático), pero FCM V1 exige autenticación OAuth2 mediante una **cuenta de servicio (service account JSON)**. Expo migró a FCM V1, por lo que ya no basta con pegar una Server Key en el dashboard — hay que subir el archivo JSON de la cuenta de servicio.

## 2. Arquitectura del Push Service

### Flujo de registro de token

```
App inicia
  → registerForPushNotifications() en app/src/services/notifications.ts
    → Crea canal Android (importancia MAX)
    → Solicita permiso al usuario
    → Obtiene ExpoPushToken vía Notifications.getExpoPushTokenAsync({ projectId })
    → Envía token a PUT /api/users/push-token (server/src/routes/notifications.ts)
      → Se guarda en tabla push_tokens (user_id, token, platform)
```

### Flujo de envío de push

```
Servidor llama a sendPush(recipientId, title, body)
  → pushService.ts (server/src/services/pushService.ts)
    → Consulta push_tokens del destinatario
    → Construye mensajes ExpoPushMessage[]
    → chunkPushNotifications() divide en lotes
    → sendPushNotificationsAsync() envía a Expo Push API
      → Expo entrega a FCM (Android) o APNs (iOS)
        → Dispositivo recibe notificación
```

### Archivos involucrados

| Archivo | Rol |
|---|---|
| `server/src/services/pushService.ts` | Lógica de envío (sendPush, getUserPushTokens) |
| `server/src/routes/pushTest.ts` | Endpoints de debug (`GET /users/push-tokens`, `POST /push/test`) |
| `server/src/routes/notifications.ts` | Registro de token (`PUT /users/push-token`) |
| `app/src/services/notifications.ts` | Registro desde la app (con retry, canal Android) |
| `app/app.config.js` | Configuración Expo (slug, projectId, plugins) |
| `app/eas.json` | Configuración EAS Build |

## 3. Resolución paso a paso

### Paso 1: Crear cuenta de servicio en Firebase

```
Firebase Console → Configuración del proyecto → Cuentas de servicio
  → firebase-adminsdk-... → Administrar claves
    → Agregar clave → Crear clave nueva → JSON
      → Descarga archivo .json
```

La cuenta de servicio debe tener el rol **Firebase Messaging API Admin** (se asigna automáticamente si se genera desde Firebase Console > Service Accounts).

### Paso 2: Subir la cuenta de servicio a Expo

**Opción A — CLI (recomendada):**

```bash
# Instalar EAS CLI
npm install -g eas-cli

# Iniciar sesión en Expo
eas login

# Navegar al directorio de la app
cd app/

# Subir credencial FCM V1
eas credentials --platform android
```

Menú navegado:
```
Select build profile: production
Select option: Google Service Account
Select option: Manage your Google Service Account Key for Push Notifications (FCM V1)
Select option: Set up a Google Service Account Key for Push Notifications (FCM V1)
Select option: Upload a new service account key
Confirm JSON file detected: Y
```

**Opción B — Dashboard web:**

```
Expo Dashboard → proyecto → Credentials
  → Android → com.communicator.app
    → Service Credentials → FCM V1 service account key
      → Add a service account key → Upload JSON → Save
```

### Paso 3: Configurar app.json / app.config.js

El `app.config.js` debe tener:

- `slug` coincidiendo con el slug del proyecto Expo (dashboard)
- `extra.eas.projectId` con el UUID del proyecto Expo
- `android.googleServicesFile` apuntando a `google-services.json`
- Plugin `expo-notifications` configurado

### Paso 4: google-services.json

Descargar de Firebase Console → Configuración del proyecto → General → Tus apps → Android → `google-services.json`.

Colocar en `app/android/app/google-services.json`.

### Paso 5: Verificar

```bash
# Desde el servidor
curl -X POST http://localhost:3000/api/push/test \
  -H "Authorization: Bearer <token-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"userId": 4}'

# Respuesta esperada:
# { "sent": 1, "failed": 0, ... }
```

## 4. Problemas encontrados y soluciones

| Problema | Causa | Solución |
|---|---|---|
| `slug mismatch` en `eas credentials` | `app.config.js` tenía `slug: "communicator"` pero el proyecto Expo se creó con slug `"communicator-app"` | Cambiar slug a `"communicator-app"` |
| `eas.json not found` | Faltaba archivo de configuración EAS | Crear `app/eas.json` con perfiles development/preview/production |
| `InvalidCredentials` al enviar push | Expo no tenía FCM credential configurada | Subir service account JSON a Expo |
| `stdin not readable` en CLI interactivo | El CLI requiere terminal interactiva | Usar script Python con PTY o dashboard web |
| Push de llamada no hace sonar el teléfono | Push solo se enviaba cuando el usuario estaba offline (socket desconectado). App en segundo plano mantiene socket → no se enviaba push → no sonaba | Enviar push SIEMPRE en call_user, sin depender de isUserOnline |
| Iconos de llamada no funcionan tras cambios | App necesita recargar configuración tras cambios en app.config.js | Cerrar app completamente y reabrir, o reiniciar Metro bundler |

## 5. Configuración para nuevo despliegue (cliente)

Cuando el cliente despliegue su propia instancia:

1. **Firebase Console**: Crear proyecto, registrar app Android, descargar `google-services.json`
2. **Expo Dashboard**: Crear proyecto, obtener `projectId`
3. **Generar service account JSON**: Firebase → Service Accounts → Generate new private key
4. **Subir a Expo**: `eas credentials --platform android` (CLI) o dashboard web
5. **Actualizar archivos**:
   - `app/.env`: `EXPO_PROJECT_ID=<nuevo-uuid>`
   - `app/android/app/google-services.json`: reemplazar con el nuevo
   - `app/app.config.js`: verificar que `slug` coincida
6. **Reconstruir app**: `npx expo run:android` o `eas build --platform android`
7. **Probar**: `POST /api/push/test` contra el servidor

## 6. Fix aplicado: Push de llamada siempre enviado

**Archivo:** `server/src/socket/signalingHandler.ts`

**Antes:**
```typescript
if (!isUserOnline(data.targetId, io)) {
  sendPush(data.targetId, username, `${username} te hace una ${callLabel}`, {
    callData: { ... }
  });
}
```

**Después:**
```typescript
sendPush(data.targetId, username, `${username} te hace una ${callLabel}`, {
  callData: { ... }
});
```

**Motivo:** `isUserOnline` chequea si hay un socket conectado. Pero Android mantiene la conexión Socket.IO viva incluso en segundo plano. Por lo tanto, el push nunca se enviaba y el teléfono nunca sonaba. Ahora el push se envía **siempre** que alguien llama, sin importar el estado de conexión.

## 7. Comandos útiles

```bash
# Ver tokens push registrados
curl -s http://localhost:3000/api/users/push-tokens \
  -H "Authorization: Bearer <token>" | python3 -m json.tool

# Enviar push de prueba a un usuario específico
curl -s -X POST http://localhost:3000/api/push/test \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"userId": 4}' | python3 -m json.tool

# Login para obtener token
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@email.com", "password": "password"}'

# ADB reverse (desarrollo)
adb reverse tcp:3000 tcp:3000
adb reverse tcp:8081 tcp:8081
```

## 8. Stack tecnológico

- **Backend**: Node.js + Express + TypeScript + MySQL
- **Push SDK**: `expo-server-sdk` (npm)
- **App**: React Native + Expo SDK 56
- **Push library**: `expo-notifications`
- **FCM version**: HTTP v1 (OAuth2 con service account)
- **Infra push**: Expo Push Service → FCM (Android) / APNs (iOS)
