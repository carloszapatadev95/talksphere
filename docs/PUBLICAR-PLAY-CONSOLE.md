# Publicar en Google Play Console — Guía reusable (TalkSphere)

Guía paso a paso construida a partir del despliegue real de **TalkSphere** (Expo SDK 56 / React Native) a Google Play. Pensada para **reutilizarse en cada release** y para replicar el pipeline en otra app del mismo stack.

## Índice

1. [Prerequisitos](#1-prerequisitos)
2. [Config del proyecto para store](#2-config-del-proyecto-para-store)
3. [Perfil `production` en eas.json](#3-perfil-production-en-easjson)
4. [La clave: keystore y firma de la app](#4-la-clave-keystore-y-firma-de-la-app) ⭐
5. [Versionado](#5-versionado)
6. [Build del AAB](#6-build-del-aab)
7. [Submit a Play Console](#7-submit-a-play-console)
8. [Checklist manual en Google Play Console](#8-checklist-manual-en-google-play-console)
9. [Release nuevo (flujo corto)](#9-release-nuevo-flujo-corto)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisitos

| Recurso | Estado | Dónde |
|---|---|---|
| Cuenta de desarrollador Google Play (25 USD, pago único) | ✅ | https://play.google.com/console |
| Cuenta Expo + EAS CLI instalado | ✅ | `eas-cli` v20.0.0 global |
| Proyecto Expo (slug `communicator-app`) | ✅ | https://expo.dev/accounts/carlos.zapata.dev/projects/communicator-app |
| Firebase project con `google-services.json` | ✅ | Firebase project `communicator-app-67641` |
| LiveKit Cloud (para llamadas grupales) | ✅ | `wss://communicator-app-tz0htm2b.livekit.cloud` |
| Servidor desplegado (Render) con privacy policy | ✅ | https://communicator-app.onrender.com/privacy-policy.html |

**Info clave del proyecto:**
- Package / applicationId: `com.chatcallpro.app`
- App name: **TalkSphere**
- Keystore EAS: **CZDev ChatCall keystore**
- Track inicial: **internal** (testing interno)

---

## 2. Config del proyecto para store

Todo esto se hace **una vez** por app. Archivos tocados y valores finales:

### 2.1 Branding
| Archivo | Campo | Valor |
|---|---|---|
| `app/src/config/appConfig.ts` | `appName` | `'TalkSphere'` |
| `app/src/config/appConfig.ts` | `appColor` | `'#1A73E8'` |
| `app/src/config/appConfig.ts` | `companyName` | `'Carlos Zapata'` |
| `app/src/config/appConfig.ts` | `supportEmail` | `'carlos.zapata.dev@gmail.com'` |
| `app/app.json` | `name` | `"TalkSphere"` |
| `app/app.config.js` | `APP_NAME` default | `'TalkSphere'` |
| `app/.env` | `APP_NAME` | `TalkSphere` |

### 2.2 Package name (no puede cambiar después de publicar)
- `app/app.config.js` → `expo.android.package: "com.chatcallpro.app"`
- `app/app.json` → `expo.android.package: "com.chatcallpro.app"`
- `app/android/app/build.gradle` → `namespace` y `applicationId` = `com.chatcallpro.app`
- `app/android/app/src/main/java/com/chatcallpro/app/MainActivity.kt` → `package com.chatcallpro.app`

> ⚠️ El package **no se puede renombrar** una vez subido a Play. Definir bien antes del primer AAB.

### 2.3 Permisos Android (en `app.config.js` y AndroidManifest)
```
android.permission.CAMERA
android.permission.RECORD_AUDIO
android.permission.MODIFY_AUDIO_SETTINGS
android.permission.POST_NOTIFICATIONS
```
Si cambian permisos o plugins nativos → requiere `npx expo run:android` y **rebuild completo**, no alcanza con recargar Metro.

### 2.4 Assets obligatorios (en `app/assets/`)
| Asset | Tamaño | Archivo |
|---|---|---|
| Feature graphic | 1024×500 px | `feature-graphic.png` |
| Icono adaptive foreground | 1024×1024 | `android-icon-foreground.png` |
| Icono adaptive background | 1024×1024 | `android-icon-background.png` |
| Icono monochrome | 1024×1024 | `android-icon-monochrome.png` |
| Splash | ~512×512 | `splash-icon.png` |
| Notification icon | — | `notification-icon.png` |

### 2.5 Privacy policy (obligatoria para Play)
- Fuente editable: `app/assets/privacy-policy.html`
- Copia servida desde el server: `server/public/privacy-policy.html`
- URL pública: `https://communicator-app.onrender.com/privacy-policy.html`
- Se pega en Play Console → *App content* → *Privacy policy*

---

## 3. Perfil `production` en eas.json

`app/eas.json` → bloque `build.production`:

```json
"production": {
  "distribution": "store",
  "env": {
    "API_URL": "https://communicator-app.onrender.com/api",
    "SOCKET_URL": "https://communicator-app.onrender.com",
    "EXPO_PROJECT_ID": "8086477f-61ad-4be7-b471-970124ce23d1",
    "LIVEKIT_URL": "wss://communicator-app-tz0htm2b.livekit.cloud",
    "APP_NAME": "TalkSphere"
  },
  "android": {
    "buildType": "app-bundle"
  }
}
```

Puntos críticos:
- `distribution: "store"` → produce AAB firmado para store (no APK interno).
- `android.buildType: "app-bundle"` → genera `.aab` (formato requerido por Play).
- Las env vars se inyectan en el build cloud; `app.config.js` las lee con fallback.
- `expo-dev-client` se excluye automáticamente en producción (`IS_PRODUCTION` en `app.config.js`) → **no debe estar en el bundle final**.

---

## 4. La clave: keystore y firma de la app ⭐

Hay **3 claves distintas** que no hay que confundir. Esta sección es la más importante de todo el pipeline: **si se pierde la clave de firma, la app no se puede actualizar.**

### 4.1 La jerarquía de claves (qué es cada una)

```
┌────────────────────────────────────────────────────────────────┐
│  GOOGLE PLAY — APP SIGNING KEY                                 │
│  (la posee Google; re-firma tu AAB para el usuario final)      │
└────────────────────────────────────────────────────────────────┘
                         ▲ re-firma
┌────────────────────────────────────────────────────────────────┐
│  TU UPLOAD KEY = KEYSTORE ANDROID (release.jks)                │
│  (la poseés vos; firma el AAB que subís a Play Console)        │
└────────────────────────────────────────────────────────────────┘
```

| Clave | Quién la tiene | Para qué sirve | Dónde está en este proyecto |
|---|---|---|---|
| **Keystore Android** (upload key) | Vos (y EAS en la nube) | Firmar el AAB que subís | EAS: *CZDev ChatCall keystore* + backup local `app/android/app/release.jks` |
| **App Signing Key** | Google Play | Re-firmar el AAB para cada dispositivo | Play Console → Setup → App signing (automático al primer upload) |
| **Service account FCM V1** | Vos (Expo) | Push notifications (Firebase) | Subida a Expo vía `eas credentials` — **NO es clave de firma** |

### 4.2 Paso A — Generar el keystore (una sola vez)

Expo/EAS puede generarlo automáticamente en el primer build de producción, o manualmente:

```bash
cd app
eas login
eas credentials --platform android
```

Flujo del menú (elecciones usadas en este proyecto):
```
Select build profile: production
Select option: Manage your Android app signing credentials
Select option: Create a new keystore            ← genera uno nuevo
(Expo lo guarda en la nube y lo usa para firmar cada build)
```

> En este proyecto se llama **"CZDev ChatCall keystore"**. El keystore queda guardado en la cuenta EAS, así los builds cloud siempre firman con la MISMA clave.

### 4.3 Paso B — Descargar y respaldar el keystore (CRÍTICO)

El keystore en la nube de EAS NO es suficiente. Google Play y la comunidad de desarrollo recomiendan **respaldarlo fuera de EAS** por si la cuenta se pierde, se borra, o el archivo se corrompe.

```bash
eas credentials --platform android
# Select build profile: production
# Select option: Manage your Android app signing credentials
# Select option: Download app signing credentials from EAS servers
# → descarga release.jks
# → pregunta si querés guardar keystore.properties
```

Resultado esperado (archivos locales de este proyecto):
```
app/android/app/release.jks      ← el keystore (2.2 KB)
app/android/keystore.properties  ← credenciales de firma
```

`app/android/keystore.properties`:
```properties
RELEASE_STORE_FILE=app/release.jks
RELEASE_STORE_PASSWORD=<password>
RELEASE_KEY_ALIAS=<alias>
RELEASE_KEY_PASSWORD=<password>
```

Estos archivos son **leídos por Gradle** en `app/android/app/build.gradle:119-126` (usa `signingConfigs.release` si `keystore.properties` existe; si no, firma con debug — peligroso para store).

**Backups recomendados (hacer una vez y cada vez que se rota la clave):**
1. ✅ `release.jks` + `keystore.properties` en una carpeta offline (pendrive cifrado / gestor de contraseñas tipo Bitwarden)
2. ✅ Una copia en la nube privada del dueño de la cuenta (Google Drive personal cifrado)
3. ✅ Anotar store password + key alias + key password en el gestor de contraseñas
4. 🔲 Verificar que **Play App Signing esté activado** (Play Console → Setup → App signing) — si está activo, hasta perdiendo el keystore se puede pedir un *reset de upload key* y no se pierde la app.

> ⚠️ Regla de oro: **sin keystore y sin App Signing → la app publicada queda "muerta"** (no podés subir más actualizaciones y no podés recuperar el package name nunca más).

### 4.4 Paso C — Verificar que el keystore firma bien

```bash
cd app/android
# Listar el contenido del keystore (pide el store password)
keytool -list -keystore app/release.jks

# Verificar que el alias existe con la clave correcta
keytool -list -keystore app/release.jks -alias <RELEASE_KEY_ALIAS> -storepass <RELEASE_STORE_PASSWORD>
```

### 4.5 Paso D — NUNCA commitear las claves

Verificado en este repo:
- `app/.gitignore` incluye `*.jks`, `*.p8`, `*.p12`, `*.key` → `release.jks` IGNORED ✅
- `keystore.properties` → IGNORED ✅ (confirmado con `git check-ignore`)
- `google-services.json` → IGNORED ✅ (secret de Firebase)
- `server/.env`, `server/firebase-service-account.json` → IGNORED ✅

Comando para validar antes de cualquier commit:
```bash
cd app
git check-ignore android/app/release.jks android/keystore.properties   # → si no salen, NO commitear
```

### 4.6 Si se pierde el keystore (plan de contingencia)

| Escenario | App Signing activo | Qué hacer |
|---|---|---|
| Perdiste el keystore | ✅ Sí | Play Console → Setup → App signing → **Reset upload key** → generás un keystore nuevo y seguís actualizando |
| Perdiste el keystore | ❌ No | No podés actualizar la app. Generar keystore nuevo exige publicar como app NUEVA (otro package). |

Por eso el paso 4.3 (backup) y activar App Signing (4.9) son obligatorios.

### 4.7 Build local con el keystore (alternativa al build cloud)

El AAB también se puede compilar **localmente** con Gradle directo, usando el `keystore.properties` + `release.jks` de la carpeta `android/` (que no está en git):

```bash
cd app/android

# AAB de producción (firma con el keystore de EAS descargado)
./gradlew bundleRelease
# → app/releases/ChatCallPro-vX.Y.Z-versionCodeN.aab

# APK instalable en el celular (firma con el mismo keystore)
./gradlew assembleRelease
```

Detalles reales del proyecto (commit `df28ced`):
- El build inicial compiló CMake/WebRTC en ~4 min; los incrementales ~30 s.
- Artefacto generado: `app/releases/ChatCallPro-v1.1.2-versionCode7.aab` (97.8 MB), firmado con el keystore de EAS, `jarsigner -verify` ✅.
- ⚠️ `eas build --local` **falla** en este proyecto: el snapshot de EAS excluye `android/` y `google-services.json` (gitignored) → error `Cannot copy google-services.json`. Por eso se usa Gradle directo sobre la carpeta `android/` local.
- Verificación de firma del AAB resultante:
  ```bash
  cd app/releases
  jarsigner -verify ChatCallPro-v1.1.2-versionCode7.aab
  ```

### 4.8 Rotar / cambiar de keystore

1. `eas credentials --platform android` → *Create a new keystore* (o importar uno propio)
2. Actualizar `app/android/keystore.properties` local si se usa build local
3. Si el keystore NUEVO se usa para el upload → pedir **reset de upload key** en Play Console (si App Signing está activo) ANTES de subir el siguiente AAB
4. Rehacer backups (4.3)

### 4.9 Activar Play App Signing (recomendado, hace el release a prueba de pérdidas)

```
Google Play Console → tu app → Configuración → Integridad de la app → App signing
→ Activar Play App Signing → aceptar el contrato
```
Google genera su propia app signing key y guarda una copia cifrada de tu upload key. Desde ahí, tu keystore solo sirve para subir releases; Google firma lo que llega al usuario.

---

## 5. Versionado

**Regla:** `versionCode` debe ser **único y siempre creciente** por package en Play Console. `versionName` es solo visible.

Historial real de este proyecto (para referencia):

| Commit | versionCode | versionName | Nota |
|---|---|---|---|
| `3045cea` | default (1) | 1.0.0 | Primer release (branding + assets); sin versionCode explícito |
| `51e532b` | 3 | 1.0.1 | Crash fix + submit a Internal track; **primer versionCode explícito en `app.config.js`** |
| `15dcfd3` | 4 | 1.0.1 | Rebuild limpio |
| `79fec24` | 5 | 1.0.1 | Multi-tenant |
| `ae1f659` | 5 | 1.1.0 | Alinear versionName (mismo code) |
| `9edce86` | 6 | 1.1.1 | Multi-tenant release |
| `df28ced` | 7 | 1.1.2 | Multi-tenant release (Aug 12 2026) |
| `fe8dd18` | 17 | 1.3.0 | Actualización en Play Store (Aug 21 2026) |

**Dónde se cambia:**
- `app/app.config.js` → `expo.version` y `expo.android.versionCode`
- `app/app.json` → `expo.version` (si se usa como fuente)
- `app/android/app/build.gradle` → `versionCode` / `versionName` (sincronizados por prebuild)

> ⚠️ Si subís un AAB con `versionCode` ya usado o menor → Play lo rechaza.

---

## 6. Build del AAB

**Opción A — Build cloud (EAS):**

```bash
cd app
eas build --profile production --platform android
# ~15-20 min en la nube
```

Al terminar:
- EAS devuelve un **buildId** (ej. `f8e3cd73-1ec9-4ac9-af34-97d6becbc3d1`) y un link de descarga del `.aab`
- **El AAB ya viene firmado con el keystore de EAS** (CZDev ChatCall) → no hay que firmar a mano

**Opción B — Build local (Gradle directo):** usar cuando EAS cloud no sea opción (o `eas build --local` falle, como en este proyecto). Ver sección [4.7 Build local con el keystore](#47-build-local-con-el-keystore-alternativa-al-build-cloud):

```bash
cd app/android
./gradlew bundleRelease
# → app/releases/ChatCallPro-vX.Y.Z-versionCodeN.aab
```

> ⚠️ El AAB local y el de EAS deben firmarse con el **mismo keystore** que se subió por primera vez, o Play rechazará el upload (mismatch de firma).

Guardar el buildId: lo usa el paso siguiente (`eas submit --id`). Puede listarse luego con:
```bash
eas build:list --platform android --profile production --limit 5
```

---

## 7. Submit a Play Console

### 7.1 Vía `eas submit` (recomendada)

Script real del proyecto (`app/submit-release.sh`):

```bash
#!/usr/bin/env bash
# Run on YOUR machine (needs browser for Google OAuth + EAS auth)
set -euo pipefail

echo "==> Submitting to Google Play Internal track"
eas submit --platform android \
  --profile production \
  --id <BUILD_ID> \
  --wait
```

- `--profile production` usa el bloque `submit.production` de `eas.json`:

```json
"submit": {
  "production": {
    "android": {
      "track": "internal",
      "releaseStatus": "completed"
    }
  }
}
```

- `track: "internal"` → sube al **Internal testing** de Play (privado, solo testers). Cambiar a `production` cuando el release vaya al público.
- `releaseStatus: "completed"` → el release queda "publicado" en ese track (no en draft).
- `--wait` espera a que termine.
- En el primer submit, EAS abre el navegador para el **OAuth de Google Play** (vincular la cuenta de desarrollador).

### 7.2 Vía upload manual
1. Descargar el `.aab` desde el link de EAS (o `eas build:download`)
2. Play Console → tu app → **Testing** → **Internal testing** → *Create new release*
3. Arrastrar el `.aab` → llenar notas de release → *Review* → *Rollout*

---

## 8. Checklist manual en Google Play Console

Después del primer submit, revisar estas secciones. El release no sale a producción sin completarlas.

### 8.1 Dashboard de la app
- [ ] **App name:** `TalkSphere`
- [ ] **Short description** (~80 car.)
- [ ] **Full description** (~4000 car., features + beneficios)
- [ ] **Categoría:** Comunicación / Mensajería
- [ ] **Contact email** + website (si hay)

### 8.2 Store listing (Ficha)
- [ ] **Screenshots** (2–8) → usar `app/assets/screenshots/screenshot_1..8.jpeg` (8 capturas ya tomadas: chat, llamadas, grupos, perfil)
- [ ] **Feature graphic** → `app/assets/feature-graphic.png` (1024×500)
- [ ] **Icon** → 512×512
- [ ] **Privacy policy URL** → `https://communicator-app.onrender.com/privacy-policy.html`

### 8.3 App content (obligatorio para todos)
- [ ] **Data safety** — declarar qué datos se recopilan. La app recopila (según privacy-policy): email, username, password (hash bcrypt), avatar, mensajes, push tokens, estado online, cámara/micrófono (solo en llamadas). NO recopila: ubicación, contactos, historial de compras.
- [ ] **Ads:** No (sin anuncios)
- [ ] **Content rating:** completar el cuestionario (IARC) — app de comunicación con contenido generado por usuarios → típicamente *Everyone* / *Teen* según moderación
- [ ] **App access:** Login con email+password + código de invitación (no es de acceso libre completo → marcarlo)
- [ ] **Target audience & content:** 13+ o superior (hay chat abierto entre usuarios)

### 8.4 Testing & release
- [ ] **Testing → Internal testing:** crear/verificar el grupo de testers y agregar los correos de prueba
- [ ] Revisar el **pre-launch report** (Play analiza el APK/AAB automáticamente y reporta crashes/anr)
- [ ] Probar en el grupo interno antes de promover (instalar el build del Internal track en un dispositivo real)
- [ ] Promover a **Closed testing** → **Production** cuando esté validado

### 8.5 Integridad de la app
- [ ] **App signing:** Play App Signing activado (ver paso 4.9)
- [ ] Keystore respaldado (ver paso 4.3)

---

## 9. Release nuevo (flujo corto)

Para cada actualización:

```bash
# 1) Bump de versión
#    app.config.js → version + versionCode (+1)
#    app/android/app/build.gradle → versionCode/versionName sincronizados

# 2) Build producción (firma con el MISMO keystore de EAS)
cd app && eas build --profile production --platform android

# 3) Submit (usa el build más reciente o el buildId guardado)
eas submit --platform android --profile production --latest

# 4) Verificar en Play Console → Internal testing → versión + versionCode nuevo
# 5) Probar → Promover a producción (o al track que corresponda)
```

> Nunca bajar `versionCode`. Nunca cambiar `package` / applicationId.

---

## 10. Troubleshooting

| Problema | Causa | Solución |
|---|---|---|
| Play rechaza el AAB | `versionCode` repetido o menor | Bump `versionCode` en `app.config.js` + `build.gradle` |
| AAB firmado con debug keystore | Falta `keystore.properties` | Descargar credenciales con `eas credentials` → `keystore.properties` local |
| `slug mismatch` en `eas credentials` | `slug` de `app.config.js` ≠ proyecto Expo | Alinear `slug: "communicator-app"` |
| `InvalidCredentials` en push FCM | Expo sin service account FCM V1 | `eas credentials` → *Google Service Account* → upload JSON |
| `stdin not readable` en CLI interactivo | Terminal no interactiva | Usar script con PTY, o dashboard web de Expo/Play |
| Se perdió el keystore y App Signing está activo | Backup perdido | Play Console → App signing → **Reset upload key** |
| Se perdió el keystore y NO hay App Signing | — | No hay solución; la app no se puede actualizar |
| Build EAS falla | Falta env var o `google-services.json` | `eas build:list --status=errors` y revisar env/secret |
| Play pide más screenshots o tamaño inválido | Screenshots fuera de spec | Regenerar con la resolución pedida (tablet y phone) |
| Notificaciones no llegan en el build de Play | FCM V1 o token no registrado | Verificar `push_tokens`, re-verificar service account |

---

## Referencias

- Repo: https://bitbucket.org/carlos-zapata-dev95/communicator-app
- Expo project: https://expo.dev/accounts/carlos.zapata.dev/projects/communicator-app
- Server (Render): https://communicator-app.onrender.com
- Privacy policy: https://communicator-app.onrender.com/privacy-policy.html
- Firebase project: `communicator-app-67641`
- Push setup detallado: `server/PUSH_SETUP.md`
