'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  MessageFlags,
  InteractionContextType,
} = require('discord.js');

const store = require('./store');
const levels = require('./levels');
const { DEFAULTS, ESQUEMA } = require('./config');
const { formatDuracion, tsRelativo, resolverEmoji } = require('./utils');
const { COLOR_OK, COLOR_FAIL, COLOR_INFO } = require('./counting');
const permisos = require('./permisos');
const sanciones = require('./sanciones');
const { Panel, boton, desplegable, aviso } = require('./ui');
const temporadas = require('./temporadas');

const efimero = (contenido) => ({ content: contenido, flags: MessageFlags.Ephemeral });

/* ------------------------------------------------------------------ */
/* Definiciones                                                        */
/* ------------------------------------------------------------------ */

const definiciones = [
  new SlashCommandBuilder()
    .setName('setcanal')
    .setDescription('Define el canal del contador (si ya había otro, se mueve a este)')
    .addChannelOption((o) =>
      o
        .setName('canal')
        .setDescription('Canal del contador (por defecto, este)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread),
    )
    .addIntegerOption((o) =>
      o
        .setName('empezar_en')
        .setDescription('Número en el que ya va el conteo (por defecto 0, o sea que toca el 1)')
        .setMinValue(0),
    )
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('contador')
    .setDescription('Muestra cómo va el contador y el nivel del canal')
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('nivel')
    .setDescription('Nivel del canal y estadísticas de un usuario')
    .addUserOption((o) => o.setName('usuario').setDescription('De quién (por defecto, tú)'))
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('top')
    .setDescription('Ranking del servidor')
    .addStringOption((o) =>
      o
        .setName('tipo')
        .setDescription('Qué ranking mostrar')
        .addChoices(
          { name: 'Aciertos', value: 'aciertos' },
          { name: 'Mejor racha', value: 'mejorRacha' },
          { name: 'Fallos', value: 'fallos' },
        ),
    )
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('reiniciar')
    .setDescription('Reinicia el contador del canal')
    .addIntegerOption((o) =>
      o.setName('numero').setDescription('Dejar el contador en este número (por defecto 0)').setMinValue(0),
    )
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('perdon')
    .setDescription('Quita el timeout y devuelve los roles retirados')
    .addUserOption((o) => o.setName('usuario').setDescription('A quién perdonar').setRequired(true))
    .addBooleanOption((o) =>
      o
        .setName('borrar_infracciones')
        .setDescription('Borrar también las infracciones acumuladas (por defecto sí)'),
    )
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('permisos')
    .setDescription('Quién puede usar cada comando')
    .addSubcommand((s) => s.setName('ver').setDescription('Lista quién puede usar qué'))
    .addSubcommand((s) =>
      s
        .setName('rol')
        .setDescription('Añade o quita un rol con permiso de administración del bot')
        .addStringOption((o) =>
          o
            .setName('accion')
            .setDescription('Qué hacer')
            .setRequired(true)
            .addChoices({ name: 'Añadir', value: 'añadir' }, { name: 'Quitar', value: 'quitar' }),
        )
        .addRoleOption((o) => o.setName('rol').setDescription('Qué rol').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('comando')
        .setDescription('Hace un comando público o administrativo')
        .addStringOption((o) =>
          o
            .setName('comando')
            .setDescription('Qué comando')
            .setRequired(true)
            .addChoices(...Object.keys(permisos.NIVELES).map((k) => ({ name: `/${k}`, value: k }))),
        )
        .addStringOption((o) =>
          o
            .setName('nivel')
            .setDescription('Quién podrá usarlo')
            .setRequired(true)
            .addChoices(
              { name: 'Público (todos)', value: 'publico' },
              { name: 'Administrativo (solo los roles con permiso)', value: 'admin' },
            ),
        ),
    )
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Ajustes del bot en este servidor')
    .addSubcommand((s) => s.setName('ver').setDescription('Muestra la configuración actual'))
    .addSubcommand((s) =>
      s
        .setName('poner')
        .setDescription('Cambia un ajuste')
        .addStringOption((o) =>
          o
            .setName('ajuste')
            .setDescription('Qué ajuste cambiar')
            .setRequired(true)
            .addChoices(...Object.keys(ESQUEMA).slice(0, 25).map((k) => ({ name: k, value: k }))),
        )
        .addStringOption((o) =>
          o.setName('valor').setDescription('Nuevo valor (true/false, un número o una URL)').setRequired(true),
        ),
    )
    .addSubcommand((s) => s.setName('reset').setDescription('Vuelve a los valores por defecto'))
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('ayuda')
    .setDescription('Cómo funciona el contador')
    .setContexts(InteractionContextType.Guild),
].map((c) => c.toJSON());

/* ------------------------------------------------------------------ */
/* Paneles (los comparten los comandos y los botones)                  */
/* ------------------------------------------------------------------ */

const PIE = '© MFC Contador';

const TOPS = {
  aciertos: { label: 'Aciertos' },
  mejorRacha: { label: 'Mejor racha' },
  fallos: { label: 'Fallos' },
};

/** Botones que van debajo de los paneles públicos. */
const botonesConsulta = () => [
  boton('mfc:nivel', 'Mi nivel'),
  boton('mfc:top', 'Top'),
  boton('mfc:ayuda', 'Ayuda'),
];

function panelContador(guildId, canalId, client) {
  const cfg = store.getConfig(guildId);
  const canal = store.getCanal(guildId, canalId);
  if (!canal) return null;

  const info = levels.calcular(canal.xp, cfg);
  return new Panel(COLOR_OK)
    .banner(cfg.banner)
    .cabecera('Contador', {
      subtitulo: `Toca el **${canal.actual + 1}**`,
      imagen: client.user?.displayAvatarURL({ size: 128 }),
    })
    .separador()
    .campos([
      ['Actual', `\`${canal.actual}\``],
      ['Récord', `\`${canal.record}\``],
      ['Último', canal.ultimoUsuario ? `<@${canal.ultimoUsuario}>` : '`—`'],
      ['Aciertos', `\`${canal.totalAciertos}\``],
      ['Cadenas rotas', `\`${canal.totalFallos}\``],
    ])
    .separador()
    .cita(
      `**Nivel ${info.nivel}**\n\`[${info.barra}] ${info.actual} / ${info.necesario}\` · faltan \`${info.faltan}\``,
    )
    .botones(boton('mfc:contador:actualizar', 'Actualizar'), ...botonesConsulta())
    .pie(`${PIE} · ${textoTemporada(cfg)} · Actualizado ${tsRelativo(Date.now())}`);
}

/** "Temporada hasta <fecha>" para los pies de los paneles. */
function textoTemporada(cfg) {
  if (!cfg.reinicioMensual) return 'Sin reinicio mensual';
  const proximo = temporadas.proximoReinicio(cfg);
  return proximo ? `Se reinicia ${tsRelativo(proximo)}` : `Se reinicia el ${cfg.diaReinicio} de cada mes`;
}

function panelNivel(guildId, canalId, objetivo) {
  const cfg = store.getConfig(guildId);
  const g = store.getGuild(guildId);
  const u = g.usuarios[objetivo.id];
  const canal = store.getCanal(guildId, canalId) ?? g.canales[Object.keys(g.canales)[0]];

  const panel = new Panel(COLOR_INFO).cabecera(objetivo.username, {
    subtitulo: `Estadísticas de <@${objetivo.id}>`,
    imagen: objetivo.displayAvatarURL({ size: 128 }),
  });

  if (canal) {
    const info = levels.calcular(canal.xp, cfg);
    panel.cita(`**Nivel del canal — ${info.nivel}**\n\`[${info.barra}] ${info.actual} / ${info.necesario}\``);
  }

  panel.separador();

  if (!u) return panel.texto('Todavía no ha contado nada.').pie(PIE);

  const ventanaMs = cfg.ventanaSpamMin * 60 * 1000;
  const infraccionesVivas =
    u.ultimaInfraccion && Date.now() - u.ultimaInfraccion <= ventanaMs ? u.infracciones : 0;

  panel.campos([
    ['Aciertos', `\`${u.aciertos}\``],
    ['Fallos', `\`${u.fallos}\``],
    ['Mejor racha', `\`${u.mejorRacha}\``],
    ['Racha actual', `\`${u.rachaActual}\``],
    [
      'Infracciones activas',
      infraccionesVivas ? `\`${infraccionesVivas}\` · última ${tsRelativo(u.ultimaInfraccion)}` : '`0`',
    ],
    ['Tiempo silenciado', `\`${formatDuracion(u.totalTimeoutMs)}\``],
  ]);

  const h = store.historico(u);
  panel
    .separador()
    .cita(
      `**Histórico** (no se borra cada mes)\nAciertos \`${h.aciertos}\` · Fallos \`${h.fallos}\` · Mejor racha \`${h.mejorRacha}\` · Silenciado \`${formatDuracion(h.totalTimeoutMs)}\``,
    );

  const sancion = sanciones.sancionDe(guildId, objetivo.id);
  if (sancion) {
    panel.separador().cita(
      `**Roles retirados (${sancion.roles.length})** · se le devuelven <t:${Math.floor(sancion.hasta / 1000)}:R>\n${(sancion.nombres ?? [])
        .slice(0, 10)
        .map((n) => `\`${n}\``)
        .join(', ')}`,
    );
  }

  return panel.pie(`${PIE} · Temporada actual · ${textoTemporada(cfg)}`);
}

function panelTop(guildId, tipo) {
  const cfg = store.getConfig(guildId);
  const lista = temporadas.top(store.getGuild(guildId).usuarios, tipo);

  const texto = lista.length
    ? lista
        .map((x, i) => `\`${String(i + 1).padStart(2, ' ')}.\` <@${x.id}> — **${x.valor}**`)
        .join('\n')
    : 'Todavía no hay datos para este ranking.';

  return new Panel(COLOR_INFO)
    .cabecera(`Top ${TOPS[tipo].label}`)
    .cita('Los 10 mejores de la temporada. Cambia de ranking en el menú.')
    .separador()
    .texto(texto)
    .separador()
    .menu(
      desplegable(
        'mfc:top:menu',
        'Elige un ranking',
        Object.entries(TOPS).map(([value, t]) => ({ value, label: t.label })),
        tipo,
      ),
    )
    .pie(`${PIE} · ${textoTemporada(cfg)}`);
}

/** Secciones de /ayuda. Cada una sale con su botón y en el menú. */
const AYUDA = {
  inicio: { label: 'Inicio', resumen: 'Cómo se juega' },
  timeouts: { label: 'Timeouts', resumen: 'Cuánto dura el castigo según el número' },
  reincidencia: { label: 'Reincidencia', resumen: 'Qué pasa si la rompes otra vez' },
  niveles: { label: 'Niveles', resumen: 'Cómo sube de nivel el canal' },
  admins: { label: 'Admins', resumen: 'Por qué los admins tampoco se salvan' },
  comandos: { label: 'Comandos', resumen: 'Todo lo que puedes usar' },
};

function contenidoAyuda(guildId, seccion) {
  const cfg = store.getConfig(guildId);
  const ejemplo = (n) =>
    `\`${n}\` → ${formatDuracion(Math.max(cfg.timeoutMinimoMin, Math.round(n * cfg.minutosPorNumero)) * 60000)}`;

  switch (seccion) {
    case 'timeouts':
      return `${cfg.minutosPorNumero} minuto(s) por número, mínimo ${cfg.timeoutMinimoMin}.\n\n${[4, 30, 120, 500]
        .map(ejemplo)
        .join('\n')}`;
    case 'reincidencia':
      return `Si vuelves a romperla antes de ${formatDuracion(cfg.ventanaSpamMin * 60000)}, el castigo se multiplica **×${cfg.multiplicadorSpam}** cada vez (tope ×${cfg.maxMultiplicadorSpam}).\n\nSi aguantas esa ventana sin romper nada, vuelves al castigo normal.`;
    case 'niveles':
      return `Cada acierto da ${cfg.xpPorAcierto} XP al canal. Cada nivel cuesta más que el anterior:\n\n${[0, 1, 2, 3, 4]
        .map((n) => `\`nivel ${n} → ${n + 1}\` ${levels.xpParaSubir(n, cfg)} XP`)
        .join('\n')}\n\nLos niveles no tienen tope.${
        cfg.reinicioMensual
          ? ` El día ${cfg.diaReinicio} de cada mes empieza una temporada nueva: el nivel, el top y las estadísticas vuelven a cero (el contador sigue donde iba). Tu histórico no se borra.`
          : ''
      }`;
    case 'admins':
      return 'No. Discord ignora el timeout de los administradores, así que el bot les quita los roles primero, aplica el castigo y **se los devuelve solo** cuando termina.\n\nAl dueño del servidor no se le puede tocar (eso es límite de Discord).';
    case 'comandos':
      return `${Object.keys(permisos.NIVELES)
        .map((cmd) => `\`/${cmd}\`${permisos.nivelDe(guildId, cmd) === permisos.ADMIN ? '*' : ''}`)
        .join('  ')}\n\n-# * = solo para los roles con permiso`;
    default:
      return null;
  }
}

