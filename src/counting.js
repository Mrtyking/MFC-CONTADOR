'use strict';

const { PermissionFlagsBits } = require('discord.js');
const store = require('./store');
const levels = require('./levels');
const sanciones = require('./sanciones');
const { calcularCastigo } = require('./timeouts');
const { parseNumero, formatDuracion, resolverEmoji } = require('./utils');
const { leerNumero } = require('./numeros');
const { Panel, boton, aviso } = require('./ui');
const { DUENO_BOT } = require('./permisos');

const COLOR_OK = 0x57f287;
const COLOR_FAIL = 0xed4245;
const COLOR_INFO = 0x5865f2;

/** Reacciona sin reventar si el emoji no existe o faltan permisos. */
async function reaccionar(message, client, valor, respaldo) {
  const emoji = resolverEmoji(client, valor);
  try {
    if (emoji) return await message.react(emoji);
  } catch {}
  if (respaldo) {
    try {
      await message.react(respaldo);
    } catch {}
  }
  return null;
}

/**
 * Aplica un timeout (si es admin, sanciones le quita los roles primero) y lo
 * suma al tiempo silenciado solo si se aplicó de verdad. Lo técnico va a la
 * consola, no al canal. Devuelve { ok, ... }.
 */
async function silenciar(message, usuario, ms, razon) {
  let resultado;
  if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    resultado = { ok: false, motivo: 'me falta el permiso Aislar miembros' };
  } else {
    const member =
      message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    resultado = member
      ? await sanciones.castigar(member, ms, razon)
      : { ok: false, motivo: 'ya no está en el servidor' };
  }

  if (resultado.ok) {
    usuario.totalTimeoutMs += ms;
    store.historico(usuario).totalTimeoutMs += ms;
    store.guardar();
    if (resultado.metodo === 'roles') {
      console.log(
        `[timeout] ${message.author.username} es admin: retirados ${resultado.roles.length} rol(es) — ${resultado.roles
          .map((r) => r.nombre)
          .join(', ')}`,
      );
    }
  } else {
    console.warn(
      `[timeout] No se pudo castigar a ${message.author.username} en ${message.guild.name}: ${resultado.motivo}`,
    );
  }
  return resultado;
}

/** Motivos por los que se puede romper la cadena. */
const MOTIVO = {
  NUMERO: 'numero', // número equivocado: castigo suave
  TURNO: 'turno', // contó dos veces seguidas: castigo suave
  HABLADERA: 'habladera', // escribió algo que no es un número: castigo fuerte
};

