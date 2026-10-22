'use strict';

/**
 * Temporadas mensuales.
 *
 * Cada mes, el día `diaReinicio` (por defecto el 20) a las 00:00 de
 * `zonaHoraria`, se cierra la temporada:
 *   1. Se hace una copia de seguridad de todos los datos.
 *   2. Se archiva un resumen (top 10 de cada ranking y nivel de cada canal).
 *   3. Se borran el top, las estadísticas de los usuarios y el nivel del canal.
 *   4. Se anuncia en los canales de conteo.
 *
 * No se tocan: el número del contador, el récord, el histórico de cada usuario,
 * las infracciones (anti-spam) ni los castigos en curso.
 */

const store = require('./store');
const levels = require('./levels');
const { Panel } = require('./ui');

const COMPROBAR_MS = 60 * 1000;
const TEMPORADAS_GUARDADAS = 12;
const COLOR = 0xfee75c;

const formatos = new Map();
function formato(zona) {
  const clave = zona || '';
  if (!formatos.has(clave)) {
    formatos.set(
      clave,
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zona || undefined,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    );
  }
  return formatos.get(clave);
}

/** ¿Existe esta zona horaria? ('' = la del equipo) */
function zonaValida(zona) {
  if (!zona) return true;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

function fechaEn(ms, zona) {
  const p = Object.fromEntries(formato(zona).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { anio: Number(p.year), mes: Number(p.month), dia: Number(p.day) };
}

/**
 * Temporada a la que pertenece un momento: "AAAA-MM" del mes en que empezó.
 * Con el reinicio el 20, del 20 de marzo al 19 de abril es la temporada 2026-03.
 */
function periodoDe(ms, cfg) {
  const { anio, mes, dia } = fechaEn(ms, zonaValida(cfg.zonaHoraria) ? cfg.zonaHoraria : '');
  let a = anio;
  let m = mes;
  if (dia < cfg.diaReinicio) {
    m--;
    if (m === 0) {
      m = 12;
      a--;
    }
  }
  return `${a}-${String(m).padStart(2, '0')}`;
}

/** "2026-01" → "2025-12" */
function periodoAnterior(periodo) {
  const [a, m] = periodo.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

/** ¿Hay algo que archivar? */
function tieneDatos(g) {
  return (
    Object.values(g.usuarios).some((u) => u.aciertos || u.fallos || u.totalTimeoutMs) ||
    Object.values(g.canales).some((c) => c.xp || c.totalAciertos || c.totalFallos)
  );
}

/**
 * Cuándo empieza la próxima temporada (precisión de 15 minutos).
 * Se busca paso a paso, así que se guarda en caché hasta que llegue esa fecha:
 * los paneles lo piden en cada /contador y /top.
 */
const cacheProximo = new Map();
function proximoReinicio(cfg, desde = Date.now()) {
  const clave = `${cfg.diaReinicio}|${cfg.zonaHoraria}`;
  const guardado = cacheProximo.get(clave);
  if (guardado && guardado.desde <= desde && desde < guardado.t) return guardado.t;

  const PASO = 15 * 60 * 1000;
  const actual = periodoDe(desde, cfg);
  let t = desde - (desde % PASO);
  for (let i = 0; i < 40 * 24 * 4; i++) {
    t += PASO;
    if (periodoDe(t, cfg) !== actual) {
      cacheProximo.set(clave, { desde, t });
      return t;
    }
  }
  return null;
}

const NOMBRES_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** "2026-03" → "20 de marzo – 19 de abril de 2026" */
function nombrePeriodo(periodo, cfg) {
  const [a, m] = periodo.split('-').map(Number);
  const finMes = m === 12 ? 1 : m + 1;
  const finAnio = m === 12 ? a + 1 : a;
  const finDia = cfg.diaReinicio === 1 ? null : cfg.diaReinicio - 1;
  if (!finDia) return `${NOMBRES_MES[m - 1]} de ${a}`;
  return `${cfg.diaReinicio} de ${NOMBRES_MES[m - 1]} – ${finDia} de ${NOMBRES_MES[finMes - 1]} de ${finAnio}`;
}

/** Ranking de un campo de los usuarios. Lo usan /top y el resumen de la temporada. */
function top(usuarios, campo, n = 10) {
  return Object.entries(usuarios)
    .map(([id, u]) => ({ id, valor: u[campo] ?? 0 }))
    .filter((x) => x.valor > 0)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, n);
}

/** Resumen de la temporada que se cierra. */
function resumen(g, periodo, cfg) {
  const canales = {};
  for (const [id, c] of Object.entries(g.canales)) {
    canales[id] = {
      nivel: levels.calcular(c.xp, cfg).nivel,
      xp: c.xp,
      aciertos: c.totalAciertos,
      fallos: c.totalFallos,
      record: c.record,
    };
  }
  return {
    periodo,
    cerrada: Date.now(),
    top: {
      aciertos: top(g.usuarios, 'aciertos'),
      mejorRacha: top(g.usuarios, 'mejorRacha'),
      fallos: top(g.usuarios, 'fallos'),
    },
    canales,
  };
}

/** Borra las estadísticas de la temporada. El histórico se queda. */
function borrar(g) {
  for (const u of Object.values(g.usuarios)) {
    store.historico(u); // por si es un usuario de antes del histórico
    u.aciertos = 0;
    u.fallos = 0;
    u.rachaActual = 0;
    u.mejorRacha = 0;
    u.totalTimeoutMs = 0;
  }
  for (const c of Object.values(g.canales)) {
    store.historicoCanal(c);
    c.xp = 0;
    c.totalAciertos = 0;
    c.totalFallos = 0;
  }
}

async function anunciar(client, guildId, cerrada, cfg) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const ganadores = (lista, unidad) =>
    lista.length
      ? lista
          .slice(0, 3)
          .map((x, i) => `\`${i + 1}.\` <@${x.id}> — **${x.valor}** ${unidad}`)
          .join('\n')
      : 'Nadie.';

  const proximo = proximoReinicio(cfg);
  for (const canalId of Object.keys(store.getGuild(guildId).canales)) {
    const canal = guild.channels.cache.get(canalId);
    if (!canal?.isTextBased()) continue;

    const datosCanal = cerrada.canales[canalId];
    const panel = new Panel(COLOR)
      .cabecera('Nueva temporada', {
        subtitulo: `Se cerró la temporada **${nombrePeriodo(cerrada.periodo, cfg)}**.`,
      })
      .cita('El top, las estadísticas y el nivel del canal vuelven a cero. El contador sigue donde iba.')
      .separador();
    if (datosCanal) {
      panel.texto(`**Este canal llegó al nivel ${datosCanal.nivel}** con ${datosCanal.aciertos} aciertos.`);
    }
    panel
      .texto(`**Más aciertos**\n${ganadores(cerrada.top.aciertos, 'aciertos')}`)
      .texto(`**Mejor racha**\n${ganadores(cerrada.top.mejorRacha, 'seguidos')}`)
      .separador()
      .pie(proximo ? `Próximo reinicio <t:${Math.floor(proximo / 1000)}:D>` : 'Reinicio mensual');

    try {
      await canal.send(panel.mensaje());
    } catch (err) {
      console.warn(`[temporadas] No pude anunciar en ${canalId}: ${err.message}`);
    }
  }
}

/**
 * Cierra la temporada de un servidor si ya toca.
 * Devuelve el resumen archivado, o null si no había nada que hacer.
 */
function cerrarSiToca(guildId, ahora = Date.now()) {
  const g = store.getGuild(guildId);
  const cfg = store.getConfig(guildId);
  if (!cfg.reinicioMensual) return null;

  const actual = periodoDe(ahora, cfg);
  if (!g.periodo) {
    // Primera vez con temporadas. Si ya había estadísticas, son de antes del
    // último día de reinicio: se cierran como la temporada anterior. Un
    // servidor sin datos simplemente empieza aquí.
    if (!tieneDatos(g)) {
      g.periodo = actual;
      store.guardar();
      return null;
    }
    g.periodo = periodoAnterior(actual);
  }
  if (g.periodo === actual) return null;

  store.copia(`antes-temporada-${actual}`);

  const cerrada = resumen(g, g.periodo, cfg);
  if (!Array.isArray(g.temporadas)) g.temporadas = [];
  g.temporadas.push(cerrada);
  g.temporadas = g.temporadas.slice(-TEMPORADAS_GUARDADAS);

  borrar(g);
  g.periodo = actual;
  store.guardarAhora();
  console.log(`[temporadas] Temporada ${cerrada.periodo} cerrada en ${guildId}; empieza la ${actual}.`);
  return cerrada;
}

async function comprobar(client) {
  for (const guildId of Object.keys(store.db().guilds ?? {})) {
    const cerrada = cerrarSiToca(guildId);
    if (cerrada) await anunciar(client, guildId, cerrada, store.getConfig(guildId));
  }
}

/** Arranca la vigilancia. Se llama una vez, al conectar. */
function iniciar(client) {
  comprobar(client).catch((e) => console.error('[temporadas]', e.message));
  const i = setInterval(() => {
    comprobar(client).catch((e) => console.error('[temporadas]', e.message));
  }, COMPROBAR_MS);
  if (i.unref) i.unref();
  return i;
}

module.exports = {
  iniciar,
  cerrarSiToca,
  periodoDe,
  proximoReinicio,
  nombrePeriodo,
  zonaValida,
  top,
};