function panelAyuda(guildId, seccion = 'inicio') {
  const cfg = store.getConfig(guildId);
  const actual = AYUDA[seccion] ? seccion : 'inicio';
  const panel = new Panel(COLOR_INFO);

  if (actual === 'inicio') {
    panel
      .banner(cfg.banner)
      .cabecera('Cómo funciona el contador')
      .cita('Elige una sección abajo para ver los detalles.')
      .separador()
      .texto(
        [
          '**¿Cómo se juega?**',
          '**1.** Se cuenta de uno en uno en el canal configurado. Vale escribirlo como quieras: `7`, `3+4`, `siete` o `seven`.',
          `**2.** ${cfg.permitirRepetir ? 'Puedes contar seguido.' : 'No puedes contar dos veces seguidas: hay que respetar el turno.'}`,
          '**3.** Si el número está mal, la cadena se rompe, vuelve al 1 y quien la rompió se lleva un timeout.',
        ].join('\n'),
      )
      .separador()
      .cita(
        Object.entries(AYUDA)
          .filter(([k]) => k !== 'inicio')
          .map(([, s]) => `**${s.label}:** ${s.resumen}.`)
          .join('\n'),
      );
  } else {
    const s = AYUDA[actual];
    panel
      .cabecera(s.label)
      .cita(`${s.resumen}.`)
      .separador()
      .texto(contenidoAyuda(guildId, actual));
  }

  return panel
    .botones(
      Object.entries(AYUDA)
        .filter(([k]) => k !== 'inicio')
        .slice(0, 5)
        .map(([k, s]) => boton(`mfc:ayuda:${k}`, s.label, null, k === actual)),
    )
    .menu(
      desplegable(
        'mfc:ayuda:menu',
        'Elige una opción',
        Object.entries(AYUDA).map(([value, s]) => ({
          value,
          label: s.label,
          description: s.resumen,
        })),
        actual,
      ),
    )
    .pie(`${PIE} · Todos los derechos reservados.`);
}

