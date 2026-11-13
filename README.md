# 🎤 Festival de la Voz Ministerial del MPPD 2026 — Sistema de Votación en Vivo

Sistema de votación del público para la gala del festival, en tiempo real:

| Página | Dirección | Para quién |
|---|---|---|
| **Votación pública** | `/` | El público (llega escaneando el QR) |
| **Pantalla de gala** | `/pantalla?k=CLAVE` | La computadora conectada al proyector / pantalla LED |
| **Panel de administrador** | `/admin` | Usted (protegido con contraseña) |

## ✨ Funciones

- **Hasta 30 participantes** con foto, grado, nombre y apellidos (las fotos se reducen automáticamente).
- **Un voto por persona**: cookie del navegador + identificador guardado en el teléfono. Un *modo estricto* opcional bloquea también por huella del dispositivo.
- **El público solo ve las fotos** hasta que usted activa la votación. Entonces aparecen el botón **VOTAR** y el cronómetro.
- **Control del tiempo**: iniciar ahora con una duración (1, 2, 3, 5, 10… minutos o personalizada) **o programar** la hora de inicio y de cierre. Se cierra sola al acabar el tiempo. También puede cerrar antes, agregar minutos o reabrir.
- **Pantalla de gala con 5 escenas** que usted cambia desde el panel:
  1. **QR / Espera**: logo animado, QR gigante y carrusel de participantes.
  2. **Participantes**: galería con todas las fotos.
  3. **En vivo**: barras doradas que se llenan y se reordenan a medida que llegan los votos, con porcentajes, votos, líder actual, total de votos y votos por minuto.
  4. **Ganador**: «Y el ganador es…», cuenta regresiva 3-2-1 con redoble, reflectores, confeti y platillo. Si hay empate, lo muestra.
  5. **Podio**: 1.º, 2.º y 3.º lugar con oro, plata y bronce.
- **Ajuste manual de resultados** (+1, +10, −1, −10 o fijar un total). Los votos reales se conservan aparte y cada cambio queda en una bitácora.
- Exporta los resultados a CSV (se abre en Excel).
- Funciona **sin Internet** en una red local: las fuentes, el confeti y los sonidos van incluidos.

## 🚀 Instalación

Requiere [Node.js](https://nodejs.org) 18 o superior.

```bash
npm install
ADMIN_PASSWORD="su-clave-secreta" npm start
```

En Windows (PowerShell):

```powershell
npm install
$env:ADMIN_PASSWORD="su-clave-secreta"; npm start
```

La consola muestra las direcciones. **Si no define `ADMIN_PASSWORD`, la contraseña es `mppd2026`. Cámbiela antes del evento.**

Variables opcionales: `PORT` (por defecto 3000), `DATA_DIR` (carpeta donde se guardan votos y fotos; por defecto `./data`) y `NODE_ENV=production` (modo Internet: exige una contraseña segura y activa las cookies seguras para HTTPS).

## 🌐 ¿Cómo llega el público a la página?

Los teléfonos del público tienen que poder abrir la dirección del servidor. Hay dos opciones:

**A) Red local (Wi-Fi del teatro).** Ejecute el sistema en una laptop conectada al Wi-Fi del evento. En *Panel → QR y configuración* aparecen las direcciones de la red local (por ejemplo `http://192.168.1.50:3000/`). Elija una y pulse «Guardar URL». El QR se actualiza solo. El público debe estar conectado a ese mismo Wi-Fi.

**B) En Internet (recomendado si el público usa datos móviles).** 👉 Siga la guía paso a paso en **[DESPLIEGUE.md](DESPLIEGUE.md)**. El proyecto ya incluye `render.yaml` para publicarlo en Render con pocos clics, y un `Dockerfile` para Railway o un servidor propio.

## 🎬 Guion sugerido para la gala

1. **Antes del evento**: en *Participantes*, cargue a los participantes. En *QR y configuración*, guarde la URL y descargue el QR para imprimirlo. Haga un ensayo y luego use **«Reiniciar votación completa»**.
2. En la computadora del proyector, pulse **«Abrir pantalla de gala»** y luego **F** para pantalla completa. Haga un clic en la pantalla para activar el sonido.
3. Muestre la escena **QR / Espera** mientras el público escanea. Todavía solo verán las fotos.
4. En el momento indicado, elija la duración y pulse **«Iniciar votación ahora»**. Cambie a **En vivo** para que todos vean las barras llenarse.
5. Al cerrarse la votación, elija **Ganador** (con redoble y confeti) o **Podio**. Con «↻ Repetir revelación» puede repetir la animación.

## 🔒 Sobre el «un solo voto»

Una votación web abierta, sin registro, no puede garantizar al 100 % una persona = un voto. Este sistema bloquea:
- votar de nuevo en el mismo teléfono y navegador (incluso si recarga la página o cierra el navegador);
- repetir el voto enviando otra vez la misma solicitud.

Alguien muy decidido podría votar de nuevo usando otro navegador o el modo incógnito. Por eso existe el **modo estricto** (en *QR y configuración*). Úselo con cuidado: teléfonos del mismo modelo conectados al mismo Wi-Fi podrían ser bloqueados por error.

## 📁 Estructura

```
server.js            Servidor (Express + Socket.io), API y lógica de votación
public/index.html    Página de votación del público (móvil)
public/pantalla.html Pantalla de gala 1920×1080 (se adapta a cualquier pantalla)
public/admin.html    Panel del administrador
public/css, js, img  Estilos, utilidades y logo
data/                Votos (db.json) y fotos subidas — se crea solo, no se versiona
```
