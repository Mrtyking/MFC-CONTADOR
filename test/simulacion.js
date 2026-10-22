'use strict';

/**
 * Simulador offline: prueba toda la lógica del contador sin conectarse a Discord.
 *   node test/simulacion.js
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.MFC_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mfc-test-'));

const { Collection, PermissionFlagsBits, MessageFlags } = require('discord.js');
const store = require('../src/store');
const levels = require('../src/levels');
const sanciones = require('../src/sanciones');
const { calcularCastigo } = require('../src/timeouts');
const { parseNumero, formatDuracion, barra } = require('../src/utils');
const { manejarMensaje } = require('../src/counting');

store.cargar();

const GUILD = 'g1';
const CANAL = 'c1';
const DUENO = 'DUENO';
const salida = [];
let timeoutsAplicados = [];

/* --- Doble de Discord --------------------------------------------- */

const rolesDelServidor = new Collection();
function rol(id, nombre, position, managed = false, esAdmin = false) {
  const r = { id, name: nombre, position, managed, permissions: permisosDe(esAdmin) };
  rolesDelServidor.set(id, r);
  return r;
}
function permisosDe(esAdmin) {
  return { has: (flag) => (esAdmin ? flag === PermissionFlagsBits.Administrator : false) };
}
rol(GUILD, '@everyone', 0); // el rol @everyone tiene el id del servidor
rol('r_admin', 'Admin', 50, false, true);
rol('r_vip', 'VIP', 20);
rol('r_color', 'Color rosita', 15);
rol('r_bot_integracion', 'Bot (gestionado)', 10, true);
rol('r_intocable', 'Fundador', 900, false, true);

const clienteFalso = { emojis: { cache: new Map() }, guilds: { cache: new Map() } };

const guildFalso = {
  id: GUILD,
  name: 'Servidor de prueba',
  ownerId: DUENO,
  roles: { cache: rolesDelServidor },
  members: {
    me: {
      id: 'BOT',
      permissions: { has: () => true },
      roles: { highest: { position: 100 } },
    },
    fetch: async (arg) => miembro(typeof arg === 'object' ? arg.user : arg),
  },
};
clienteFalso.guilds.cache.set(GUILD, guildFalso);

function hacerMiembro(id, { roles = [], porEncima = false } = {}) {
  const cache = new Collection();
  for (const rid of roles) cache.set(rid, rolesDelServidor.get(rid));

  // Igual que en Discord: eres admin si ALGUNO de tus roles da ese permiso
  const esAdmin = () =>
    [...cache.values()].some((r) => r?.permissions?.has(PermissionFlagsBits.Administrator));

  const m = {
    id,
    client: clienteFalso,
    guild: guildFalso,
    communicationDisabledUntilTimestamp: null,
    get permissions() {
      return { has: (flag) => flag === PermissionFlagsBits.Administrator && esAdmin() };
    },
    // moderatable = false si es admin (Discord ignora el timeout de los admins)
    get moderatable() {
      return !esAdmin() && this.manageable;
    },
    // manageable = false si su rol está por encima del del bot o si es el dueño
    get manageable() {
      return id !== DUENO && !porEncima;
    },
    roles: {
      cache,
      async remove(ids, _razon) {
        for (const rid of [].concat(ids)) cache.delete(rid);
      },
      async add(ids, _razon) {
        for (const rid of [].concat(ids)) cache.set(rid, rolesDelServidor.get(rid));
      },
    },
    async timeout(ms, razon) {
      if (!this.moderatable) throw new Error('Missing Permissions');
      this.communicationDisabledUntilTimestamp = ms === null ? null : Date.now() + ms;
      timeoutsAplicados.push({ id, ms, razon });
    },
  };
  return m;
}

const miembros = new Map();
function miembro(id, opciones) {
  if (!miembros.has(id)) miembros.set(id, hacerMiembro(id, opciones));
  return miembros.get(id);
}

