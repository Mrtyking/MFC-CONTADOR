'use strict';

/**
 * Timeouts que funcionan también con administradores.
 *
 * Discord ignora el timeout de quien tiene el permiso Administrador. Para esos
 * casos el bot les quita temporalmente los roles (guardando cuáles eran),
 * aplica el timeout, y cuando el castigo termina se los devuelve solos.
 *
 * Límites que NO se pueden saltar de ninguna forma:
 *   · Al dueño del servidor no se le puede tocar nada.
 *   · Si el rol del bot está por DEBAJO del rol del usuario, el bot tampoco
 *     puede quitarle roles. El rol del bot tiene que estar bien arriba.
 */

const { PermissionFlagsBits } = require('discord.js');
const store = require('./store');

const MAX_TIMER = 20 * 24 * 60 * 60 * 1000; // setTimeout se rompe pasados ~24,8 días
const BARRIDO_MS = 30 * 1000;
const CADUCIDAD_MS = 60 * 24 * 60 * 60 * 1000; // si en 60 días no se pudo devolver, se olvida

const timers = new Map();
const clave = (g, u) => `${g}:${u}`;

function pendientes(guildId) {
  const g = store.getGuild(guildId);
  if (!g.sanciones) g.sanciones = {};
  return g.sanciones;
}

/**
 * Roles que el bot puede quitar y volver a poner.
 *
 * Por defecto solo toca los que dan permiso de Administrador, que son los
 * únicos que hacen inmune al timeout. Los roles de color, VIP o decorativos
 * se quedan donde están: quitarlos no aportaría nada.
 *
 * Con `quitarSoloRolesAdmin` en false se le quitan todos los que pueda.
 */
function rolesQuitables(member, soloAdmin = true) {
  const tope = member.guild.members.me.roles.highest.position;
  return member.roles.cache.filter((r) => {
    if (r.id === member.guild.id) return false; // @everyone no se puede quitar
    if (r.managed) return false; // roles de integraciones y de booster
    if (r.position >= tope) return false; // por encima del bot: no lo puede tocar
    if (soloAdmin && !r.permissions.has(PermissionFlagsBits.Administrator)) return false;
    return true;
  });
}

/** ¿Por qué no se puede castigar a este miembro? null si sí se puede. */
function bloqueo(member) {
  const yo = member.guild.members.me;
  if (member.id === member.guild.ownerId) return 'es el dueño del servidor';
  if (member.id === yo.id) return 'soy yo';
  if (!yo.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return 'me falta el permiso Aislar miembros';
  }
  if (!member.manageable) return 'su rol está por encima del mío';
  return null;
}

/**
 * Aplica el castigo por el camino que haga falta.
 * Devuelve { ok, metodo, motivo, roles }
 *   metodo 'normal' → timeout directo
 *   metodo 'roles'  → hubo que quitarle los roles primero
 */
async function castigar(member, ms, razon) {
  const impedimento = bloqueo(member);
  if (impedimento) return { ok: false, metodo: null, motivo: impedimento, roles: [] };

  const hasta = Date.now() + ms;

  // Camino normal: no es admin, el timeout le afecta tal cual
  if (member.moderatable) {
    try {
      await member.timeout(ms, razon);
      return { ok: true, metodo: 'normal', roles: [] };
    } catch (err) {
      return { ok: false, metodo: null, motivo: err.message, roles: [] };
    }
  }

  // Es admin: hay que desarmarlo primero
  if (!member.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return {
      ok: false,
      metodo: null,
      motivo: 'es admin y me falta el permiso Gestionar roles',
      roles: [],
    };
  }

  const soloAdmin = store.getConfig(member.guild.id).quitarSoloRolesAdmin !== false;
  const quitables = rolesQuitables(member, soloAdmin);
  if (!quitables.size) {
    return { ok: false, metodo: null, motivo: 'es admin y no puedo quitarle ningún rol', roles: [] };
  }

  const ids = [...quitables.keys()];
  const guardados = quitables.map((r) => ({ id: r.id, nombre: r.name }));

  // Se guarda ANTES de tocar nada: si el bot se cae aquí, al arrancar los devuelve
  const lista = pendientes(member.guild.id);
  lista[member.id] = { roles: ids, nombres: guardados.map((r) => r.nombre), hasta, razon };
  store.guardarAhora();

  try {
    await member.roles.remove(ids, `${razon} — roles retirados para poder aplicar el timeout`);
  } catch (err) {
    delete lista[member.id];
    store.guardarAhora();
    return { ok: false, metodo: null, motivo: `no pude quitarle los roles: ${err.message}`, roles: [] };
  }

  try {
    const fresco = await member.guild.members.fetch({ user: member.id, force: true });
    if (fresco.permissions.has(PermissionFlagsBits.Administrator)) {
      // Le quedó Administrador por otra vía (normalmente porque lo da @everyone)
      throw new Error('sigue teniendo Administrador tras quitarle los roles');
    }
    await fresco.timeout(ms, razon);
  } catch (err) {
    // Si el timeout falla, se le devuelven los roles en el acto: no se queda pelado
    await devolver(member.guild, member.id, 'el timeout falló');
    return { ok: false, metodo: null, motivo: `quité los roles pero el timeout falló: ${err.message}`, roles: [] };
  }

  programar(member.client, member.guild.id, member.id, hasta);
  return { ok: true, metodo: 'roles', roles: guardados };
}

