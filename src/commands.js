'use strict';

const {
  SlashCommandBuilder,
  EmbedBuilder,
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
          o.setName('valor').setDescription('Nuevo valor (true/false o un número)').setRequired(true),
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
  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(fallo ? COLOR_FAIL : COLOR_OK)
        .setTitle(borrarInfracciones ? 'Perdonado' : 'Timeout retirado')
        .setDescription(`<@${objetivo.id}>\n${lineas.join('\n')}`),
    ],
  });
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

    const emoji = resolverEmoji(interaction.client, cfg.emojiOk);
    const avisoEmoji = emoji
      ? ''
      : `\n⚠️ No encuentro el emoji \`${cfg.emojiOk}\`. Tengo que estar en el servidor donde vive ese emoji; mientras tanto reaccionaré con ✅.`;

    const embed = new EmbedBuilder()
      .setColor(COLOR_OK)
      .setTitle(nuevo ? 'Canal de conteo configurado' : 'Canal de conteo actualizado')
      .setDescription(
        `${canalDiscord} queda como canal del contador.\nEmpieza en **${empezarEn}**, o sea que toca el **${empezarEn + 1}**.` +
          (faltan.length ? `\n\n⚠️ Me faltan permisos ahí: **${faltan.join(', ')}**` : '') +
          avisoEmoji,
      );

    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      embed.addFields({
        name: '⚠️ Sin permiso para timeouts',
        value: 'Dame el permiso **Aislar miembros** (Moderate Members) o no podré castigar a quien rompa la cadena.',
      });
    }

    await interaction.reply({ embeds: [embed] });
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

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_INFO)
          .setDescription(
            `Ya no llevo el contador en ${canalDiscord}.` +
              (borrar ? ' Datos borrados.' : ' Guardé el nivel y el récord por si lo reactivas.'),
          ),
      ],
    });
  },

  async contador(interaction) {
    const cfg = store.getConfig(interaction.guild.id);
    const g = store.getGuild(interaction.guild.id);
    const canal = store.getCanal(interaction.guild.id, interaction.channel.id);

    if (!canal) {
      const otros = Object.keys(g.canales);
      return interaction.reply(
        efimero(
          otros.length
            ? `Este canal no es de conteo. Prueba en: ${otros.map((id) => `<#${id}>`).join(', ')}`
            : 'Todavía no hay ningún canal de conteo. Usa `/setcanal`.',
        ),
      );
    }

    const info = levels.calcular(canal.xp, cfg);
    const embed = new EmbedBuilder()
      .setColor(COLOR_OK)
      .setTitle('Contador')
      .setDescription(`Va el **${canal.actual + 1}**`)
      .addFields(
        { name: 'Actual', value: `\`${canal.actual}\``, inline: true },
        { name: 'Récord', value: `\`${canal.record}\``, inline: true },
        {
          name: 'Último',
          value: canal.ultimoUsuario ? `<@${canal.ultimoUsuario}>` : '`—`',
          inline: true,
        },
        { name: 'Aciertos', value: `\`${canal.totalAciertos}\``, inline: true },
        { name: 'Cadenas rotas', value: `\`${canal.totalFallos}\``, inline: true },
        { name: 'Nivel', value: `\`${info.nivel}\``, inline: true },
        {
          name: 'Progreso',
          value: `\`[${info.barra}] ${info.xp} / ${info.siguiente}\`  ·  faltan \`${info.faltan}\``,
        },
      );

    await interaction.reply({ embeds: [embed] });
  },

  async nivel(interaction) {
    const cfg = store.getConfig(interaction.guild.id);
    const objetivo = interaction.options.getUser('usuario') ?? interaction.user;
    const g = store.getGuild(interaction.guild.id);
    const u = g.usuarios[objetivo.id];

    const canal =
      store.getCanal(interaction.guild.id, interaction.channel.id) ??
      g.canales[Object.keys(g.canales)[0]];

    const embed = new EmbedBuilder()
      .setColor(COLOR_INFO)
      .setAuthor({ name: objetivo.username, iconURL: objetivo.displayAvatarURL({ size: 64 }) });

    if (canal) {
      const info = levels.calcular(canal.xp, cfg);
      embed.addFields({
        name: `Nivel del canal — ${info.nivel}`,
        value: `\`[${info.barra}] ${info.xp} / ${info.siguiente}\``,
      });
    }

    if (!u) {
      embed.setDescription('Todavía no ha contado nada.');
      return interaction.reply({ embeds: [embed] });
    }

    const ventanaMs = cfg.ventanaSpamMin * 60 * 1000;
    const infraccionesVivas =
      u.ultimaInfraccion && Date.now() - u.ultimaInfraccion <= ventanaMs ? u.infracciones : 0;

    embed.addFields(
      { name: 'Aciertos', value: `\`${u.aciertos}\``, inline: true },
      { name: 'Fallos', value: `\`${u.fallos}\``, inline: true },
      { name: 'Mejor racha', value: `\`${u.mejorRacha}\``, inline: true },
      { name: 'Racha actual', value: `\`${u.rachaActual}\``, inline: true },
      {
        name: 'Infracciones activas',
        value: infraccionesVivas
          ? `\`${infraccionesVivas}\` · última ${tsRelativo(u.ultimaInfraccion)}`
          : '`0`',
        inline: true,
      },
      { name: 'Tiempo silenciado', value: `\`${formatDuracion(u.totalTimeoutMs)}\``, inline: true },
    );

    const sancion = sanciones.sancionDe(interaction.guild.id, objetivo.id);
    if (sancion) {
      embed.addFields({
        name: `Roles retirados (${sancion.roles.length})`,
        value: `Se le devuelven <t:${Math.floor(sancion.hasta / 1000)}:R>\n${(sancion.nombres ?? [])
          .slice(0, 10)
          .map((n) => `\`${n}\``)
          .join(', ')}`,
      });
    }

    await interaction.reply({ embeds: [embed] });
  },

  async top(interaction) {
    const tipo = interaction.options.getString('tipo') ?? 'aciertos';
    const g = store.getGuild(interaction.guild.id);
    const etiquetas = { aciertos: 'Aciertos', mejorRacha: 'Mejor racha', fallos: 'Fallos' };

    const lista = Object.entries(g.usuarios)
      .map(([id, u]) => ({ id, valor: u[tipo] ?? 0 }))
      .filter((x) => x.valor > 0)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10);

    if (!lista.length) {
      return interaction.reply(efimero('Todavía no hay datos para el ranking.'));
    }

    const medallas = ['🥇', '🥈', '🥉'];
    const texto = lista
      .map((x, i) => `${medallas[i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``} <@${x.id}> — **${x.valor}**`)
      .join('\n');

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_INFO)
          .setTitle(`Top ${etiquetas[tipo]}`)
          .setDescription(texto),
      ],
    });
  },

  async reiniciar(interaction) {
    const numero = interaction.options.getInteger('numero') ?? 0;
    const canal = store.getCanal(interaction.guild.id, interaction.channel.id);
    if (!canal) return interaction.reply(efimero('Este canal no es de conteo.'));

    canal.actual = numero;
    canal.ultimoUsuario = null;
    canal.ultimoMensajeId = null;
    store.guardar();

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_INFO)
          .setDescription(`Contador reiniciado. Ahora va el **${numero + 1}**.`),
      ],
    });
  },

  async quitartimeout(interaction) {
    await levantarCastigo(interaction, { borrarInfracciones: false });
  },

  async perdon(interaction) {
    await levantarCastigo(interaction, { borrarInfracciones: true });
  },

  async permisos(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'ver') {
      const roles = permisos.rolesAdmin(interaction.guild.id);
      const porNivel = { publico: [], admin: [] };
      for (const cmd of Object.keys(permisos.NIVELES)) {
        porNivel[permisos.nivelDe(interaction.guild.id, cmd)].push(`\`/${cmd}\``);
      }

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_INFO)
            .setTitle('Permisos')
            .addFields(
              {
                name: 'Roles con permiso de administración',
                value: roles.length ? roles.map((id) => `<@&${id}>`).join('\n') : '— (ninguno)',
              },
              { name: 'Dueño del bot (siempre puede)', value: `<@${permisos.DUENO_BOT}>` },
              { name: 'Comandos públicos', value: porNivel.publico.join(' ') || '—' },
              { name: 'Comandos administrativos', value: porNivel.admin.join(' ') || '—' },
            )
            .setFooter({ text: 'Cámbialo con /permisos rol y /permisos comando' }),
        ],
        flags: MessageFlags.Ephemeral,
      });
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
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_OK)
            .setDescription(
              accion === 'añadir'
                ? `${rol} ya puede usar los comandos administrativos.`
                : `${rol} ya no puede usar los comandos administrativos.`,
            ),
        ],
      });
    }

    // comando
    const cmd = interaction.options.getString('comando');
    const nivel = interaction.options.getString('nivel');
    permisos.ponerNivel(interaction.guild.id, cmd, nivel);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR_OK)
          .setDescription(
            nivel === 'publico'
              ? `\`/${cmd}\` ahora lo puede usar cualquiera.`
              : `\`/${cmd}\` ahora es solo para los roles con permiso.`,
          ),
      ],
    });
  },

  async config(interaction) {
    const sub = interaction.options.getSubcommand();
    const g = store.getGuild(interaction.guild.id);

    if (sub === 'ver') {
      const cfg = store.getConfig(interaction.guild.id);
      const lineas = Object.keys(ESQUEMA).map((k) => {
        const cambiado = Object.prototype.hasOwnProperty.call(g.config, k);
        return `${cambiado ? '•' : ' '} ${k.padEnd(20)} ${cfg[k]}`;
      });
      const canales = Object.keys(g.canales);
      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_INFO)
            .setTitle('Configuración')
            .setDescription(`\`\`\`\n${lineas.join('\n')}\n\`\`\`\n• = cambiado por ti`)
            .addFields({
              name: 'Canales de conteo',
              value: canales.length ? canales.map((id) => `<#${id}>`).join(', ') : '—',
            }),
        ],
        flags: MessageFlags.Ephemeral,
      });
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
    } else {
      valor = bruto;
    }

    g.config[clave] = valor;
    store.guardar();

    await interaction.reply(
      efimero(`\`${clave}\` = \`${valor}\`  (antes: \`${DEFAULTS[clave]}\` por defecto)`),
    );
  },

  async revisar(interaction) {
    const guild = interaction.guild;
    const yo = guild.members.me;
    const miPos = yo.roles.highest.position;

    const check = (b) => (b ? '✅' : '❌');
    const embed = new EmbedBuilder().setColor(COLOR_INFO).setTitle('Revisión del bot');

    embed.addFields({
      name: 'Permisos',
      value: [
        `${check(yo.permissions.has(PermissionFlagsBits.ModerateMembers))} Aislar miembros — dar timeouts`,
        `${check(yo.permissions.has(PermissionFlagsBits.ManageRoles))} Gestionar roles — castigar administradores`,
        `${check(yo.permissions.has(PermissionFlagsBits.AddReactions))} Añadir reacciones`,
      ].join('\n'),
    });

    const porEncima = guild.roles.cache.filter(
      (r) => r.position > miPos && !r.managed && r.id !== guild.id,
    );
    embed.addFields({
      name: 'Jerarquía',
      value:
        `Mi rol está en la posición \`${miPos}\`.\n` +
        (porEncima.size
          ? `❌ Hay **${porEncima.size} roles por encima del mío**. A quien tenga uno de esos no puedo tocarlo, ni siendo admin.\n\n**Arrastra mi rol arriba del todo** en Ajustes del servidor → Roles.`
          : '✅ Mi rol está por encima de todos. Puedo castigar a cualquiera menos al dueño.'),
    });

    const objetivo = interaction.options.getUser('usuario');
    if (objetivo) {
      const member = await guild.members.fetch(objetivo.id).catch(() => null);
      if (!member) {
        embed.addFields({ name: `¿Puedo castigar a ${objetivo.username}?`, value: '❌ No está en el servidor.' });
      } else {
        const impedimento = sanciones.bloqueo(member);
        const esAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
        const suPos = member.roles.highest.position;

        let veredicto;
        if (impedimento) {
          veredicto = `❌ **No.** ${impedimento[0].toUpperCase()}${impedimento.slice(1)}.`;
          if (impedimento.includes('por encima')) {
            veredicto += `\nSu rol está en \`${suPos}\` y el mío en \`${miPos}\`. Necesito estar por encima de \`${suPos}\`.`;
          }
        } else if (esAdmin) {
          const soloAdmin = store.getConfig(guild.id).quitarSoloRolesAdmin !== false;
          const quitables = sanciones.rolesQuitables(member, soloAdmin);
          veredicto = quitables.size
            ? `✅ **Sí.** Es administrador, así que le quitaría ${quitables.size} rol(es) — ${quitables
                .map((r) => `\`${r.name}\``)
                .join(', ')} — aplicaría el timeout y se los devolvería al terminar. El resto de sus roles no se tocan.`
            : '❌ Es administrador y no tengo ningún rol suyo que pueda quitar.';
        } else {
          veredicto = '✅ **Sí.** Timeout normal, sin tocarle los roles.';
        }

        embed.addFields({ name: `¿Puedo castigar a ${objetivo.username}?`, value: veredicto });
      }
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  async ayuda(interaction) {
    const cfg = store.getConfig(interaction.guild.id);
    const ejemplo = (n) =>
      `\`${n}\` → ${formatDuracion(
        Math.max(cfg.timeoutMinimoMin, Math.round(n * cfg.minutosPorNumero)) * 60000,
      )}`;

    const embed = new EmbedBuilder()
      .setColor(COLOR_INFO)
      .setTitle('Cómo funciona el contador')
      .setDescription(
        [
          '**1.** Se cuenta de uno en uno en el canal configurado.',
          `**2.** ${cfg.permitirRepetir ? 'Puedes contar seguido.' : 'No puedes contar dos veces seguidas: hay que respetar el turno.'}`,
          '**3.** Si el número está mal, la cadena se rompe, vuelve al 1 y quien la rompió se lleva un timeout.',
        ].join('\n'),
      )
      .addFields(
        {
          name: 'Timeout según el número',
          value: `${cfg.minutosPorNumero} minuto(s) por número, mínimo ${cfg.timeoutMinimoMin}.\n${[4, 30, 120, 500].map(ejemplo).join('\n')}`,
        },
        {
          name: 'Reincidencia',
          value: `Si vuelves a romperla antes de ${formatDuracion(cfg.ventanaSpamMin * 60000)}, el castigo se multiplica ×${cfg.multiplicadorSpam} cada vez (tope ×${cfg.maxMultiplicadorSpam}).\nSi aguantas esa ventana sin romper nada, vuelves al castigo normal.`,
        },
        {
          name: 'Niveles',
          value: `Cada acierto da ${cfg.xpPorAcierto} XP al canal. Cada nivel cuesta más que el anterior:\n${[0, 1, 2, 3, 4]
            .map((n) => `nivel ${n}→${n + 1}: ${levels.xpParaSubir(n, cfg)} XP`)
            .join(' · ')}`,
        },
        {
          name: 'Y si eres admin, ¿te salvas?',
          value:
            'No. Discord ignora el timeout de los administradores, así que el bot les quita los roles primero, aplica el castigo y **se los devuelve solo** cuando termina. Al dueño del servidor no se le puede tocar (eso es límite de Discord).',
        },
        {
          name: 'Comandos',
          value: Object.entries(permisos.NIVELES)
            .map(([cmd]) => {
              const nivel = permisos.nivelDe(interaction.guild.id, cmd);
              return `\`/${cmd}\`${nivel === permisos.ADMIN ? '🔒' : ''}`;
            })
            .join(' ')
            .concat('\n🔒 = solo para los roles con permiso'),
        },
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

module.exports = { definiciones, handlers };
