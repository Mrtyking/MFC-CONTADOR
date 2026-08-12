'use strict';

/**
 * Quién puede usar cada comando.
 *
 * Por defecto:
 *   · Los comandos administrativos solo los usa el rol configurado y el dueño del bot.
 *   · Los comandos de consulta (contador, nivel, top, ayuda) los usa todo el mundo.
 *
 * Todo se cambia en caliente con /permisos, sin tocar el código.
 */

const store = require('./store');

/** Dueño del bot: puede usarlo todo siempre, en cualquier servidor. */
const DUENO_BOT = '262514432427556865';

/** Rol que manda por defecto en el servidor. */
const ROL_ADMIN_DEFECTO = '1454632814409682995';

const PUBLICO = 'publico';
const ADMIN = 'admin';

/** Nivel por defecto de cada comando. */
const NIVELES = {
  // Administrativos
  setcanal: ADMIN,
  quitarcanal: ADMIN,
  reiniciar: ADMIN,
  config: ADMIN,
  permisos: ADMIN,
  perdon: ADMIN,
  quitartimeout: ADMIN,
  revisar: ADMIN,
  // Consulta
  contador: PUBLICO,
  nivel: PUBLICO,
  top: PUBLICO,
  ayuda: PUBLICO,
};

function datos(guildId) {
  const g = store.getGuild(guildId);
  if (!g.permisos) g.permisos = { roles: [ROL_ADMIN_DEFECTO], comandos: {} };
  if (!Array.isArray(g.permisos.roles)) g.permisos.roles = [ROL_ADMIN_DEFECTO];
  if (!g.permisos.comandos) g.permisos.comandos = {};
  return g.permisos;
}

function nivelDe(guildId, comando) {
  const p = datos(guildId);
  return p.comandos[comando] ?? NIVELES[comando] ?? ADMIN;
}

function rolesAdmin(guildId) {
  return datos(guildId).roles;
}

/**
 * ¿Puede esta persona usar este comando?
 * Devuelve { ok, motivo }
 */
function puede(interaction, comando) {
  const nivel = nivelDe(interaction.guild.id, comando);
  if (nivel === PUBLICO) return { ok: true };

  if (interaction.user.id === DUENO_BOT) return { ok: true };

  const roles = rolesAdmin(interaction.guild.id);
  if (roles.some((id) => interaction.member.roles.cache.has(id))) return { ok: true };

  // Salvavidas: el dueño del servidor siempre puede arreglar la configuración de permisos,
  // así no hay forma de quedarse fuera por borrar el rol equivocado.
  if (comando === 'permisos' && interaction.user.id === interaction.guild.ownerId) {
    return { ok: true };
  }

  return {
    ok: false,
    motivo: roles.length
      ? `Este comando es solo para ${roles.map((id) => `<@&${id}>`).join(' o ')}.`
      : 'Este comando es solo para el dueño del bot.',
  };
}

function añadirRol(guildId, rolId) {
  const p = datos(guildId);
  if (p.roles.includes(rolId)) return false;
  p.roles.push(rolId);
  store.guardar();
  return true;
}

function quitarRol(guildId, rolId) {
  const p = datos(guildId);
  const i = p.roles.indexOf(rolId);
  if (i === -1) return false;
  p.roles.splice(i, 1);
  store.guardar();
  return true;
}

function ponerNivel(guildId, comando, nivel) {
  const p = datos(guildId);
  if (nivel === (NIVELES[comando] ?? ADMIN)) delete p.comandos[comando];
  else p.comandos[comando] = nivel;
  store.guardar();
}

module.exports = {
  DUENO_BOT,
  ROL_ADMIN_DEFECTO,
  PUBLICO,
  ADMIN,
  NIVELES,
  puede,
  nivelDe,
  rolesAdmin,
  añadirRol,
  quitarRol,
  ponerNivel,
};