async function manejarMensaje(message) {
  if (!message.guild || message.author.bot || message.system) return;

  const cfg = store.getConfig(message.guild.id);
  const canal = store.getCanal(message.guild.id, message.channel.id);
  if (!canal) return; // este canal no es de conteo

  // Cifras, cuentas (1+1) o palabras (veintitrés, twenty-one). Cualquier otra
  // cosa (charla, "?", una imagen…) se borra y cuenta como romper la cadena.
  const leido = leerNumero(message.content);
  const numero = leido?.valor ?? null;

  const esperado = canal.actual + 1;
  const mismoUsuario = canal.ultimoUsuario === message.author.id;

  let motivo = null;
  if (!leido) motivo = MOTIVO.HABLADERA;
  else if (numero !== esperado) motivo = MOTIVO.NUMERO;
  else if (mismoUsuario && !cfg.permitirRepetir) motivo = MOTIVO.TURNO;

  // --- Mutación de estado SÍNCRONA (antes de cualquier await) ---
  // Así dos mensajes casi simultáneos no pueden pisarse entre sí.
  const usuario = store.getUsuario(message.guild.id, message.author.id);
  const historico = store.historico(usuario);
  const historicoCanal = store.historicoCanal(canal);

  if (!motivo) {
    const xpAntes = canal.xp;
    canal.actual = numero;
    canal.ultimoUsuario = message.author.id;
    canal.ultimoMensajeId = message.id;
    canal.totalAciertos++;
    canal.xp += cfg.xpPorAcierto;
    if (numero > canal.record) canal.record = numero;
    historicoCanal.aciertos++;

    usuario.aciertos++;
    usuario.rachaActual++;
    if (usuario.rachaActual > usuario.mejorRacha) usuario.mejorRacha = usuario.rachaActual;
    historico.aciertos++;
    if (usuario.rachaActual > historico.mejorRacha) historico.mejorRacha = usuario.rachaActual;
    store.guardar();

    // --- Efectos asíncronos ---
    // Las reacciones van en orden (check y luego hito), pero a la vez que el
    // aviso de nivel, para que el canal responda rápido.
    const reacciones = reaccionar(message, message.client, cfg.emojiOk, '✅').then(() =>
      cfg.celebrarHitos && numero % 100 === 0
        ? reaccionar(message, message.client, cfg.emojiHito, null)
        : null,
    );

    const nivelNuevo = levels.subioDeNivel(xpAntes, canal.xp, cfg);
    let aviso = null;
    if (nivelNuevo) {
      const info = levels.calcular(canal.xp, cfg);
      const panel = new Panel(COLOR_OK)
        .cabecera('¡Nivel alcanzado!', { subtitulo: `El canal subió al **nivel ${nivelNuevo}**.` })
        .separador()
        .cita(`\`[${info.barra}] ${info.actual} / ${info.necesario}\``);
      aviso = message.channel.send(panel.mensaje()).catch(() => {});
    }
    await Promise.all([reacciones, aviso]);
    return;
  }

  // --- Cadena rota ---
  // El dueño del bot rompe la cadena como cualquiera, pero sin timeout ni
  // infracciones. Al resto se le castiga siempre.
  const exento = message.author.id === DUENO_BOT;
  const castigable = cfg.timeoutsActivos && !exento;
  const habladera = motivo === MOTIVO.HABLADERA;

  const llegoHasta = canal.actual;
  const castigo = calcularCastigo({
    numeroArruinado: esperado,
    usuario,
    cfg,
    habladera,
  });

  usuario.fallos++;
  usuario.rachaActual = 0;
  if (!exento) {
    usuario.infracciones = castigo.infracciones;
    usuario.ultimaInfraccion = Date.now();
  }
  historico.fallos++;

  canal.actual = 0;
  canal.ultimoUsuario = null;
  canal.ultimoMensajeId = null;
  canal.totalFallos++;
  historicoCanal.fallos++;
  store.guardar();

  // Mientras se aplica el castigo: reacción si era un número, borrado si no
  const efecto = habladera
    ? cfg.borrarInvalidos && message.deletable
      ? message.delete().catch(() => {})
      : null
    : reaccionar(message, message.client, cfg.emojiFail, '❌');

  const resultado = castigable
    ? await silenciar(
        message,
        usuario,
        castigo.ms,
        habladera
          ? `Escribió algo que no es un número en el contador (infracción #${castigo.infracciones})`
          : `Rompió el contador en ${esperado} (infracción #${castigo.infracciones})`,
      )
    : { ok: false };
  await efecto;

  let subtitulo;
  if (habladera) {
    subtitulo = `**${message.author.username}** escribió algo que no es un número. **Aquí solo se cuenta.**`;
  } else {
    // Si escribió una cuenta o palabras, se ve lo que puso y lo que vale: `1+1` (= 2)
    const texto = leido.texto.replace(/`/g, "'").slice(0, 40);
    const enviado = texto === String(numero) ? `\`${numero}\`` : `\`${texto}\` (= ${numero})`;
    subtitulo =
      motivo === MOTIVO.TURNO
        ? `**${message.author.username}** envió ${enviado} — **no puedes contar dos veces seguidas**`
        : `**${message.author.username}** envió ${enviado} — se esperaba \`${esperado}\``;
  }

  const info = levels.calcular(canal.xp, cfg);
  const panel = new Panel(COLOR_FAIL)
    .cabecera('Cadena rota', {
      subtitulo,
      imagen: message.author.displayAvatarURL({ size: 128 }) || undefined,
    })
    .separador()
    .campos([
      ['Llegaron hasta', `\`${llegoHasta}\``],
      ['Récord', `\`${canal.record}\``],
      ['Timeout', resultado.ok ? `\`${formatDuracion(castigo.ms)}\`` : '`—`'],
      [
        'Infracciones',
        exento
          ? `\`${usuario.infracciones ?? 0}\``
          : castigo.multiplicador > 1
            ? `\`${castigo.infracciones}\` · castigo \`×${castigo.multiplicador}\``
            : `\`${castigo.infracciones}\``,
      ],
      ['Nivel', `\`[${info.barra}] ${info.actual} / ${info.necesario}\``],
    ])
    .separador()
    .botones(boton('mfc:nivel', 'Mi nivel'), boton('mfc:top', 'Top'))
    .pie(`El contador vuelve a 1 · Respeta el turno · <t:${Math.floor(Date.now() / 1000)}:t>`);

  try {
    await message.channel.send(panel.mensaje());
  } catch {}
}

/** Aviso cuando alguien borra el último número (para que nadie se pierda). */
async function manejarBorrado(message) {
  if (!message.guild || !message.author || message.author.bot) return;
  const cfg = store.getConfig(message.guild.id);
  if (!cfg.avisarBorrados) return;

  const canal = store.getCanal(message.guild.id, message.channelId);
  if (!canal || canal.ultimoMensajeId !== message.id) return;

  const panel = aviso(
    COLOR_INFO,
    'Número borrado',
    `<@${message.author.id}> borró su mensaje. El último número sigue siendo **${canal.actual}**, va el **${canal.actual + 1}**.`,
  );
  try {
    await message.channel.send(panel.mensaje());
  } catch {}
}

/** Aviso cuando alguien edita el último número. */
async function manejarEdicion(_antes, despues) {
  if (!despues.guild || !despues.author || despues.author.bot) return;
  const cfg = store.getConfig(despues.guild.id);
  if (!cfg.avisarBorrados) return;

  const canal = store.getCanal(despues.guild.id, despues.channelId);
  if (!canal || canal.ultimoMensajeId !== despues.id) return;

  const numero = parseNumero(despues.content ?? '');
  if (numero === canal.actual) return; // no cambió el número

  const panel = aviso(
    COLOR_INFO,
    'Número editado',
    `<@${despues.author.id}> editó su número. No cuenta: el contador sigue en **${canal.actual}**, va el **${canal.actual + 1}**.`,
  );
  try {
    await despues.channel.send(panel.mensaje());
  } catch {}
}

module.exports = { manejarMensaje, manejarBorrado, manejarEdicion, COLOR_OK, COLOR_FAIL, COLOR_INFO };
