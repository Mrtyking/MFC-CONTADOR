'use strict';

const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const store = require('./store');
const levels = require('./levels');
const sanciones = require('./sanciones');
const { calcularCastigo } = require('./timeouts');
const { parseNumero, formatDuracion, resolverEmoji } = require('./utils');

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

/** Motivos por los que se puede romper la cadena. */
const MOTIVO = {
  NUMERO: 'numero',
  TURNO: 'turno',
};

async function manejarMensaje(message) {
  if (!message.guild || message.author.bot || message.system) return;

  const cfg = store.getConfig(message.guild.id);
  const canal = store.getCanal(message.guild.id, message.channel.id);
  if (!canal) return; // este canal no es de conteo

  const numero = parseNumero(message.content);
  if (numero === null) {
    if (cfg.borrarInvalidos && message.deletable) {
      try {
        await message.delete();
      } catch {}
    }
    return;
  }

  const esperado = canal.actual + 1;
  const mismoUsuario = canal.ultimoUsuario === message.author.id;

  let motivo = null;
  if (numero !== esperado) motivo = MOTIVO.NUMERO;
  else if (mismoUsuario && !cfg.permitirRepetir) motivo = MOTIVO.TURNO;

  // --- Mutación de estado SÍNCRONA (antes de cualquier await) ---
  // Así dos mensajes casi simultáneos no pueden pisarse entre sí.
  const usuario = store.getUsuario(message.guild.id, message.author.id);

  if (!motivo) {
    const xpAntes = canal.xp;
    canal.actual = numero;
    canal.ultimoUsuario = message.author.id;
    canal.ultimoMensajeId = message.id;
    canal.totalAciertos++;
    canal.xp += cfg.xpPorAcierto;
    if (numero > canal.record) canal.record = numero;

    usuario.aciertos++;
    usuario.rachaActual++;
    if (usuario.rachaActual > usuario.mejorRacha) usuario.mejorRacha = usuario.rachaActual;
    store.guardar();

    // --- Efectos asíncronos ---
    await reaccionar(message, message.client, cfg.emojiOk, '✅');

    if (cfg.celebrarHitos && numero % 100 === 0) {
      await reaccionar(message, message.client, cfg.emojiHito, null);
    }

    const nivelNuevo = levels.subioDeNivel(xpAntes, canal.xp, cfg);
    if (nivelNuevo) {
      const info = levels.calcular(canal.xp, cfg);
      const embed = new EmbedBuilder()
        .setColor(COLOR_OK)
        .setTitle('¡Nivel alcanzado!')
        .setDescription(`El canal subió al **nivel ${nivelNuevo}**.`)
        .addFields({
          name: 'Progreso',
          value: `\`[${info.barra}] ${info.xp} / ${info.siguiente}\``,
        });
      try {
        await message.channel.send({ embeds: [embed] });
      } catch {}
    }
    return;
  }

  // --- Cadena rota ---
  const llegoHasta = canal.actual;
  const castigo = calcularCastigo({
    numeroArruinado: esperado,
    usuario,
    cfg,
  });

  usuario.fallos++;
  usuario.rachaActual = 0;
  usuario.infracciones = castigo.infracciones;
  usuario.ultimaInfraccion = Date.now();
  if (cfg.timeoutsActivos) usuario.totalTimeoutMs += castigo.ms;

  canal.actual = 0;
  canal.ultimoUsuario = null;
  canal.ultimoMensajeId = null;
  canal.totalFallos++;
  store.guardar();

  await reaccionar(message, message.client, cfg.emojiFail, '❌');

  // Timeout (si es admin, sanciones se encarga de quitarle los roles primero)
  let resultado = { ok: false, motivo: 'los timeouts están desactivados', metodo: null, roles: [] };
  if (cfg.timeoutsActivos) {
    if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      resultado = { ok: false, motivo: 'me falta el permiso Aislar miembros', metodo: null, roles: [] };
    } else {
      const member =
        message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
      resultado = member
        ? await sanciones.castigar(
            member,
            castigo.ms,
            `Rompió el contador en ${esperado} (infracción #${castigo.infracciones})`,
          )
        : { ok: false, motivo: 'ya no está en el servidor', metodo: null, roles: [] };
    }
  }

  // El motivo técnico va a la consola, no al canal: los usuarios no tienen
  // por qué leer por qué el bot no pudo silenciar a alguien.
  if (cfg.timeoutsActivos && !resultado.ok) {
    console.warn(
      `[timeout] No se pudo castigar a ${message.author.username} en ${message.guild.name}: ${resultado.motivo}`,
    );
  }

  const info = levels.calcular(canal.xp, cfg);
  const embed = new EmbedBuilder()
    .setColor(COLOR_FAIL)
    .setAuthor({
      name: message.author.username,
      iconURL: message.author.displayAvatarURL({ size: 64 }) || undefined,
    })
    .setTitle('Cadena rota')
    .setDescription(
      motivo === MOTIVO.TURNO
        ? `Envió \`${numero}\` — **no puedes contar dos veces seguidas**`
        : `Envió \`${numero}\` — se esperaba \`${esperado}\``,
    )
    .addFields(
      { name: 'Llegaron hasta', value: `\`${llegoHasta}\``, inline: true },
      { name: 'Récord', value: `\`${canal.record}\``, inline: true },
      {
        name: 'Timeout',
        value: resultado.ok ? `\`${formatDuracion(castigo.ms)}\`` : '`—`',
        inline: true,
      },
      ...(resultado.metodo === 'roles'
        ? [
            {
              name: 'Roles retirados',
              value: `\`${resultado.roles.length}\` · se los devuelvo cuando termine el castigo`,
              inline: false,
            },
          ]
        : []),
      {
        name: 'Infracciones',
        value:
          castigo.multiplicador > 1
            ? `\`${castigo.infracciones}\` · castigo \`×${castigo.multiplicador}\``
            : `\`${castigo.infracciones}\``,
        inline: false,
      },
      { name: 'Nivel', value: `\`[${info.barra}] ${info.xp} / ${info.siguiente}\``, inline: false },
    )
    .setFooter({ text: 'El contador vuelve a 1 · Respeta el turno' })
    .setTimestamp();

  try {
    await message.channel.send({ embeds: [embed] });
  } catch {}
}

/** Aviso cuando alguien borra el último número (para que nadie se pierda). */
async function manejarBorrado(message) {
  if (!message.guild || !message.author || message.author.bot) return;
  const cfg = store.getConfig(message.guild.id);
  if (!cfg.avisarBorrados) return;

  const canal = store.getCanal(message.guild.id, message.channelId);
  if (!canal || canal.ultimoMensajeId !== message.id) return;

  const embed = new EmbedBuilder()
    .setColor(COLOR_INFO)
    .setDescription(
      `<@${message.author.id}> borró su mensaje. El último número sigue siendo **${canal.actual}**, va el **${canal.actual + 1}**.`,
    );
  try {
    await message.channel.send({ embeds: [embed] });
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

  const embed = new EmbedBuilder()
    .setColor(COLOR_INFO)
    .setDescription(
      `<@${despues.author.id}> editó su número. No cuenta: el contador sigue en **${canal.actual}**, va el **${canal.actual + 1}**.`,
    );
  try {
    await despues.channel.send({ embeds: [embed] });
  } catch {}
}

module.exports = { manejarMensaje, manejarBorrado, manejarEdicion, COLOR_OK, COLOR_FAIL, COLOR_INFO };
