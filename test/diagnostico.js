'use strict';

/**
 * Revisa que el bot tenga todo lo que necesita en el servidor.
 *   node test/diagnostico.js
 */

require('dotenv').config();
const { PermissionsBitField, PermissionFlagsBits } = require('discord.js');
const { DEFAULTS } = require('../src/config');

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;

async function api(ruta) {
  const r = await fetch(`https://discord.com/api/v10${ruta}`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  if (!r.ok) throw new Error(`${ruta} → HTTP ${r.status} ${JSON.stringify(await r.json())}`);
  return r.json();
}

const marca = (ok) => (ok ? '  OK  ' : ' FALTA');

(async () => {
  if (!TOKEN || !GUILD) {
    console.error('Faltan DISCORD_TOKEN o DISCORD_GUILD_ID en .env');
    process.exit(1);
  }

  const yo = await api('/users/@me');
  console.log(`\nBot: ${yo.username} (${yo.id})`);

  const guild = await api(`/guilds/${GUILD}`);
  console.log(`Servidor: ${guild.name}\n`);

  const roles = await api(`/guilds/${GUILD}/roles`);
  const miembro = await api(`/guilds/${GUILD}/members/${yo.id}`);
  const misRoles = roles.filter((r) => miembro.roles.includes(r.id));

  let bits = BigInt(roles.find((r) => r.id === GUILD)?.permissions ?? 0); // @everyone
  for (const r of misRoles) bits |= BigInt(r.permissions);
  const permisos = new PermissionsBitField(bits);
  const esAdmin = permisos.has(PermissionFlagsBits.Administrator);

  console.log('--- Permisos del bot en el servidor ---');
  const necesarios = {
    'Ver canales': PermissionFlagsBits.ViewChannel,
    'Enviar mensajes': PermissionFlagsBits.SendMessages,
    'Insertar enlaces': PermissionFlagsBits.EmbedLinks,
    'Añadir reacciones': PermissionFlagsBits.AddReactions,
    'Usar emojis externos': PermissionFlagsBits.UseExternalEmojis,
    'Leer historial': PermissionFlagsBits.ReadMessageHistory,
    'Aislar miembros (timeouts)': PermissionFlagsBits.ModerateMembers,
    'Gestionar roles (castigar admins)': PermissionFlagsBits.ManageRoles,
  };
  for (const [nombre, flag] of Object.entries(necesarios)) {
    console.log(`[${marca(esAdmin || permisos.has(flag))}] ${nombre}`);
  }

  console.log('\n--- Jerarquía ---');
  const miPosicion = Math.max(0, ...misRoles.map((r) => r.position));
  const porEncima = roles
    .filter((r) => r.position > miPosicion && !r.managed && r.id !== GUILD)
    .sort((a, b) => b.position - a.position);
  console.log(`Rol más alto del bot: posición ${miPosicion} de ${Math.max(...roles.map((r) => r.position))}`);
  if (porEncima.length) {
    console.log(`[ AVISO] Estos ${porEncima.length} roles están por encima del bot. A quien los tenga`);
    console.log('         NO le podrá dar timeout ni quitarle los roles (ni siendo admin):');
    console.log(`         ${porEncima.slice(0, 12).map((r) => r.name).join(', ')}${porEncima.length > 12 ? '…' : ''}`);
    console.log('         Solución: Ajustes del servidor → Roles → arrastra el rol del bot arriba del todo.');
  } else {
    console.log('[  OK  ] El rol del bot está por encima de todos los demás.');
  }
  console.log('[ NOTA ] Al dueño del servidor Discord no permite tocarlo nunca, por diseño.');
  console.log('[ NOTA ] A los admins que estén por debajo del bot sí: se les quitan los roles,');
  console.log('         se aplica el timeout y se les devuelven al terminar.');

  console.log('\n--- Emoji del check ---');
  const emojis = await api(`/guilds/${GUILD}/emojis`);
  const buscado = DEFAULTS.emojiOk;
  const encontrado = emojis.find((e) => e.id === buscado);
  if (encontrado) {
    console.log(`[  OK  ] :${encontrado.name}: (${encontrado.id}) está en este servidor.`);
  } else {
    console.log(`[ FALTA] El emoji ${buscado} no está en este servidor.`);
    console.log('         El bot reaccionará con ✅ salvo que esté en el servidor dueño del emoji.');
    console.log(`         Emojis disponibles aquí: ${emojis.length ? emojis.slice(0, 10).map((e) => `:${e.name}:`).join(' ') : '(ninguno)'}`);
  }

  console.log('');
})().catch((err) => {
  console.error('\nError:', err.message);
  process.exit(1);
});