/* ------------------------------------------------------------------ */
/* Handlers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Levanta el castigo de /perdon: quita el timeout, devuelve los roles que se
 * retiraron y, si se pide, borra las infracciones acumuladas.
 */
async function levantarCastigo(interaction, { borrarInfracciones }) {
  const objetivo = interaction.options.getUser('usuario');
  const guild = interaction.guild;
  const razon = `Levantado por ${interaction.user.tag}`;
  const lineas = [];

  // Son varias llamadas a Discord y pueden pasar de los 3 s que da para responder
  await interaction.deferReply();

  const member = await guild.members.fetch(objetivo.id).catch(() => null);

  // 1. Quitar el timeout
  if (!member) {
    lineas.push('· No está en el servidor.');
  } else if (member.communicationDisabledUntilTimestamp) {
    try {
      await member.timeout(null, razon);
      lineas.push('· Timeout retirado.');
    } catch (err) {
      lineas.push(`· No pude retirar el timeout: ${err.message}`);
    }
  } else {
    lineas.push('· No tenía timeout activo.');
  }

  // 2. Devolver los roles retirados
  const sancion = sanciones.sancionDe(guild.id, objetivo.id);
  if (sancion) {
    const r = await sanciones.devolver(guild, objetivo.id, razon);
    lineas.push(
      r.ok
        ? `· Roles devueltos (${r.roles.length}): ${sancion.nombres?.slice(0, 10).map((n) => `\`${n}\``).join(', ') ?? ''}`
        : `· No pude devolver los roles: ${r.motivo}`,
    );
  } else {
    lineas.push('· No tenía roles retirados.');
  }

  // 3. Borrar el historial de infracciones
  if (borrarInfracciones) {
    const g = store.getGuild(guild.id);
    const u = g.usuarios[objetivo.id];
    if (u) {
      u.infracciones = 0;
      u.ultimaInfraccion = 0;
      store.guardar();
    }
    lineas.push('· Infracciones borradas: el próximo castigo vuelve a ser el normal.');
  }

  const fallo = lineas.some((l) => l.includes('No pude'));
  await interaction.editReply(
    new Panel(fallo ? COLOR_FAIL : COLOR_OK)
      .cabecera(borrarInfracciones ? 'Perdonado' : 'Timeout retirado', {
        subtitulo: `<@${objetivo.id}>`,
        imagen: objetivo.displayAvatarURL({ size: 128 }),
      })
      .separador()
      .texto(lineas.join('\n'))
      .mensaje(),
  );
}

const handlers = {
  async setcanal(interaction) {
    const canalDiscord = interaction.options.getChannel('canal') ?? interaction.channel;
    const empezarEn = interaction.options.getInteger('empezar_en') ?? 0;
    const cfg = store.getConfig(interaction.guild.id);

    const yo = interaction.guild.members.me;
    const enCanal = canalDiscord.permissionsFor(yo);
    const faltan = [];
    if (!enCanal?.has(PermissionFlagsBits.ViewChannel)) faltan.push('Ver canal');
    if (!enCanal?.has(PermissionFlagsBits.SendMessages)) faltan.push('Enviar mensajes');
    if (!enCanal?.has(PermissionFlagsBits.AddReactions)) faltan.push('Añadir reacciones');
    if (!enCanal?.has(PermissionFlagsBits.ReadMessageHistory)) faltan.push('Leer historial');

    // Un solo canal por servidor: si estaba en otro, se mueve aquí con sus datos
    const nuevo = !store.getCanal(interaction.guild.id, canalDiscord.id);
    const anteriores = store.ponerCanalUnico(interaction.guild.id, canalDiscord.id);

    const canal = store.getCanal(interaction.guild.id, canalDiscord.id);
    canal.actual = empezarEn;
    canal.ultimoUsuario = null;
    canal.ultimoMensajeId = null;
    if (empezarEn > canal.record) canal.record = empezarEn;
    store.guardar();

    const avisos = [];
    if (faltan.length) avisos.push(`Me faltan permisos ahí: **${faltan.join(', ')}**`);
    for (const [emoji, respaldo] of [
      [cfg.emojiOk, '✅'],
      [cfg.emojiFail, '❌'],
    ]) {
      if (!resolverEmoji(interaction.client, emoji)) {
        avisos.push(
          `No encuentro el emoji \`${emoji}\`. Tengo que estar en el servidor donde vive ese emoji; mientras tanto reaccionaré con ${respaldo}.`,
        );
      }
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      avisos.push(
        '**Sin permiso para timeouts.** Dame el permiso **Aislar miembros** (Moderate Members) o no podré castigar a quien rompa la cadena.',
      );
    }

    const panel = new Panel(COLOR_OK)
      .cabecera(nuevo ? 'Canal de conteo configurado' : 'Canal de conteo actualizado')
      .texto(
        `${canalDiscord} queda como canal del contador.\nEmpieza en **${empezarEn}**, o sea que toca el **${empezarEn + 1}**.` +
          (anteriores.length
            ? `\n\nYa no cuento en ${anteriores.map((id) => `<#${id}>`).join(', ')}: el nivel, el récord y las estadísticas pasan a este canal.`
            : ''),
      );
    if (avisos.length) panel.separador().cita(avisos.join('\n'));

    await interaction.reply(panel.mensaje());
  },

  async contador(interaction) {
    const panel = panelContador(interaction.guild.id, interaction.channel.id, interaction.client);

    if (!panel) {
      const otros = Object.keys(store.getGuild(interaction.guild.id).canales);
      return interaction.reply(
        efimero(
          otros.length
            ? `Este canal no es de conteo. Prueba en: ${otros.map((id) => `<#${id}>`).join(', ')}`
            : 'Todavía no hay ningún canal de conteo. Usa `/setcanal`.',
        ),
      );
    }

    await interaction.reply(panel.mensaje());
  },

  async nivel(interaction) {
    const objetivo = interaction.options.getUser('usuario') ?? interaction.user;
    await interaction.reply(panelNivel(interaction.guild.id, interaction.channel.id, objetivo).mensaje());
  },

  async top(interaction) {
    const tipo = interaction.options.getString('tipo') ?? 'aciertos';
    await interaction.reply(panelTop(interaction.guild.id, tipo).mensaje());
  },

  async reiniciar(interaction) {
    const numero = interaction.options.getInteger('numero') ?? 0;
    const canal = store.getCanal(interaction.guild.id, interaction.channel.id);
    if (!canal) return interaction.reply(efimero('Este canal no es de conteo.'));

    canal.actual = numero;
    canal.ultimoUsuario = null;
    canal.ultimoMensajeId = null;
    store.guardar();

    await interaction.reply(
      aviso(COLOR_INFO, 'Contador reiniciado', `Ahora va el **${numero + 1}**.`).mensaje(),
    );
  },

  async perdon(interaction) {
    const borrarInfracciones = interaction.options.getBoolean('borrar_infracciones') ?? true;
    await levantarCastigo(interaction, { borrarInfracciones });
  },

  async permisos(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'ver') {
      const roles = permisos.rolesAdmin(interaction.guild.id);
      const porNivel = { publico: [], admin: [] };
      for (const cmd of Object.keys(permisos.NIVELES)) {
        porNivel[permisos.nivelDe(interaction.guild.id, cmd)].push(`\`/${cmd}\``);
      }

      return interaction.reply(
        new Panel(COLOR_INFO)
          .cabecera('Permisos')
          .cita('Quién puede usar cada comando del bot.')
          .separador()
          .texto(
            `**Roles con permiso de administración**\n${roles.length ? roles.map((id) => `<@&${id}>`).join('\n') : '— (ninguno)'}`,
          )
          .texto(`**Dueño del bot (siempre puede)**\n<@${permisos.DUENO_BOT}>`)
          .separador()
          .texto(`**Comandos públicos**\n${porNivel.publico.join(' ') || '—'}`)
          .texto(`**Comandos administrativos**\n${porNivel.admin.join(' ') || '—'}`)
          .pie('Cámbialo con /permisos rol y /permisos comando')
          .mensaje({ efimero: true }),
      );
    }

    if (sub === 'rol') {
      const accion = interaction.options.getString('accion');
      const rol = interaction.options.getRole('rol');
      const hecho =
        accion === 'añadir'
          ? permisos.añadirRol(interaction.guild.id, rol.id)
          : permisos.quitarRol(interaction.guild.id, rol.id);

      if (!hecho) {
        return interaction.reply(
          efimero(
            accion === 'añadir'
              ? `${rol} ya tenía permiso.`
              : `${rol} no estaba en la lista.`,
          ),
        );
      }
      return interaction.reply(
        aviso(
          COLOR_OK,
          'Permisos actualizados',
          accion === 'añadir'
            ? `${rol} ya puede usar los comandos administrativos.`
            : `${rol} ya no puede usar los comandos administrativos.`,
        ).mensaje(),
      );
    }

    // comando
    const cmd = interaction.options.getString('comando');
    const nivel = interaction.options.getString('nivel');
    permisos.ponerNivel(interaction.guild.id, cmd, nivel);
    await interaction.reply(
      aviso(
        COLOR_OK,
        'Permisos actualizados',
        nivel === 'publico'
          ? `\`/${cmd}\` ahora lo puede usar cualquiera.`
          : `\`/${cmd}\` ahora es solo para los roles con permiso.`,
      ).mensaje(),
    );
  },

  async config(interaction) {
    const sub = interaction.options.getSubcommand();
    const g = store.getGuild(interaction.guild.id);

    if (sub === 'ver') {
      const cfg = store.getConfig(interaction.guild.id);
      const lineas = Object.keys(ESQUEMA).map((k) => {
        const cambiado = Object.prototype.hasOwnProperty.call(g.config, k);
        return `${cambiado ? '•' : ' '} ${k.padEnd(20)} ${cfg[k] === '' ? '—' : cfg[k]}`;
      });
      const canales = Object.keys(g.canales);
      return interaction.reply(
        new Panel(COLOR_INFO)
          .cabecera('Configuración')
          .texto(`\`\`\`\n${lineas.join('\n')}\n\`\`\``)
          .pie('• = cambiado por ti')
          .separador()
          .texto(`**Canales de conteo**\n${canales.length ? canales.map((id) => `<#${id}>`).join(', ') : '—'}`)
          .mensaje({ efimero: true }),
      );
    }

    if (sub === 'reset') {
      g.config = {};
      store.guardar();
      return interaction.reply(efimero('Configuración devuelta a los valores por defecto.'));
    }

    // poner
    const clave = interaction.options.getString('ajuste');
    const bruto = interaction.options.getString('valor').trim();
    const esquema = ESQUEMA[clave];
    if (!esquema) return interaction.reply(efimero(`El ajuste \`${clave}\` no existe.`));

    let valor;
    if (esquema.tipo === 'bool') {
      const v = bruto.toLowerCase();
      if (!['true', 'false', 'si', 'sí', 'no', '1', '0'].includes(v)) {
        return interaction.reply(efimero(`\`${clave}\` solo acepta \`true\` o \`false\`.`));
      }
      valor = ['true', 'si', 'sí', '1'].includes(v);
    } else if (esquema.tipo === 'num') {
      valor = Number(bruto);
      if (!Number.isFinite(valor)) {
        return interaction.reply(efimero(`\`${clave}\` necesita un número.`));
      }
      if (valor < esquema.min || valor > esquema.max) {
        return interaction.reply(
          efimero(`\`${clave}\` tiene que estar entre ${esquema.min} y ${esquema.max}.`),
        );
      }
    } else if (esquema.tipo === 'zona') {
      valor = ['no', 'ninguna', '-', 'local'].includes(bruto.toLowerCase()) ? '' : bruto;
      if (!temporadas.zonaValida(valor)) {
        return interaction.reply(
          efimero(`\`${bruto}\` no es una zona horaria válida. Ejemplos: \`America/Santo_Domingo\`, \`Europe/Madrid\`.`),
        );
      }
    } else if (esquema.tipo === 'url') {
      if (['no', 'ninguno', 'quitar', '-', 'false'].includes(bruto.toLowerCase())) {
        valor = '';
      } else if (/^https?:\/\/\S+$/i.test(bruto)) {
        valor = bruto;
      } else {
        return interaction.reply(
          efimero(`\`${clave}\` necesita una URL que empiece por \`https://\` (o \`no\` para quitarlo).`),
        );
      }
    } else {
      valor = bruto;
    }

    g.config[clave] = valor;
    store.guardar();

    await interaction.reply(
      efimero(`\`${clave}\` = \`${valor || '—'}\`  (antes: \`${DEFAULTS[clave] || '—'}\` por defecto)`),
    );
  },

  async ayuda(interaction) {
    await interaction.reply(panelAyuda(interaction.guild.id).mensaje({ efimero: true }));
  },
};

