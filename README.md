# MFC Contador

Bot de conteo para Discord: turnos, récord, niveles con barra de progreso y timeouts que escalan según el número que se arruinó y la reincidencia.

## Puesta en marcha

### 1. Token

Abre `.env` y pon un token válido:

```
DISCORD_TOKEN=tu_token_aqui
DISCORD_CLIENT_ID=1504278330336219256
DISCORD_CLIENT_SECRET=...
```

El token se saca en [Discord Developer Portal](https://discord.com/developers/applications) → tu app → **Bot** → **Reset Token**.

> ⚠️ Nunca compartas el token. Si se filtra, resetéalo: con él cualquiera controla el bot.

### 2. Activar el intent de contenido

En el portal → tu app → **Bot** → **Privileged Gateway Intents**:

- **MESSAGE CONTENT INTENT** — obligatorio. Sin él el bot no puede leer los números y ni siquiera arranca.
- **SERVER MEMBERS INTENT** — recomendado. Sirve para devolver los roles al instante cuando alguien levanta un timeout a mano. Sin él el bot arranca igual, solo tarda hasta 30 segundos.

### 3. Invitar el bot

Al arrancar, el bot imprime en consola su enlace de invitación con los permisos correctos. Necesita:

| Permiso | Para qué |
|---|---|
| Ver canal / Leer historial | ver los números |
| Enviar mensajes + Insertar enlaces | avisar de la cadena rota |
| Añadir reacciones + Usar emojis externos | el check ✅ |
| **Aislar miembros** (Moderate Members) | aplicar los timeouts |
| **Gestionar roles** (Manage Roles) | castigar también a los administradores |
| Gestionar mensajes | solo si activas `borrarInvalidos` |

Importante: en **Ajustes del servidor → Roles**, el rol del bot tiene que estar **por encima** de los roles de la gente a la que va a moderar. Cuanto más arriba, a más gente alcanza. Ver [Timeouts a administradores](#timeouts-a-administradores).

### 4. Instalar y arrancar

```bash
npm install
```

```bash
npm start
```

Para que se reinicie solo al editar el código: `npm run dev`.

## Uso

En el canal donde quieras contar:

```
/setcanal
```

Y ya. La gente escribe `1`, `2`, `3`… el bot reacciona con el check a cada acierto.

## Servidor autorizado

El bot solo funciona en el servidor `1155074712402149437`. Si está en cualquier otro (al arrancar) o alguien lo mete después, **se sale solo** y lo apunta en la consola. Para autorizar otro, añade su ID a `SERVIDORES_AUTORIZADOS` en `src/index.js`.

## Comandos

| Comando | Quién | Qué hace |
|---|---|---|
| `/contador` | todos | Por dónde va, récord y nivel |
| `/nivel [usuario]` | todos | Nivel del canal + estadísticas del usuario |
| `/top [tipo]` | todos | Ranking de aciertos, mejor racha o fallos |
| `/ayuda` | todos | Explica las reglas con los valores actuales |
| `/setcanal [canal] [empezar_en]` | 🔒 | Define el canal del contador. Solo hay uno: si lo pones en otro canal, se mueve ahí con su nivel, récord y estadísticas |
| `/reiniciar [numero]` | 🔒 | Reinicia el conteo |
| `/perdon <usuario> [borrar_infracciones]` | 🔒 | Quita el timeout, devuelve los roles retirados y (por defecto) borra las infracciones |
| `/config ver \| poner \| reset` | 🔒 | Ajustes del servidor |
| `/permisos ver \| rol \| comando` | 🔒 | Quién puede usar cada comando |

🔒 = solo el rol con permiso y el dueño del bot. Ver [Permisos](#permisos).

## Reglas

1. Se cuenta de uno en uno.
2. **No puedes contar dos veces seguidas** (se puede permitir con `permitirRepetir`).
3. Si el número está mal o te saltas el turno: la cadena se rompe, vuelve al 1 y te llevas un timeout.

Los mensajes que no empiezan por un número se ignoran (`13 vamos!` sí cuenta como 13).

El número se puede escribir de varias formas:

| Forma | Ejemplos |
|---|---|
| Cifras | `13`, `13 vamos!` |
| Cuentas | `1+1` → 2, `99999999-99999998` → 1, `(2+3)*4` → 20, `10/2`, `2^5`, `3x4` |
| Palabras (español) | `uno`, `veintitrés`, `ciento uno`, `dos mil trescientos` |
| Palabras (inglés) | `one`, `twenty-one`, `one hundred and five` |

- Las cuentas tienen que dar un entero positivo: `3/2` o `5-9` se ignoran.
- Con palabras, el mensaje tiene que ser **solo** el número. Así `una pregunta` no cuenta como un 1.
- Las cuentas las lee el bot con su propio analizador, nunca ejecuta lo que se escribe.

## Cómo se calcula el timeout

**Base — según el número arruinado:**

```
minutos = número × minutosPorNumero   (mínimo 1 minuto, máximo 1 hora)
```

Los castigos son suaves a propósito: uno largo quita las ganas de jugar. Con los valores por defecto (`minutosPorNumero = 0.1`):

| Número arruinado | Timeout |
|---|---|
| 4 | 1 minuto |
| 13 | 1 minuto |
| 50 | 5 minutos |
| 285 | 29 minutos |
| 1000 o más | 1 hora (tope) |

**Reincidencia (anti-spam):** si vuelves a romper la cadena **antes de 1 hora** desde tu última infracción, el castigo se multiplica ×2 cada vez, hasta un tope de ×4 (y nunca más de 1 hora en total):

```
1ª vez  ×1      2ª vez  ×2      3ª+ vez  ×4
```

Si aguantas esa hora sin romper nada, se te olvidan las infracciones y vuelves al castigo normal. Así el que la rompe una vez sin querer paga poco, y el que entra a hacer spam se va cada vez más tiempo.

**Única excepción:** el dueño del bot (`262514432427556865`) rompe la cadena como cualquiera, pero no se lleva timeout ni infracciones. Al resto se le castiga siempre (salvo los límites de Discord de abajo).

## Timeouts a administradores

Discord **ignora el timeout de quien tiene el permiso Administrador**: se lo puedes poner, pero sigue escribiendo como si nada. El bot resuelve esto así:

1. Detecta que el timeout normal no le va a afectar.
2. Le quita **solo los roles que dan permiso de Administrador**, y apunta cuáles eran. Los roles de color, VIP o decorativos **no se tocan**: no estorban para el timeout.
3. Ya sin permisos de admin, le aplica el timeout.
4. Cuando el castigo termina, **le devuelve los roles solo**.

Si prefieres que le quite todos los roles que alcance, no solo los de admin:

```
/config poner ajuste:quitarSoloRolesAdmin valor:false
```

Los roles se apuntan en disco *antes* de tocarlos, así que aunque el bot se caiga o se reinicie a mitad del castigo, al arrancar los devuelve. Si la persona se salió del servidor, se los guarda y se los devuelve cuando vuelva.

### Los roles vuelven pase lo que pase

Hay tres formas de que un castigo termine, y en las tres se devuelven los roles:

| Cómo termina | Qué hace el bot |
|---|---|
| Se cumple el tiempo | Los devuelve solo |
| `/perdon @usuario` | Quita el timeout y los devuelve |
| **Un mod quita el timeout a mano** desde Discord | Lo detecta y los devuelve solo |

El tercer caso funciona de dos maneras a la vez: al instante si está activado **SERVER MEMBERS INTENT** en el portal, y como red de seguridad un repaso cada 30 segundos que funciona sin ningún intent. Si el intent está apagado el bot arranca igual y avisa por consola; solo tarda un poco más.

Y si aun así algo se queda colgado, a mano:

```
/perdon @usuario
```

### Lo que no se puede hacer

| Caso | Por qué |
|---|---|
| **Dueño del servidor** | Discord no permite que un bot le toque nada, nunca. No hay forma. |
| **Alguien con un rol por encima del bot** | El bot no puede ni silenciarlo ni quitarle roles |
| **Roles de integración / booster** | No los puede quitar nadie, son de Discord |

El segundo caso **sí depende de ti**: ve a **Ajustes del servidor → Roles** y arrastra el rol del bot lo más arriba posible. Corre `node test/diagnostico.js` y te dice exactamente cuántos roles le quedan por encima.

## Permisos

Los comandos se dividen en dos niveles:

- **público** — cualquiera: `/contador`, `/nivel`, `/top`, `/ayuda`
- **admin** — solo el rol configurado y el dueño del bot: todo lo demás

Por defecto el rol con permiso es `1454632814409682995` y el dueño del bot es `262514432427556865`. Se cambia sin tocar código:

```
/permisos ver
/permisos rol accion:Añadir rol:@Staff
/permisos rol accion:Quitar rol:@Staff
/permisos comando comando:/top nivel:Administrativo
```

Si alguien sin permiso usa un comando cerrado, le sale un aviso privado y no pasa nada más.

> El dueño del servidor siempre puede usar `/permisos`, aunque no tenga el rol. Es a propósito: así no hay forma de quedarse fuera por borrar el rol equivocado.

## Al reiniciar

El bot retoma donde lo dejó: número actual, récord, nivel, XP, estadísticas, infracciones y castigos pendientes. Todo vive en `data/guilds.json`, que se guarda automáticamente y de forma atómica.

Al arrancar imprime el estado de cada canal:

```
[estado] #contador: va por 137, récord 285
```

## Niveles

Cada acierto suma 1 XP **al canal**. La barra se llena así:

```
[▱▱▱▱▱▱▱▱▱▱] 0 / 20      nivel 0
[▰▰▰▰▰▰▰▱▱▱] 14 / 20     nivel 0
[▱▱▱▱▱▱▱▱▱▱] 20 / 68     nivel 1
```

Cada nivel cuesta más que el anterior, para que no se suba fácil:

| Salto | XP |
|---|---|
| 0 → 1 | 20 |
| 1 → 2 | 48 |
| 2 → 3 | 79 |
| 4 → 5 | 150 |
| 9 → 10 | 356 |
| 19 → 20 | 846 |

La fórmula es `xpBase × (nivel+1) ^ xpExponente`. Sube `xpExponente` para hacerlo más duro, bájalo para hacerlo más suave.

## Ajustes (`/config poner`)

| Ajuste | Por defecto | Qué hace |
|---|---|---|
| `emojiOk` | `1291246124006510623` | Emoji del check (ID o unicode) |
| `emojiFail` | `1545719040608174150` | Reacción cuando se rompe (ID o unicode) |
| `permitirRepetir` | `false` | Permitir contar dos veces seguidas |
| `celebrarHitos` | `true` | Reacción extra en múltiplos de 100 |
| `borrarInvalidos` | `false` | Borrar mensajes que no son números |
| `avisarBorrados` | `true` | Avisar si borran/editan el último número |
| `timeoutsActivos` | `true` | Aplicar timeouts |
| `quitarSoloRolesAdmin` | `true` | Al castigar a un admin, quitarle solo los roles de admin |
| `minutosPorNumero` | `0.1` | Minutos de castigo por cada número |
| `timeoutMinimoMin` | `1` | Castigo mínimo |
| `timeoutMaximoMin` | `60` | Castigo máximo (Discord deja hasta 40320 = 28 días) |
| `multiplicadorSpam` | `2` | Cuánto se multiplica al reincidir |
| `maxMultiplicadorSpam` | `4` | Tope del multiplicador |
| `ventanaSpamMin` | `60` | Minutos sin fallar para que se olviden las infracciones |
| `xpPorAcierto` | `1` | XP por número correcto |
| `xpBase` | `20` | Coste base de nivel |
| `xpExponente` | `1.25` | Cuánto se encarece cada nivel |
| `reinicioMensual` | `true` | Reiniciar las estadísticas cada mes |
| `diaReinicio` | `20` | Día del mes en que empieza la temporada nueva (1-28) |
| `zonaHoraria` | — | Zona para la medianoche del reinicio, p. ej. `America/Santo_Domingo` (vacío = la hora del equipo del bot) |
| `banner` | — | URL de una imagen o GIF que sale arriba de `/contador` y `/ayuda` (`no` para quitarlo) |

Ejemplos:

```
/config poner ajuste:minutosPorNumero valor:0.05
/config poner ajuste:permitirRepetir valor:true
/config poner ajuste:xpExponente valor:1.5
/config poner ajuste:banner valor:https://.../banner.gif
```

### Temporadas mensuales

El día `diaReinicio` de cada mes (por defecto el **20**) a las 00:00 empieza una temporada nueva:

- **Se borran:** el top, las estadísticas de cada usuario (aciertos, fallos, rachas, tiempo silenciado) y el nivel del canal.
- **No se tocan:** el número por el que va el contador, el récord, el **histórico** de cada usuario (sale en `/nivel`), las infracciones y los castigos en curso.
- Antes de borrar se hace una copia completa en `data/guilds.antes-temporada-AAAA-MM.json` y se guarda un resumen con el top 10 en los datos del servidor (últimas 12 temporadas).
- El bot lo anuncia en los canales de conteo con los ganadores del mes.

Si el bot estaba apagado ese día, el reinicio se hace en cuanto arranca. La primera vez que se arranca esta versión, si ya había estadísticas de antes del último día 20, se cierran en ese momento.

Los niveles no tienen tope, y la barra empieza de cero en cada nivel: `[▰▱▱▱▱▱▱▱▱▱] 1 / 20`.

### Mensajes (Components V2)

Todos los mensajes del bot usan **Components V2**, el sistema nuevo de Discord: un contenedor con la barra de color, títulos, citas con la barra gris, separadores y los **botones y menús dentro del propio mensaje**. Hace falta discord.js 14.19 o superior.

- `/contador`: botones Actualizar, Mi nivel, Top y Ayuda.
- `/top`: menú para cambiar de ranking.
- `/ayuda`: botones por sección y menú desplegable.
- Cadena rota: botones Mi nivel y Top.

Los botones piden el mismo permiso que su comando. Lo que abren desde un mensaje público sale como mensaje efímero, para no llenar el canal.

### Los emojis de acierto y fallo

`emojiOk` está puesto al ID `1291246124006510623` y `emojiFail` al ID `1545719040608174150`. Para que funcionen, **el bot tiene que estar en el servidor donde viven esos emojis**. Si no los encuentra, reacciona con ✅ o ❌ y `/setcanal` te avisa. También puedes poner un emoji normal:

```
/config poner ajuste:emojiOk valor:✅
/config poner ajuste:emojiFail valor:❌
```

## Comprobar que todo está bien

**Sin conectarse a Discord** — simula partidas enteras y verifica la lógica (40 comprobaciones):

```bash
node test/simulacion.js
```

**Contra tu servidor de verdad** — revisa permisos, jerarquía de roles y el emoji:

```bash
node test/diagnostico.js
```

## Datos

Todo se guarda en `data/guilds.json` (se crea solo): configuración, permisos, canales, récord, XP, estadísticas de cada usuario y los roles retirados pendientes de devolver. Se escribe de forma atómica, así que no se corrompe si cierras el bot a media escritura. Haz copia de ese archivo de vez en cuando.

## Estructura

```
src/
  index.js       arranque, eventos, registro de comandos
  config.js      valores por defecto y validación de ajustes
  store.js       persistencia en JSON
  utils.js       parseo de números, barra, duraciones, emojis
  levels.js      curva de niveles
  timeouts.js    cálculo del castigo
  sanciones.js   timeouts a admins: quitar y devolver roles
  permisos.js    quién puede usar cada comando
  counting.js    lógica del contador
  commands.js    comandos slash
test/
  simulacion.js  pruebas offline
  diagnostico.js revisión del servidor real
```

## Dejarlo corriendo siempre

Con [PM2](https://pm2.keymetrics.io/):

```bash
npm install -g pm2
```

```bash
pm2 start src/index.js --name mfc-contador && pm2 save
```

Ver los logs: `pm2 logs mfc-contador`. Reiniciar: `pm2 restart mfc-contador`.
