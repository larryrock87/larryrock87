# ☁️ Usar el sistema con Supabase

Esta guía explica, paso a paso, cómo publicar el Festival de la Voz en Internet usando **Supabase**. Al final, el público escanea el QR (con Wi-Fi o datos móviles) y llega a su sistema en la web.

## ¿Cómo funciona?

```
 📱 Teléfono del público            🌐 Su servidor en Internet               ☁️ Supabase
 (Wi-Fi o datos móviles)            (Render.com)                             (base de datos + archivos)
 ┌──────────────────┐   escanea    ┌──────────────────────────────┐  guarda  ┌────────────────────────┐
 │  Cámara → QR     │ ───────────► │ https://su-festival.onrender │ ───────► │ Tabla festival_state   │
 │  abre la página  │   el enlace  │  · página del público        │  y lee   │ (votos, jurado,        │
 └──────────────────┘              │  · sala del jurado           │ ◄─────── │  comentarios, historial)│
 ⚖️ Jurado (tablet/teléfono) ────► │  · pantalla de gala          │          │                        │
 📺 Pantalla de gala ────────────► │  · panel del administrador   │          │ Bucket «festival»      │
 🛠️ Administrador ───────────────► │  · tiempo real (Socket.io)   │          │ (fotos, MP3 y video)   │
                                   └──────────────────────────────┘          └────────────────────────┘
```

- **Supabase** guarda todo de forma permanente:
  - en la **base de datos**: participantes, votos, puntuaciones del jurado, comentarios e historial;
  - en **Storage**: fotos, audios y video.
- **El servidor** (en Render) muestra las páginas y mueve todo en **tiempo real**: las barras que se llenan, el reloj, la sala del jurado y la pantalla de gala. También aplica las reglas: un voto por persona, desempates, filtro de comentarios, etc.
- Como el servidor está **en Internet**, el público puede entrar con **cualquier Wi-Fi o con datos móviles**. No necesita estar en la misma red.
- Si el servidor se reinicia, **no se pierde nada**: al arrancar recupera todo desde Supabase. Las pantallas y los teléfonos se reconectan solos.

> ¿Por qué no solo Supabase? La votación en vivo, la sala del jurado (empates, aprobaciones) y la pantalla de gala necesitan un programa que funcione permanentemente y coordine a todos en tiempo real. Ese es su servidor. Supabase es donde ese servidor guarda la información de forma segura.

---

## Paso 1 — Crear el proyecto en Supabase (5 minutos)

1. Entre en <https://supabase.com> y cree una cuenta. Puede usar su cuenta de GitHub.
2. Pulse **New project** y complete:
   - **Name**: `festival-voz-2026`
   - **Database Password**: invente una y guárdela (este sistema no la usa, pero Supabase la pide).
   - **Region**: **East US (North Virginia)**, la más cercana a Venezuela y la misma región del servidor.
3. Pulse **Create new project** y espere 1–2 minutos.

## Paso 2 — Crear la tabla y el bucket (1 minuto)

1. En el menú izquierdo, abra **SQL Editor** y pulse **New query**.
2. Abra el archivo [`supabase/setup.sql`](supabase/setup.sql) de este proyecto, copie **todo** su contenido y péguelo.
3. Pulse **Run**. Abajo debe aparecer una fila con `festival | true | 52428800`.

El script crea:
- la tabla **`festival_state`**, **privada**: solo su servidor puede leerla, porque contiene las claves de los jurados;
- el bucket **`festival`**, de lectura pública, para que el público vea las fotos y escuche los audios.

## Paso 3 — Copiar las dos claves

En Supabase, abra **Project Settings** (⚙️):

| Lo que necesita | Dónde está | Ejemplo |
|---|---|---|
| **Project URL** | *Data API* (o *API*) → **Project URL** | `https://abcdefghijkl.supabase.co` |
| **Clave secreta** | *API Keys* → **Secret key** (`sb_secret_…`). En proyectos antiguos: pestaña *Legacy API keys* → **service_role** | `sb_secret_…` o `eyJhbGciOi…` |

> 🔒 **La clave secreta es como la llave maestra de su base de datos.** Póngala **solo** en Render (paso 4). No la envíe por WhatsApp, no la publique y no la ponga en ninguna página. **No** use la clave *publishable* ni la *anon*: con ellas el sistema no puede guardar.

## Paso 4 — Publicar el servidor en Render (10 minutos)

1. Cree una cuenta en <https://render.com> con su cuenta de **GitHub**.
2. Pulse **New + → Blueprint** y elija el repositorio **`larryrock87`** y la rama **`claude/festival-voz-voting-system-68s4so`**. Render lee el archivo `render.yaml` y configura todo.
3. Render le pedirá estas variables:

   | Variable | Valor |
   |---|---|
   | `ADMIN_PASSWORD` | La contraseña del panel del administrador (mínimo 8 caracteres). Ej.: `Gala-Voz-2026!MPPD` |
   | `SUPABASE_URL` | El **Project URL** del paso 3 |
   | `SUPABASE_SERVICE_ROLE_KEY` | La **clave secreta** del paso 3 |

