# 🎤 Festival de la Voz Ministerial del MPPD 2026 — Primera Edición

Plataforma en línea para la gala del festival. Incluye cuatro espacios:

| Espacio | Dirección | Para quién |
|---|---|---|
| **Página del festival** | `/` | El público (llega escaneando el QR) |
| **Sala de evaluación** | `/jurado` | Los 5 miembros del jurado (usuario y clave) |
| **Pantalla de gala** | `/pantalla?k=CLAVE` | La computadora conectada al proyector o pantalla LED |
| **Panel del administrador** | `/admin` | El administrador del programa (contraseña) |

## ✨ Funciones

### Página del festival (público)
- Portada animada con notas musicales, el logo, la **Primera Edición** y el texto del festival. Todos los textos se pueden editar.
- **Video corto** de presentación (opcional).
- Ficha de cada participante con su foto, grado, nombre, categoría (Voz Femenina o Voz Masculina), la canción que interpreta y un **reproductor de su voz (MP3)**.
- **Me gusta** y **comentarios**. Para usarlos, la persona registra su nombre y apellido.
- Los comentarios están **desactivados** hasta que el administrador los activa. Un filtro bloquea automáticamente groserías, insultos, enlaces y teléfonos. El administrador puede borrar comentarios al instante, bloquear usuarios o exigir aprobación previa.
- **Homenaje póstumo**: sección especial con cinta de luto, «velas» en lugar de me gusta y «mensajes de recuerdo». No se evalúa ni recibe votos.
- **Voz de la Audiencia**: el botón **VOTAR** solo aparece cuando el administrador abre la votación. Se permite un voto por persona.

### Sala de evaluación del jurado
- Solo el administrador la abre. El tiempo va de 1 minuto a 12 horas, o queda **sin límite** hasta que él la cierre.
- Cada jurado ve las fichas de los participantes que el administrador **envió a evaluación** y puede escuchar su audio.
- Califica **5 aspectos de 1 a 20 puntos** (máximo 100 por jurado):
  1. **Afinación y tonalidad**: precisión auditiva, control tonal y afinación constante.
  2. **Cuadratura y ritmo**: métrica, entrada a tiempo y sincronización con la orquesta o pista.
  3. **Dicción y fraseo**: claridad en la pronunciación, articulación y legato interpretativo.
  4. **Calidad vocal y timbre**: color, potencia, sostén de columna de aire y técnica vocal.
  5. **Dominio escénico e interpretación**: expresividad, vestuario, proyección y conexión con el público.
- Para cada participante, el jurado pulsa **Aceptar**, revisa el resumen y elige **Editar** o **Guardar**. Al guardar, la evaluación queda registrada y bloqueada.
- Cuando termina sus evaluaciones, el jurado ve los **porcentajes** de cada participante: suma de los 5 jurados ÷ 500 puntos.
- El sistema calcula el **1.º, 2.º y 3.er lugar** de la **Voz Femenina** y de la **Voz Masculina**. Cada puesto lo ocupa una sola persona.
- **Empates**: si dos o más participantes empatan en un puesto del podio, los jurados votan por quién lo ocupa.
  - Si la votación también empata, hay una segunda vuelta entre los más votados.
  - Si aun así no hay mayoría, decide el administrador.
- **Aprobación**: los 5 jurados deben **aceptar** a los 6 ganadores o enviar una observación. Con las 5 aprobaciones, los resultados quedan **certificados**.

### Pantalla de gala
Escenas que el administrador cambia en vivo:
- QR / Espera
- Participantes
- Video
- **Homenaje** (in memoriam)
- Voz de la Audiencia en vivo (barras que se llenan)
- Revelación de la Voz de la Audiencia
- Podio de la audiencia
- **Premiación del jurado**: se revela el **3.er**, luego el **2.º** y luego el **1.er lugar**, con la Voz Femenina y la Voz Masculina lado a lado, redoble, platillo y confeti. Al final se muestra el **podio completo** de ambas categorías.

### Panel del administrador
- **Participantes** (hasta 30): agregar, editar, cambiar foto o audio, eliminar, reordenar, marcar homenaje póstumo y **enviar a la sala de evaluación**.
- **Jurado**: registro de los 5 jurados con usuario y clave generados, control del tiempo y progreso de cada jurado. También:
  - una **planilla de puntuaciones** donde puede **modificar** o **desbloquear** cualquier evaluación;
  - la decisión de desempates, el estado de las aprobaciones y la exportación a Excel.
- **Voz de la Audiencia**: abrir y cerrar con tiempo, programar, ver resultados en vivo y ajustarlos manualmente. Los votos reales siempre se conservan.
- **Comunidad**: activar o desactivar comentarios y me gusta, moderación previa, eliminar comentarios y bloquear usuarios.
- **Página y QR**: textos, video, mostrar u ocultar las fotos al público, código QR y enlace de la pantalla. También el respaldo y los reinicios.
- **Historial completo**: cada puntuación, desempate, aprobación, modificación y comentario eliminado, con fecha y responsable.