/* ------------------------------------------------------------------ */
/* Botones y menús                                                     */
/* ------------------------------------------------------------------ */

/**
 * customId = "mfc:<comando>[:<arg>]". El <comando> decide el permiso, igual
 * que si se hubiera escrito el slash command.
 *   · Lo que cambia la vista del propio panel se hace con update().
 *   · Lo que abre algo nuevo desde un panel público sale efímero, para no
 *     llenar el canal.
 */
function comandoDe(customId) {
  const [prefijo, comando] = customId.split(':');
  return prefijo === 'mfc' ? comando : null;
}

async function manejarComponente(interaction) {
  const [, comando, arg] = interaction.customId.split(':');
  const guildId = interaction.guild.id;

  // Al editar un mensaje efímero hay que repetir el flag, o deja de serlo
  const enSuSitio = (panel) =>
    interaction.update(
      panel.mensaje({ efimero: interaction.message.flags.has(MessageFlags.Ephemeral) }),
    );

  if (comando === 'contador' && arg === 'actualizar') {
    const panel = panelContador(guildId, interaction.channel.id, interaction.client);
    if (!panel) return interaction.reply(efimero('Este canal ya no es de conteo.'));
    return enSuSitio(panel);
  }

  if (comando === 'nivel') {
    return interaction.reply(
      panelNivel(guildId, interaction.channel.id, interaction.user).mensaje({ efimero: true }),
    );
  }

  if (comando === 'top') {
    if (arg === 'menu') return enSuSitio(panelTop(guildId, interaction.values[0]));
    return interaction.reply(panelTop(guildId, 'aciertos').mensaje({ efimero: true }));
  }

  if (comando === 'ayuda') {
    if (arg === 'menu') return enSuSitio(panelAyuda(guildId, interaction.values[0]));
    if (arg) return enSuSitio(panelAyuda(guildId, arg));
    return interaction.reply(panelAyuda(guildId).mensaje({ efimero: true }));
  }
}

module.exports = { definiciones, handlers, comandoDe, manejarComponente };