let contadorId = 1000;
function mensaje(userId, contenido) {
  const autor = { id: userId, bot: false, username: `user${userId}`, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' };
  return {
    id: String(++contadorId),
    content: contenido,
    author: autor,
    member: miembro(userId),
    system: false,
    deletable: true,
    reacciones: [],
    client: clienteFalso,
    guild: guildFalso,
    channel: {
      id: CANAL,
      async send(payload) {
        salida.push(leerPanel(payload));
      },
    },
    async react(emoji) {
      this.reacciones.push(String(emoji));
    },
    async delete() {},
  };
}

/**
 * Convierte un mensaje Components V2 en { titulo, desc, campos, v2, botones }.
 * titulo = línea "### ...", campos = líneas "icono **Nombre:** valor".
 */
function leerPanel(payload) {
  const textos = [];
  const botones = [];
  const recorrer = (c) => {
    if (c.type === 10) textos.push(c.content);
    if (c.type === 2) botones.push(c.custom_id);
    for (const hijo of c.components ?? []) recorrer(hijo);
  };
  for (const c of payload.components ?? []) recorrer(c.toJSON ? c.toJSON() : c);

  const lineas = textos.join('\n').split('\n');
  const titulo = lineas.find((l) => l.startsWith('### '))?.slice(4);
  const campos = {};
  for (const l of lineas) {
    const m = /^\S+ \*\*(.+?):\*\* (.+)$/.exec(l);
    if (m) campos[m[1]] = m[2];
  }
  return {
    titulo,
    desc: lineas.join('\n'),
    campos,
    botones,
    v2: Boolean(payload.flags & MessageFlags.IsComponentsV2) && !payload.embeds && !payload.content,
  };
}

/* --- Utilidades del test ------------------------------------------ */

let fallos = 0;
function comprobar(nombre, condicion, detalle = '') {
  const marca = condicion ? '  OK  ' : ' FALLA';
  if (!condicion) fallos++;
  console.log(`[${marca}] ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}

async function enviar(userId, texto) {
  timeoutsAplicados = [];
  salida.length = 0;
  const m = mensaje(userId, texto);
  await manejarMensaje(m);
  return { m, timeouts: timeoutsAplicados, embeds: [...salida] };
}

/* --- Pruebas ------------------------------------------------------- */

(async () => {
  console.log('\n=== parseNumero ===');
  comprobar('"13" -> 13', parseNumero('13') === 13);
  comprobar('"13 vamos!" -> 13', parseNumero('13 vamos!') === 13);
  comprobar('"hola" -> null', parseNumero('hola') === null);
  comprobar('"a13" -> null', parseNumero('a13') === null);
  comprobar('"  7  " -> 7', parseNumero('  7  ') === 7);

  console.log('\n=== barra de nivel ===');
  comprobar('0/10 vacía', barra(0, 10) === '▱▱▱▱▱▱▱▱▱▱', barra(0, 10));
  comprobar('3/10 -> 3 llenos', barra(3, 10) === '▰▰▰▱▱▱▱▱▱▱', barra(3, 10));
  comprobar('10/10 llena', barra(10, 10) === '▰▰▰▰▰▰▰▰▰▰', barra(10, 10));

  console.log('\n=== curva de niveles ===');
  const cfg = store.getConfig(GUILD);
  const curva = [0, 1, 2, 3, 4, 9, 19].map((n) => `${n}→${n + 1}: ${levels.xpParaSubir(n, cfg)}`);
  console.log('   coste por nivel:', curva.join(' | '));
  comprobar('cada nivel cuesta más', levels.xpParaSubir(5, cfg) > levels.xpParaSubir(4, cfg));
  const n0 = levels.calcular(0, cfg);
  comprobar('xp 0 -> nivel 0', n0.nivel === 0, `[${n0.barra}] ${n0.xp}/${n0.siguiente}`);
  const n5 = levels.calcular(150, cfg);
  console.log(`   xp 150 -> nivel ${n5.nivel}  [${n5.barra}] ${n5.xp}/${n5.siguiente}`);

  console.log('\n=== conteo correcto ===');
  store.getCanal(GUILD, CANAL, true);
  let r = await enviar('A', '1');
  comprobar('1 aceptado', r.m.reacciones.length === 1 && r.embeds.length === 0);
  r = await enviar('B', '2');
  comprobar('2 aceptado por otro usuario', r.embeds.length === 0);
  comprobar('contador va por 2', store.getCanal(GUILD, CANAL).actual === 2);

  console.log('\n=== turno repetido ===');
  r = await enviar('B', '3');
  comprobar('mismo usuario dos veces = rompe', /Cadena rota/.test(r.embeds[0]?.titulo ?? ''));
  comprobar('el aviso es un panel V2 (sin embeds)', r.embeds[0]?.v2 === true);
  comprobar(
    'el panel trae los botones',
    r.embeds[0]?.botones.join('|') === 'mfc:nivel|mfc:top',
    r.embeds[0]?.botones.join(', '),
  );
  comprobar('mensaje explica el turno', /dos veces seguidas/.test(r.embeds[0]?.desc ?? ''));
  comprobar('contador reiniciado', store.getCanal(GUILD, CANAL).actual === 0);
  comprobar('hubo timeout', r.timeouts.length === 1, formatDuracion(r.timeouts[0]?.ms ?? 0));

  console.log('\n=== número equivocado (ejemplo del enunciado) ===');
  const g = store.getGuild(GUILD);
  g.usuarios = {}; // empezamos limpio
  const canal = store.getCanal(GUILD, CANAL);
  canal.actual = 0;
  canal.ultimoUsuario = null;
  await enviar('A', '1');
  await enviar('B', '2');
  r = await enviar('C', '4'); // tocaba el 3
  const min1 = (r.timeouts[0]?.ms ?? 0) / 60000;
  comprobar('C recibe timeout', r.timeouts.length === 1);
  comprobar('~3-4 min de castigo', min1 >= 3 && min1 <= 5, `${min1} min`);
  comprobar('embed dice qué se esperaba', /se esperaba `3`/.test(r.embeds[0]?.desc ?? ''));
  comprobar('llegaron hasta 2', r.embeds[0]?.campos['Llegaron hasta'] === '`2`');
  comprobar(
    'los valores van con fondo oscuro',
    ['Llegaron hasta', 'Récord', 'Timeout', 'Infracciones', 'Nivel'].every((c) =>
      r.embeds[0]?.campos[c]?.startsWith('`'),
    ),
    JSON.stringify(r.embeds[0]?.campos),
  );
  comprobar(
    'el embed no filtra motivos técnicos',
    !/permiso|rol está por encima|Missing|error/i.test(JSON.stringify(r.embeds[0]?.campos)),
  );
  comprobar(
    'el embed solo lleva los 5 campos de siempre',
    Object.keys(r.embeds[0]?.campos ?? {}).join('|') ===
      'Llegaron hasta|Récord|Timeout|Infracciones|Nivel',
    Object.keys(r.embeds[0]?.campos ?? {}).join(', '),
  );

  console.log('\n=== reincidencia (anti-spam) ===');
  const castigos = [];
  for (let i = 0; i < 5; i++) {
    canal.actual = 0;
    canal.ultimoUsuario = null;
    await enviar('A', '1');
    await enviar('B', '2');
    r = await enviar('C', '99');
    castigos.push((r.timeouts[0]?.ms ?? 0) / 60000);
  }
  console.log('   castigos seguidos (min):', castigos.join(' → '));
  comprobar('el castigo sube al reincidir', castigos[1] > castigos[0]);
  comprobar('sigue subiendo', castigos[2] > castigos[1]);
  comprobar('respeta el tope ×16', castigos[4] <= castigos[0] * 16);

  console.log('\n=== la ventana anti-spam expira ===');
  const cfg2 = store.getConfig(GUILD);
  const usuarioViejo = {
    infracciones: 4,
    ultimaInfraccion: Date.now() - (cfg2.ventanaSpamMin + 10) * 60 * 1000,
  };
  const tras = calcularCastigo({ numeroArruinado: 10, usuario: usuarioViejo, cfg: cfg2 });
  comprobar('infracciones olvidadas', tras.infracciones === 1, `x${tras.multiplicador}`);
  comprobar('vuelve al castigo normal', tras.multiplicador === 1, formatDuracion(tras.ms));

  console.log('\n=== escala del timeout según el número ===');
  for (const n of [1, 4, 13, 50, 285, 1000, 100000]) {
    const c = calcularCastigo({
      numeroArruinado: n,
      usuario: { infracciones: 0, ultimaInfraccion: 0 },
      cfg: cfg2,
    });
    console.log(`   número ${String(n).padStart(6)} → ${formatDuracion(c.ms)}`);
  }

  console.log('\n=== castigar a un ADMIN (solo se le quitan los roles de admin) ===');
  const admin = miembro('ADMIN', {

    roles: ['r_admin', 'r_vip', 'r_color', 'r_bot_integracion'],
  });
  comprobar('el timeout normal no le afecta', admin.moderatable === false);

  const res = await sanciones.castigar(admin, 5000, 'prueba');
  comprobar('el castigo se aplica igual', res.ok === true, `método: ${res.metodo}`);
  comprobar('método = quitar roles', res.metodo === 'roles');
  comprobar('quedó silenciado', admin.communicationDisabledUntilTimestamp !== null);
  comprobar('le quitó el rol de Admin', !admin.roles.cache.has('r_admin'));
  comprobar(
    'CONSERVA sus roles normales (VIP y color)',
    admin.roles.cache.has('r_vip') && admin.roles.cache.has('r_color'),
    'solo se le quita lo que da permiso de Administrador',
  );
  comprobar(
    'NO tocó el rol gestionado por integración',
    admin.roles.cache.has('r_bot_integracion'),
    'los roles de bots/boosters no se pueden quitar',
  );
  const guardada = sanciones.sancionDe(GUILD, 'ADMIN');
  comprobar('solo hay 1 rol que devolver', guardada?.roles.length === 1, JSON.stringify(guardada?.nombres));

  const dev = await sanciones.devolver(guildFalso, 'ADMIN', 'prueba');
  comprobar('el rol de admin vuelve', dev.ok && admin.roles.cache.has('r_admin'));
  comprobar('ya no queda nada pendiente', sanciones.sancionDe(GUILD, 'ADMIN') === null);

  console.log('\n=== y si prefieres quitarle TODOS los roles ===');
  store.getGuild(GUILD).config.quitarSoloRolesAdmin = false;
  const admin2 = miembro('ADMIN2', { roles: ['r_admin', 'r_vip', 'r_color'] });
  const res2 = await sanciones.castigar(admin2, 5000, 'prueba');
  comprobar('se le quitan los 3', res2.ok && res2.roles.length === 3, JSON.stringify(res2.roles.map((r) => r.nombre)));
  await sanciones.devolver(guildFalso, 'ADMIN2', 'prueba');
  comprobar('y vuelven los 3', admin2.roles.cache.size === 3);
  delete store.getGuild(GUILD).config.quitarSoloRolesAdmin;

  console.log('\n=== le quitan el timeout a mano desde Discord ===');
  const admin3 = miembro('ADMIN3', { roles: ['r_admin', 'r_vip'] });
  await sanciones.castigar(admin3, 60 * 60 * 1000, 'prueba'); // 1 hora
  comprobar('castigado y sin rol de admin', !admin3.roles.cache.has('r_admin'));

  // Un mod le quita el timeout desde la interfaz de Discord (no con /quitartimeout)
  const antes = { communicationDisabledUntilTimestamp: admin3.communicationDisabledUntilTimestamp };
  admin3.communicationDisabledUntilTimestamp = null;

  await sanciones.alCambiarMiembro(antes, admin3);
  comprobar(
    'el bot lo detecta y le devuelve los roles',
    admin3.roles.cache.has('r_admin') && admin3.roles.cache.has('r_vip'),
  );
  comprobar('y limpia la sanción pendiente', sanciones.sancionDe(GUILD, 'ADMIN3') === null);

  console.log('\n=== y si el intent está apagado, lo pilla el barrido ===');
  const admin4 = miembro('ADMIN4', { roles: ['r_admin'] });
  await sanciones.castigar(admin4, 60 * 60 * 1000, 'prueba');
  admin4.communicationDisabledUntilTimestamp = null; // se lo quitan a mano
  // El margen de gracia evita falsos positivos recién aplicado el castigo
  await sanciones.barrer(clienteFalso);
  comprobar(
    'dentro del margen de gracia no hace nada todavía',
    sanciones.sancionDe(GUILD, 'ADMIN4') !== null,
  );
  sanciones.sancionDe(GUILD, 'ADMIN4').desde = Date.now() - 60_000; // simulamos que pasó el margen
  await sanciones.barrer(clienteFalso);
  comprobar('pasado el margen, el barrido le devuelve los roles', admin4.roles.cache.has('r_admin'));
  comprobar('y limpia la sanción', sanciones.sancionDe(GUILD, 'ADMIN4') === null);

  console.log('\n=== a quién NO se puede tocar ===');
  const dueno = miembro(DUENO, { roles: ['r_admin'] });
  const r1 = await sanciones.castigar(dueno, 5000, 'prueba');
  comprobar('al dueño del servidor no', r1.ok === false, r1.motivo);

  const jefe = miembro('JEFE', { roles: ['r_intocable'], porEncima: true });
  const r2 = await sanciones.castigar(jefe, 5000, 'prueba');
  comprobar('a quien esté por encima del bot tampoco', r2.ok === false, r2.motivo);
  comprobar('y no le quitó ningún rol', jefe.roles.cache.has('r_intocable'));

  console.log('\n=== persistencia al reiniciar ===');
  const canalAntes = store.getCanal(GUILD, CANAL);
  const snapshot = { actual: canalAntes.actual, record: canalAntes.record, xp: canalAntes.xp };
  canalAntes.actual = 42;
  store.guardarAhora();
  // Se simula un reinicio: se vacía el módulo de la caché y se vuelve a cargar
  delete require.cache[require.resolve('../src/store')];
  const store2 = require('../src/store');
  store2.cargar();
  const recargado = store2.getCanal(GUILD, CANAL);
  comprobar("el contador sobrevive al reinicio", recargado.actual === 42, `actual=${recargado.actual}`);
  comprobar("el récord sobrevive", recargado.record === snapshot.record, `récord=${recargado.record}`);
  comprobar("la XP sobrevive", recargado.xp === snapshot.xp, `xp=${recargado.xp}`);

  console.log('\n=== permisos de comandos ===');
  const permisos = require('../src/permisos');
  const fingirInteraccion = (userId, rolesUsuario = []) => ({
    user: { id: userId },
    guild: { id: GUILD, ownerId: DUENO },
    member: { roles: { cache: { has: (id) => rolesUsuario.includes(id) } } },
  });
  const cualquiera = fingirInteraccion('random');
  const conRol = fingirInteraccion('otro', [permisos.ROL_ADMIN_DEFECTO]);
  const dueñoBot = fingirInteraccion(permisos.DUENO_BOT);

  comprobar('/contador lo usa cualquiera', permisos.puede(cualquiera, 'contador').ok === true);
  comprobar('/nivel lo usa cualquiera', permisos.puede(cualquiera, 'nivel').ok === true);
  comprobar('/top lo usa cualquiera', permisos.puede(cualquiera, 'top').ok === true);
  comprobar('/ayuda lo usa cualquiera', permisos.puede(cualquiera, 'ayuda').ok === true);
  comprobar('/setcanal NO lo usa cualquiera', permisos.puede(cualquiera, 'setcanal').ok === false);
  comprobar('/config NO lo usa cualquiera', permisos.puede(cualquiera, 'config').ok === false);
  comprobar('/perdon NO lo usa cualquiera', permisos.puede(cualquiera, 'perdon').ok === false);
  comprobar('/quitartimeout NO lo usa cualquiera', permisos.puede(cualquiera, 'quitartimeout').ok === false);
  comprobar('el rol configurado SÍ puede', permisos.puede(conRol, 'setcanal').ok === true);
  comprobar('el dueño del bot SÍ puede', permisos.puede(dueñoBot, 'config').ok === true);

  permisos.ponerNivel(GUILD, 'contador', 'admin');
  comprobar('se puede cerrar un comando público', permisos.puede(cualquiera, 'contador').ok === false);
  permisos.ponerNivel(GUILD, 'contador', 'publico');
  comprobar('y volver a abrirlo', permisos.puede(cualquiera, 'contador').ok === true);

  console.log('\n=== nivel del canal tras contar ===');
  const info = levels.calcular(store.getCanal(GUILD, CANAL).xp, cfg2);
  console.log(`   [${info.barra}] ${info.xp} / ${info.siguiente} (nivel ${info.nivel})`);

  console.log(`\n${fallos === 0 ? 'TODO OK' : `${fallos} COMPROBACIÓN(ES) FALLIDAS`}\n`);
  fs.rmSync(process.env.MFC_DATA_DIR, { recursive: true, force: true });
  process.exit(fallos === 0 ? 0 : 1);
})();