## 🚀 Instalación

Requiere [Node.js](https://nodejs.org) 20 o superior.

```bash
npm install
ADMIN_PASSWORD="su-clave-secreta" npm start
```

**Sin `ADMIN_PASSWORD`, la contraseña es `mppd2026`. Cámbiela antes del evento.** En Internet (`NODE_ENV=production`), el sistema exige una contraseña segura.

Variables opcionales:
- `PORT`: por defecto 3000.
- `DATA_DIR`: carpeta de votos, fotos, audios y video; por defecto `./data`.
- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`: guardan todo en Supabase (vea [SUPABASE.md](SUPABASE.md) y `.env.example`).

Pruebas automáticas de la lógica del jurado y del filtro de comentarios: `npm test`.

## 📥 Carga masiva de participantes

En **Participantes → ⬆ Carga masiva (.json)** se sube un archivo con varios participantes a la vez (con foto incluida). Formato:

```json
{ "participants": [
  { "grado": "Capitán de Corbeta", "nombre": "Ana", "apellidos": "Pérez", "genero": "F",
    "cancion": "Alma Llanera", "descripcion": "Texto opcional", "tribute": false,
    "photo": "data:image/jpeg;base64,..." }
] }
```

Los que ya existan (mismo nombre y apellidos) se omiten, así que repetir la carga no duplica.

## 💾 Respaldo y restauración

En el panel, pestaña **Página y QR → Seguridad y respaldo**:
- **Descargar respaldo**: guarda un archivo `.json` con participantes, jurados (usuarios y claves), puntuaciones, me gusta, comentarios y el historial. **No incluye las fotos, audios ni el video**, solo los enlaces.
- **Restaurar respaldo**: sube ese archivo y recupera todo. Antes de restaurar, el sistema guarda una copia de lo que había en la carpeta `backups/` del disco.
- **Reconectar fotos y audios**: vuelve a enlazar los archivos que siguen en el disco pero que el sistema no reconoce.
- Cada vez que el sistema arranca guarda una copia automática en `backups/` (las últimas 15).
- **En Render hace falta un disco permanente** (ruta `/var/data` y variable `DATA_DIR=/var/data`). Sin él, los datos se borran con cada instalación; el panel muestra un aviso en rojo si falta.

## 🌐 Publicar en Internet

- **Recomendado: Render + Supabase**. Siga **[SUPABASE.md](SUPABASE.md)**. Supabase guarda los datos, las fotos, los audios y el video; el servidor en Render muestra las páginas y el tiempo real. El público escanea el QR y entra con Wi-Fi o datos móviles.
- Otras opciones (Railway, servidor propio con Docker, disco persistente): **[DESPLIEGUE.md](DESPLIEGUE.md)**.

## 🎬 Guion sugerido para la gala

1. **Antes del evento**, en el panel:
   - Cargue a los participantes con su foto, categoría y MP3.
   - Marque el homenaje póstumo.
   - Registre a los 5 jurados y entrégueles su usuario y clave (botón **Copiar**).
   - Envíe a evaluación a los participantes que concursan.
2. **Haga un ensayo completo** y luego use los botones de reinicio (pestaña «Página y QR»).
3. En la gala:
   - Muestre la escena **QR / Espera** para que el público entre a la página.
   - Proyecte el **Homenaje** en el momento indicado.
   - Abra la **sala de evaluación** del jurado y la **Voz de la Audiencia**.
4. Cuando el jurado certifique los resultados, use **Premiación del jurado**: 3.er lugar → 2.º lugar → 1.er lugar → podio completo. Luego revele la **Voz de la Audiencia**.

## 🔒 Sobre el «un solo voto» del público

Una votación web abierta, sin registro, no puede garantizar al 100 % que cada persona vote una sola vez.

El sistema bloquea:
- volver a votar en el mismo teléfono y navegador;
- repetir la solicitud de voto.

El **modo estricto** opcional también bloquea por huella del dispositivo. Úselo con cuidado: teléfonos iguales conectados al mismo Wi-Fi podrían ser bloqueados por error.

## 📁 Estructura

```
server.js             Servidor (Express + Socket.io): API, tiempos y tiempo real
lib/jury.js           Cálculo de puntajes, podios, empates y aprobación (con pruebas)
lib/filtro.js         Filtro de lenguaje ofensivo para comentarios (con pruebas)
lib/store.js          Almacenamiento: disco local o Supabase (base de datos + Storage)
supabase/setup.sql    Script para crear la tabla y el bucket en Supabase
public/index.html     Página del festival (público)
public/jurado.html    Sala de evaluación del jurado
public/pantalla.html  Pantalla de gala 1920×1080 (se adapta a cualquier pantalla)
public/admin.html     Panel del administrador (+ js/admin.js, css/admin.css)
data/                 Base de datos, fotos, audios y video (se crea sola, no se versiona)
```