/**
 * Devuelve los roles guardados. Se usa al vencer el castigo y desde /quitartimeout.
 * Devuelve { ok, roles, motivo }
 */
async function devolver(guild, userId, motivo = 'castigo cumplido') {
  const lista = pendientes(guild.id);
  const sancion = lista[userId];
  if (!sancion) return { ok: false, roles: [], motivo: 'no tenía roles retirados' };

  const t = timers.get(clave(guild.id, userId));
  if (t) {
    clearTimeout(t);
    timers.delete(clave(guild.id, userId));
  }

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    // Se fue del servidor: se guarda para devolvérselos si vuelve
    if (Date.now() - sancion.hasta > CADUCIDAD_MS) {
      delete lista[userId];
      store.guardar();
    }
    return { ok: false, roles: [], motivo: 'no está en el servidor, se lo guardo por si vuelve' };
  }

  // Los roles que ya no existan se descartan
  const vivos = sancion.roles.filter((id) => guild.roles.cache.has(id));
  try {
    if (vivos.length) await member.roles.add(vivos, `Roles devueltos: ${motivo}`);
    delete lista[userId];
    store.guardarAhora();
    return { ok: true, roles: vivos, motivo };
  } catch (err) {
    return { ok: false, roles: [], motivo: `no pude devolver los roles: ${err.message}` };
  }
}

/** Programa la devolución automática cuando venza el castigo. */
function programar(client, guildId, userId, hasta) {
  const k = clave(guildId, userId);
  const anterior = timers.get(k);
  if (anterior) clearTimeout(anterior);

  const falta = Math.max(0, hasta - Date.now());
  const t = setTimeout(async () => {
    timers.delete(k);
    if (falta > MAX_TIMER) return programar(client, guildId, userId, hasta); // re-arma por tramos
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const r = await devolver(guild, userId, 'se acabó el timeout');
    if (r.ok) console.log(`[sanciones] Roles devueltos a ${userId} en ${guildId}`);
  }, Math.min(falta, MAX_TIMER) + 1000);

  if (t.unref) t.unref();
  timers.set(k, t);
}

/** Repasa todas las sanciones: devuelve las vencidas y reprograma las vivas. */
async function barrer(client) {
  const datos = store.db().guilds ?? {};
  for (const [guildId, g] of Object.entries(datos)) {
    if (!g.sanciones) continue;
    for (const [userId, sancion] of Object.entries(g.sanciones)) {
      if (sancion.hasta <= Date.now()) {
        const guild = client.guilds.cache.get(guildId);
        if (guild) await devolver(guild, userId, 'se acabó el timeout');
      } else if (!timers.has(clave(guildId, userId))) {
        programar(client, guildId, userId, sancion.hasta);
      }
    }
  }
}

/** Arranca el vigilante. Se llama una vez, al conectar. */
function iniciar(client) {
  barrer(client).catch((e) => console.error('[sanciones]', e.message));
  const i = setInterval(() => {
    barrer(client).catch((e) => console.error('[sanciones]', e.message));
  }, BARRIDO_MS);
  if (i.unref) i.unref();
  return i;
}

/** Info para mostrar en /nivel y /quitartimeout. */
function sancionDe(guildId, userId) {
  return pendientes(guildId)[userId] ?? null;
}

module.exports = { castigar, devolver, programar, barrer, iniciar, sancionDe, rolesQuitables, bloqueo };