4. Pulse **Apply** y espere a que diga **Live** (unos 3 minutos).
5. Render le da su dirección pública, por ejemplo **`https://festival-voz-mppd-2026.onrender.com`**.

**Compruebe que funciona:**
- Abra `https://SU-DIRECCION/admin`, entre con su contraseña y vaya a **Página y QR**. Debe aparecer: **☁ Datos, fotos, audios y video guardados en Supabase**.
- En Supabase → **Table Editor → festival_state** debe aparecer una fila.
- Al subir la primera foto, aparecerá en **Storage → festival**.

> Si Render muestra el error *«No se pudo leer la tabla festival_state…»*, revise que ejecutó el paso 2 y que copió bien la URL y la clave secreta. Por seguridad, el sistema **no arranca** si no puede leer Supabase, para no borrar sus datos.

## Paso 5 — El código QR para el público

1. En el panel, abra **Página y QR**.
2. En **«Dirección (URL) a la que lleva el QR»** escriba su dirección pública, por ejemplo `https://festival-voz-mppd-2026.onrender.com/`, y pulse **Guardar URL**. Si deja el campo vacío, el sistema usa automáticamente la dirección con la que usted abrió el panel.
3. Pulse **⬇ Descargar QR** para imprimirlo en afiches, programas de mano o en las mesas.
4. En la gala, la escena **QR / Espera** de la pantalla muestra ese mismo QR en grande.

**Lo que vive el público:**
1. Apunta la cámara del teléfono al QR. No necesita instalar ninguna aplicación.
2. Toca el enlace y se abre la página del festival.
3. Escucha las voces, da me gusta y comenta (después de registrar su nombre).
4. Cuando usted abre la votación, aparece el botón **VOTAR**.

## Paso 6 — (Opcional) Un dominio propio

Si tiene un dominio, por ejemplo `votacion.festivalmppd.com`:
1. En Render: **Settings → Custom Domains → Add**.
2. Cree en su proveedor de dominio el registro DNS que Render le indique. El certificado HTTPS se crea solo.
3. Ponga esa dirección en el campo del QR (paso 5) y descargue el QR de nuevo.

---

## 💡 Recomendaciones para el día de la gala

- **Haga un ensayo completo** con teléfonos usando **datos móviles** y otros con el **Wi-Fi** del lugar:
  - abra la votación 2 minutos;
  - pida a los jurados que entren a `/jurado`;
  - pruebe la premiación en la pantalla;
  - al final, use los botones de reinicio.
- **Wi-Fi del teatro**: si exige una página de inicio de sesión, conviene que el público use datos móviles. Ponga en el afiche: *«Escanea con tus datos o con el Wi-Fi del evento»*.
- **Video**: súbalo **liviano** (idealmente menos de 15 MB, máximo 50 MB en el plan gratuito). Cada persona que lo reproduce lo descarga y consume el tráfico mensual de Supabase.
- **Audios**: MP3 cortos (30–60 segundos, 1–2 MB cada uno).
- Abra la página unos minutos antes del evento para comprobar que todo responde.
- Antes y después de la gala, pulse **Descargar respaldo** en el panel.

## 💰 Costos aproximados

Revise los precios vigentes en cada sitio.

| Servicio | Plan | Para qué |
|---|---|---|
| **Supabase** | **Free** (gratis): 500 MB de base de datos, 1 GB de archivos, archivos de hasta 50 MB | Suficiente para el festival |
| **Render** | **Starter** (≈ 7 USD/mes) | Servidor siempre encendido. Puede darlo de baja después del festival |

- **Supabase gratis** pausa los proyectos que pasan **una semana sin actividad**. Si lo prepara con mucha anticipación, entre al panel al menos una vez por semana, o reactívelo desde Supabase antes de la gala.
- **Render gratis** funciona para preparar el festival, pero se «duerme» tras 15 minutos sin visitas y tarda cerca de un minuto en despertar. Para el día de la gala use **Starter**.

## ❓ Preguntas frecuentes

**¿Qué pasa si se reinicia el servidor en plena gala?**
Al arrancar recupera todo desde Supabase: votos, puntuaciones, el estado de la votación y su sesión. Los teléfonos, la sala del jurado y la pantalla se reconectan solos en segundos.

**¿Y si Supabase falla un momento durante la gala?**
El sistema sigue funcionando: el estado vive en la memoria del servidor y también se guarda una copia en su disco. Reintenta subir los cambios a Supabase automáticamente, y en **Página y QR** usted verá un aviso mientras eso ocurra.

**¿Puedo ver los datos en Supabase?**
Sí: **Table Editor → festival_state**, columna `data`. Le recomendamos **no editarla a mano** mientras el servidor está encendido; use el panel del administrador, que registra cada cambio en el historial.

**¿Puedo pasar mis datos locales a Supabase?**
Sí. La primera vez que el servidor arranca con Supabase y la tabla está vacía, sube automáticamente lo que tenga en `data/db.json`. Las fotos y audios subidos antes en modo local deben volver a cargarse desde el panel.

**¿Puedo probarlo en mi computadora con Supabase?**
Sí: copie `.env.example` como `.env`, complete las variables y ejecute `npm install` y luego `npm run start:env`.
