'use strict';

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  IntentsBitField,
} = require('discord.js');
const store = require('./store');
const permisos = require('./permisos');
const sanciones = require('./sanciones');
const { definiciones, handlers, comandoDe, manejarComponente } = require('./commands');
const { manejarMensaje, manejarBorrado, manejarEdicion } = require('./counting');

const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
  console.error('Falta DISCORD_TOKEN en el archivo .env');
  process.exit(1);
}

store.cargar();

const INTENTS_BASE = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent, // intent privilegiado: hay que activarlo en el portal
];

// GuildMembers es opcional: con él el bot se entera al instante de que alguien
// levantó un timeout a mano. Sin él lo detecta igual, pero en el barrido de
// cada 30 s. Si no está activado en el portal, se arranca sin él.
const client = new Client({
  intents: [...INTENTS_BASE, GatewayIntentBits.GuildMembers],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

/** Permisos que necesita el bot para funcionar entero. */
const PERMISOS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageRoles, // para poder castigar también a los administradores
].reduce((a, b) => a | b, 0n);

/** Registra los comandos en un servidor (aparecen al instante, sin esperar 1 h). */
async function registrarEn(guild) {
  try {
    await guild.commands.set(definiciones);
    console.log(`[comandos] Registrados en ${guild.name} (${guild.id})`);
  } catch (err) {
    console.error(`[comandos] Error en ${guild.id}: ${err.message}`);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Conectado como ${c.user.tag}`);
  console.log(
    `Invitación: https://discord.com/api/oauth2/authorize?client_id=${c.user.id}&permissions=${PERMISOS}&scope=bot%20applications.commands`,
  );

  c.user.setActivity('el contador · /ayuda');

  for (const guild of c.guilds.cache.values()) {
    await registrarEn(guild);
  }

  // Devuelve los roles de los castigos que vencieron mientras el bot estaba apagado
  sanciones.iniciar(c);

  for (const guild of c.guilds.cache.values()) {
    const g = store.getGuild(guild.id);
    for (const [id, canal] of Object.entries(g.canales)) {
      console.log(`[estado] #${guild.channels.cache.get(id)?.name ?? id}: va por ${canal.actual}, récord ${canal.record}`);
    }
  }

  console.log(`Listo en ${c.guilds.cache.size} servidor(es).`);
});

client.on(Events.GuildCreate, (guild) => registrarEn(guild));

client.on(Events.InteractionCreate, async (interaction) => {
  // Botones y menús de los paneles: piden el mismo permiso que su comando
  if ((interaction.isButton() || interaction.isStringSelectMenu()) && interaction.inGuild()) {
    const comando = comandoDe(interaction.customId);
    if (!comando) return;

    const permiso = permisos.puede(interaction, comando);
    if (!permiso.ok) {
      return interaction
        .reply({ content: permiso.motivo, flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }

    try {
      await manejarComponente(interaction);
    } catch (err) {
      console.error(`[botón ${interaction.customId}]`, err);
      const aviso = { content: 'Ups, algo falló con ese botón.', flags: MessageFlags.Ephemeral };
      try {
        if (interaction.deferred || interaction.replied) await interaction.followUp(aviso);
        else await interaction.reply(aviso);
      } catch {}
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const handler = handlers[interaction.commandName];
  if (!handler) return;

  const permiso = permisos.puede(interaction, interaction.commandName);
  if (!permiso.ok) {
    return interaction
      .reply({ content: permiso.motivo, flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }

  try {
    await handler(interaction);
  } catch (err) {
    console.error(`[comando ${interaction.commandName}]`, err);
    const aviso = { content: 'Ups, algo falló ejecutando ese comando.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(aviso);
      else await interaction.reply(aviso);
    } catch {}
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await manejarMensaje(message);
  } catch (err) {
    console.error('[mensaje]', err);
  }
});

client.on(Events.MessageDelete, async (message) => {
  try {
    if (message.partial) return; // sin contenido no se puede saber si era el último número
    await manejarBorrado(message);
  } catch (err) {
    console.error('[borrado]', err);
  }
});

// Alguien levantó un timeout a mano desde Discord: devolverle los roles ya
client.on(Events.GuildMemberUpdate, async (antes, despues) => {
  try {
    await sanciones.alCambiarMiembro(antes, despues);
  } catch (err) {
    console.error('[miembro]', err);
  }
});

client.on(Events.MessageUpdate, async (antes, despues) => {
  try {
    if (despues.partial) await despues.fetch().catch(() => null);
    if (despues.partial) return;
    await manejarEdicion(antes, despues);
  } catch (err) {
    console.error('[edición]', err);
  }
});

client.on(Events.Error, (err) => console.error('[cliente]', err));
process.on('unhandledRejection', (err) => console.error('[promesa]', err));

let cerrando = false;
async function apagar(senal) {
  if (cerrando) return;
  cerrando = true;
  console.log(`\n${senal}: guardando datos y cerrando...`);
  store.guardarAhora();
  await client.destroy().catch(() => {});
  process.exitCode = 0;
  // Si algo se queda colgado, salimos igual
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => apagar('SIGINT'));
process.on('SIGTERM', () => apagar('SIGTERM'));

async function arrancar() {
  try {
    await client.login(TOKEN);
    return;
  } catch (err) {
    if (!/disallowed intents/i.test(err.message)) throw err;
  }

  // El portal no tiene activado SERVER MEMBERS: se arranca sin ese intent.
  console.warn(
    '[intents] SERVER MEMBERS INTENT está desactivado en el portal.\n' +
      '          El bot funciona igual, pero tardará hasta 30 s en devolver los roles\n' +
      '          cuando alguien levante un timeout a mano. Para que sea instantáneo,\n' +
      '          actívalo en Portal → tu app → Bot → Privileged Gateway Intents.',
  );
  client.options.intents = new IntentsBitField(INTENTS_BASE);
  await client.login(TOKEN);
}

arrancar().catch(async (err) => {
  console.error('No pude iniciar sesión:', err.message);
  if (/intent/i.test(err.message)) {
    console.error(
      'Activa MESSAGE CONTENT INTENT en https://discord.com/developers/applications → tu app → Bot → Privileged Gateway Intents.',
    );
  } else {
    console.error('Revisa DISCORD_TOKEN en el archivo .env (Portal → tu app → Bot → Reset Token).');
  }
  store.guardarAhora();
  await client.destroy().catch(() => {});
  process.exitCode = 1;
});
