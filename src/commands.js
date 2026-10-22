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

const efimero = (contenido) => ({ content: contenido, flags: MessageFlags.Ephemeral });

/* ------------------------------------------------------------------ */
/* Definiciones                                                        */
/* ------------------------------------------------------------------ */

const definiciones = [
  new SlashCommandBuilder()
    .setName('setcanal')
    .setDescription('Define el canal donde se lleva el contador')
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
    .setName('quitarcanal')
    .setDescription('Deja de contar en un canal')
    .addChannelOption((o) => o.setName('canal').setDescription('Canal a quitar (por defecto, este)'))
    .addBooleanOption((o) =>
      o.setName('borrar_datos').setDescription('Borrar también récord, nivel y estadísticas'),
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
    .setName('quitartimeout')
    .setDescription('Quita el timeout y le devuelve los roles que se le retiraron')
    .addUserOption((o) => o.setName('usuario').setDescription('A quién').setRequired(true))
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('devolverroles')
    .setDescription('Devuelve los roles que se le retiraron, sin tocar el timeout')
    .addUserOption((o) => o.setName('usuario').setDescription('A quién').setRequired(true))
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('perdon')
    .setDescription('Quita el timeout, devuelve los roles y borra las infracciones acumuladas')
    .addUserOption((o) => o.setName('usuario').setDescription('A quién perdonar').setRequired(true))
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
    .setName('revisar')
    .setDescription('Comprueba si el bot puede castigar (permisos y jerarquía de roles)')
    .addUserOption((o) =>
      o.setName('usuario').setDescription('Comprobar si a esta persona se le puede castigar'),
    )
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
      `**Nivel ${info.nivel}**\n\`[${info.barra}] ${info.xp} / ${info.siguiente}\` · faltan \`${info.faltan}\``,
    )
    .botones(boton('mfc:contador:actualizar', 'Actualizar'), ...botonesConsulta())
    .pie(`${PIE} · Actualizado ${tsRelativo(Date.now())}`);
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
    panel.cita(`**Nivel del canal — ${info.nivel}**\n\`[${info.barra}] ${info.xp} / ${info.siguiente}\``);
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

  const sancion = sanciones.sancionDe(guildId, objetivo.id);
  if (sancion) {
    panel.separador().cita(
      `**Roles retirados (${sancion.roles.length})** · se le devuelven <t:${Math.floor(sancion.hasta / 1000)}:R>\n${(sancion.nombres ?? [])
        .slice(0, 10)
        .map((n) => `\`${n}\``)
        .join(', ')}`,
    );
  }

  return panel.pie(PIE);
}

function panelTop(guildId, tipo) {
  const g = store.getGuild(guildId);
  const lista = Object.entries(g.usuarios)
    .map(([id, u]) => ({ id, valor: u[tipo] ?? 0 }))
    .filter((x) => x.valor > 0)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 10);

  const texto = lista.length
    ? lista
        .map((x, i) => `\`${String(i + 1).padStart(2, ' ')}.\` <@${x.id}> — **${x.valor}**`)
        .join('\n')
    : 'Todavía no hay datos para este ranking.';

  return new Panel(COLOR_INFO)
    .cabecera(`Top ${TOPS[tipo].label}`)
    .cita('Los 10 mejores del servidor. Cambia de ranking en el menú.')
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
    .pie(PIE);
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
        .join('\n')}`;
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
          '**1.** Se cuenta de uno en uno en el canal configurado.',
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
 * Levanta el castigo: quita el timeout y devuelve los roles que se retiraron.
 * Lo comparten /quitartimeout y /perdon.
 */
async function levantarCastigo(interaction, { borrarInfracciones }) {
  const objetivo = interaction.options.getUser('usuario');
  const guild = interaction.guild;
  const razon = `Levantado por ${interaction.user.tag}`;
  const lineas = [];

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
  await interaction.reply(
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
    const permisos = canalDiscord.permissionsFor(yo);
    const faltan = [];
    if (!permisos?.has(PermissionFlagsBits.ViewChannel)) faltan.push('Ver canal');
    if (!permisos?.has(PermissionFlagsBits.SendMessages)) faltan.push('Enviar mensajes');
    if (!permisos?.has(PermissionFlagsBits.AddReactions)) faltan.push('Añadir reacciones');
    if (!permisos?.has(PermissionFlagsBits.ReadMessageHistory)) faltan.push('Leer historial');

    const g = store.getGuild(interaction.guild.id);
    const nuevo = !g.canales[canalDiscord.id];

    // Si el canal estuvo activo antes, se recupera su nivel y su récord
    if (nuevo && g.archivo?.[canalDiscord.id]) {
      g.canales[canalDiscord.id] = g.archivo[canalDiscord.id];
      delete g.archivo[canalDiscord.id];
    }

    const canal = store.getCanal(interaction.guild.id, canalDiscord.id, true);
    canal.actual = empezarEn;
    canal.ultimoUsuario = null;
    canal.ultimoMensajeId = null;
    if (empezarEn > canal.record) canal.record = empezarEn;
    store.guardar();

    const avisos = [];
    if (faltan.length) avisos.push(`Me faltan permisos ahí: **${faltan.join(', ')}**`);
    if (!resolverEmoji(interaction.client, cfg.emojiOk)) {
      avisos.push(
        `No encuentro el emoji \`${cfg.emojiOk}\`. Tengo que estar en el servidor donde vive ese emoji; mientras tanto reaccionaré con ✅.`,
      );
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      avisos.push(
        '**Sin permiso para timeouts.** Dame el permiso **Aislar miembros** (Moderate Members) o no podré castigar a quien rompa la cadena.',
      );
    }

    const panel = new Panel(COLOR_OK)
      .cabecera(nuevo ? 'Canal de conteo configurado' : 'Canal de conteo actualizado')
      .texto(
        `${canalDiscord} queda como canal del contador.\nEmpieza en **${empezarEn}**, o sea que toca el **${empezarEn + 1}**.`,
      );
    if (avisos.length) panel.separador().cita(avisos.join('\n'));

    await interaction.reply(panel.mensaje());
  },

  async quitarcanal(interaction) {
    const canalDiscord = interaction.options.getChannel('canal') ?? interaction.channel;
    const borrar = interaction.options.getBoolean('borrar_datos') ?? false;
    const g = store.getGuild(interaction.guild.id);

    if (!g.canales[canalDiscord.id]) {
      return interaction.reply(efimero(`${canalDiscord} no es un canal de conteo.`));
    }

    if (borrar) {
      delete g.canales[canalDiscord.id];
      if (g.archivo) delete g.archivo[canalDiscord.id];
    } else {
      // Se guarda a un lado: si vuelven a activar el canal, recuperan nivel y récord
      if (!g.archivo) g.archivo = {};
      g.archivo[canalDiscord.id] = g.canales[canalDiscord.id];
      delete g.canales[canalDiscord.id];
    }
    store.guardar();

    await interaction.reply(
      aviso(
        COLOR_INFO,
        'Canal quitado',
        `Ya no llevo el contador en ${canalDiscord}.` +
          (borrar ? ' Datos borrados.' : ' Guardé el nivel y el récord por si lo reactivas.'),
      ).mensaje(),
    );
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

  async quitartimeout(interaction) {
    await levantarCastigo(interaction, { borrarInfracciones: false });
  },

  async perdon(interaction) {
    await levantarCastigo(interaction, { borrarInfracciones: true });
  },

  async devolverroles(interaction) {
    const objetivo = interaction.options.getUser('usuario');
    const sancion = sanciones.sancionDe(interaction.guild.id, objetivo.id);

    if (!sancion) {
      return interaction.reply(
        efimero(`<@${objetivo.id}> no tiene ningún rol retirado por mí.`),
      );
    }

    const r = await sanciones.devolver(
      interaction.guild,
      objetivo.id,
      `Devueltos a mano por ${interaction.user.tag}`,
    );

    await interaction.reply(
      aviso(
        r.ok ? COLOR_OK : COLOR_FAIL,
        r.ok ? 'Roles devueltos' : 'No pude devolver los roles',
        r.ok
          ? `Roles devueltos a <@${objetivo.id}>: ${(sancion.nombres ?? [])
              .map((n) => `\`${n}\``)
              .join(', ')}\n-# Sigue con el timeout puesto, si lo tenía.`
          : `No pude devolvérselos: ${r.motivo}`,
      ).mensaje(),
    );
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

  async revisar(interaction) {
    const guild = interaction.guild;
    const yo = guild.members.me;
    const miPos = yo.roles.highest.position;

    const check = (b) => (b ? '`Sí`' : '`No`');
    const panel = new Panel(COLOR_INFO)
      .cabecera('Revisión del bot',{ imagen: interaction.client.user.displayAvatarURL({ size: 128 }) })
      .separador()
      .texto(
        [
          '**Permisos**',
          `${check(yo.permissions.has(PermissionFlagsBits.ModerateMembers))} Aislar miembros — dar timeouts`,
          `${check(yo.permissions.has(PermissionFlagsBits.ManageRoles))} Gestionar roles — castigar administradores`,
          `${check(yo.permissions.has(PermissionFlagsBits.AddReactions))} Añadir reacciones`,
        ].join('\n'),
      );

    const porEncima = guild.roles.cache.filter(
      (r) => r.position > miPos && !r.managed && r.id !== guild.id,
    );
    panel.separador().texto(
      `**Jerarquía**\nMi rol está en la posición \`${miPos}\`.\n` +
        (porEncima.size
          ? `Hay **${porEncima.size} roles por encima del mío**. A quien tenga uno de esos no puedo tocarlo, ni siendo admin.\n\n**Arrastra mi rol arriba del todo** en Ajustes del servidor → Roles.`
          : 'Mi rol está por encima de todos. Puedo castigar a cualquiera menos al dueño.'),
    );

    const objetivo = interaction.options.getUser('usuario');
    if (objetivo) {
      const member = await guild.members.fetch(objetivo.id).catch(() => null);
      let veredicto;
      if (!member) {
        veredicto = '**No.** No está en el servidor.';
      } else {
        const impedimento = sanciones.bloqueo(member);
        const esAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
        const suPos = member.roles.highest.position;

        if (impedimento) {
          veredicto = `**No.** ${impedimento[0].toUpperCase()}${impedimento.slice(1)}.`;
          if (impedimento.includes('por encima')) {
            veredicto += `\nSu rol está en \`${suPos}\` y el mío en \`${miPos}\`. Necesito estar por encima de \`${suPos}\`.`;
          }
        } else if (esAdmin) {
          const soloAdmin = store.getConfig(guild.id).quitarSoloRolesAdmin !== false;
          const quitables = sanciones.rolesQuitables(member, soloAdmin);
          veredicto = quitables.size
            ? `**Sí.** Es administrador, así que le quitaría ${quitables.size} rol(es) — ${quitables
                .map((r) => `\`${r.name}\``)
                .join(', ')} — aplicaría el timeout y se los devolvería al terminar. El resto de sus roles no se tocan.`
            : '**No.** Es administrador y no tengo ningún rol suyo que pueda quitar.';
        } else {
          veredicto = '**Sí.** Timeout normal, sin tocarle los roles.';
        }
      }
      panel.separador().cita(`**¿Puedo castigar a ${objetivo.username}?**\n${veredicto}`);
    }

    await interaction.reply(panel.mensaje({ efimero: true }));
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
