# 🌐 Publicar el sistema en Internet

Esta guía explica cómo poner el sistema de votación en un servidor de Internet, para que el público pueda votar con **datos móviles o con cualquier Wi-Fi**.

> **Lo más importante:** el servidor debe tener un **disco persistente**. Ahí se guardan los votos y las fotos. Los planes gratuitos suelen borrar los archivos al reiniciarse, así que no sirven para la gala.

Hay tres opciones. **La opción A es la más sencilla.**

---

## Opción A — Render.com (recomendada, unos 10 minutos)

Costo aproximado: plan *Starter* (unos 7 USD al mes) más disco persistente (unos 0,25 USD al mes). Se puede dar de baja después del festival.

1. Cree una cuenta en <https://render.com> e inicie sesión con su cuenta de GitHub.
2. Pulse **New + → Blueprint**.
3. Elija el repositorio de este proyecto y la rama que contiene el sistema. Render lee el archivo `render.yaml` y configura todo automáticamente: región Virginia (la más cercana a Venezuela), disco de 2 GB (fotos, audios y video) y comprobación de salud.
4. Render le pedirá el valor de **`ADMIN_PASSWORD`**. Escriba una contraseña segura de al menos 8 caracteres, por ejemplo `Gala-Voz-2026!MPPD`. Guárdela bien.
5. Pulse **Apply** y espere unos 3 minutos, hasta que el estado diga **Live**.
6. Render le asigna una dirección como `https://festival-voz-mppd-2026.onrender.com`:
   - Votación del público: `https://…onrender.com/`
   - Panel del administrador: `https://…onrender.com/admin`

### Dominio propio (opcional)
Si tiene un dominio, por ejemplo `votacion.festivalmppd.com`, vaya a **Settings → Custom Domains** en Render, agréguelo y cree en su proveedor de dominio el registro DNS que Render le indique. El certificado HTTPS se crea solo.

---

## Opción B — Railway.app

1. En <https://railway.app>, pulse **New Project → Deploy from GitHub repo** y elija este repositorio. Railway detecta el `Dockerfile` por su cuenta.
2. En el servicio, abra **Variables** y agregue:
   - `ADMIN_PASSWORD` = su contraseña segura
3. Pulse **⋯ → Attach Volume** y use **`/data`** como ruta de montaje. Esto es imprescindible.
4. En **Settings → Networking**, pulse **Generate Domain** para obtener la dirección pública.

---

## Opción C — Servidor propio (VPS con Docker)

En cualquier servidor Linux con Docker (DigitalOcean, Hetzner, un servidor institucional, etc.):

```bash
git clone <URL-del-repositorio> festival && cd festival
docker build -t festival-voz .
docker run -d --name festival --restart unless-stopped \
  -p 3000:3000 \
  -e ADMIN_PASSWORD='su-contraseña-segura' \
  -v festival-datos:/data \
  festival-voz
```

Ponga delante un proxy con HTTPS, por ejemplo [Caddy](https://caddyserver.com). Con este `Caddyfile` el certificado se obtiene automáticamente:

```
votacion.su-dominio.com {
    reverse_proxy localhost:3000
}
```

---

## ✅ Después de publicar (lista de verificación)

1. Entre en `/admin` con su contraseña.
2. **Participantes**: cargue a los participantes con su foto, categoría y audio MP3, y envíelos a evaluación.
3. **Jurado**: registre a los 5 jurados y envíeles su usuario, clave y la dirección `https://…/jurado`.
4. **Página y QR**: el QR ya apunta a la dirección pública. Si usa un dominio propio, escríbalo en «Dirección a la que lleva el QR» y pulse **Guardar URL**. Luego descargue el QR para imprimirlo o proyectarlo.
5. **Haga un ensayo completo**:
   - Abra la votación por 2 minutos y vote desde 2 o 3 teléfonos con datos móviles.
   - Pida a los jurados que entren y evalúen a un participante.
   - Muestre la premiación en la pantalla de gala.
   - Al final, use los botones **Reiniciar votos del público** y **Reiniciar evaluación del jurado**.
6. Pulse **Descargar respaldo** para guardar una copia antes de la gala.
7. **El día de la gala**: abra la página del servicio unos 10 minutos antes, para que el servidor ya esté encendido.

## ❓ Preguntas frecuentes

**¿Cuántas personas pueden votar a la vez?**
En las pruebas, el servidor registró **600 votos simultáneos en menos de un segundo**, sin perder ninguno. Para una gala sobra capacidad.

**¿Puedo tener varias copias del servidor (escalar)?**
No. Use **una sola instancia**. Los votos en tiempo real se coordinan dentro de un único servidor; el archivo `render.yaml` ya viene configurado así.

**¿Qué pasa si el servidor se reinicia durante la gala?**
Los votos, las fotos, el estado de la votación y su sesión de administrador quedan guardados en el disco. Las pantallas y los teléfonos se reconectan solos en pocos segundos.

**¿Por qué no arranca y aparece «Defina la variable ADMIN_PASSWORD»?**
Es una protección. En Internet el sistema se niega a funcionar con la contraseña de ejemplo o con una de menos de 8 caracteres. Configure `ADMIN_PASSWORD` y reinicie el servicio.

**¿Y si se cae el Internet del teatro?**
La pantalla de gala necesita conexión para recibir los votos. Tenga a mano un respaldo, por ejemplo un teléfono compartiendo datos con la computadora del proyector.
