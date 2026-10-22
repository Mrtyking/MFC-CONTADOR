'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULTS } = require('./config');

// MFC_DATA_DIR permite apuntar a otra carpeta (lo usa el simulador de pruebas)
const DIR = process.env.MFC_DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'guilds.json');
const TMP = path.join(DIR, 'guilds.tmp.json');

let db = { guilds: {} };
let timer = null;

function cargar() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
      const raw = fs.readFileSync(FILE, 'utf8');
      if (raw.trim()) db = JSON.parse(raw);
    }
  } catch (err) {
    console.error('[store] No se pudo leer la base de datos, se empieza vacía:', err.message);
    // Guarda una copia del archivo corrupto antes de sobrescribirlo
    try {
      if (fs.existsSync(FILE)) fs.copyFileSync(FILE, `${FILE}.corrupto-${Date.now()}`);
    } catch {}
    db = { guilds: {} };
  }
  if (!db.guilds) db.guilds = {};
}

function guardarAhora() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(TMP, JSON.stringify(db, null, 2));
    fs.renameSync(TMP, FILE); // escritura atómica: nunca deja el archivo a medias
  } catch (err) {
    console.error('[store] Error guardando:', err.message);
  }
}

/** Guarda con retraso para no escribir en disco en cada mensaje. */
function guardar() {
  if (timer) return;
  // Sin unref a propósito: si el proceso se está cerrando, este guardado
  // pendiente lo mantiene vivo el segundo que hace falta para no perder datos.
  timer = setTimeout(() => {
    timer = null;
    guardarAhora();
  }, 1500);
}

function getGuild(guildId) {
  let g = db.guilds[guildId];
  if (!g) {
    g = { config: {}, canales: {}, usuarios: {} };
    db.guilds[guildId] = g;
  }
  if (!g.config) g.config = {};
  if (!g.canales) g.canales = {};
  if (!g.usuarios) g.usuarios = {};
  return g;
}

function getConfig(guildId) {
  return { ...DEFAULTS, ...getGuild(guildId).config };
}

function getCanal(guildId, channelId, crear = false) {
  const g = getGuild(guildId);
  if (!g.canales[channelId] && crear) {
    g.canales[channelId] = {
      actual: 0,
      record: 0,
      xp: 0,
      ultimoUsuario: null,
      ultimoMensajeId: null,
      totalAciertos: 0,
      totalFallos: 0,
      creado: Date.now(),
    };
  }
  return g.canales[channelId] || null;
}

function getUsuario(guildId, userId) {
  const g = getGuild(guildId);
  let u = g.usuarios[userId];
  if (!u) {
    u = {
      aciertos: 0,
      fallos: 0,
      rachaActual: 0,
      mejorRacha: 0,
      infracciones: 0,
      ultimaInfraccion: 0,
      totalTimeoutMs: 0,
    };
    g.usuarios[userId] = u;
  }
  historico(u);
  return u;
}

/**
 * Totales de siempre de un usuario: no se borran con el reinicio mensual.
 * Los usuarios de antes de existir el histórico arrancan con lo que ya tenían.
 */
function historico(u) {
  if (!u.historico) {
    u.historico = {
      aciertos: u.aciertos ?? 0,
      fallos: u.fallos ?? 0,
      mejorRacha: u.mejorRacha ?? 0,
      totalTimeoutMs: u.totalTimeoutMs ?? 0,
    };
  }
  return u.historico;
}

/** Igual que historico() pero para un canal: aciertos y cadenas rotas de siempre. */
function historicoCanal(canal) {
  if (!canal.historico) {
    canal.historico = { aciertos: canal.totalAciertos ?? 0, fallos: canal.totalFallos ?? 0 };
  }
  return canal.historico;
}

/** Copia de seguridad del archivo entero, p. ej. antes del reinicio mensual. */
function copia(etiqueta) {
  guardarAhora();
  try {
    const destino = path.join(DIR, `guilds.${etiqueta}.json`);
    if (!fs.existsSync(destino)) fs.copyFileSync(FILE, destino);
    return destino;
  } catch (err) {
    console.error('[store] No se pudo hacer la copia:', err.message);
    return null;
  }
}

module.exports = {
  cargar,
  guardar,
  guardarAhora,
  copia,
  getGuild,
  getConfig,
  getCanal,
  getUsuario,
  historico,
  historicoCanal,
  db: () => db,
};
