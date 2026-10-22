'use strict';

/**
 * Saca el número de un mensaje. Acepta "13" y "13 vamos!".
 * Devuelve null si el mensaje no empieza por un número.
 */
function parseNumero(contenido) {
  const limpio = contenido.trim();
  const m = /^(\d{1,15})(?:\s|$|[^\d\w])/.exec(limpio) || /^(\d{1,15})$/.exec(limpio);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}

/**
 * Barra de progreso: ▰▰▰▱▱▱▱▱▱▱
 * Redondea hacia arriba para que el primer acierto ya se note (1/20 → ▰▱▱…),
 * pero solo se llena entera al completar el nivel.
 */
function barra(actual, total, segmentos = 10) {
  let llenos = 0;
  if (total > 0 && actual >= total) llenos = segmentos;
  else if (total > 0 && actual > 0) {
    llenos = Math.min(segmentos - 1, Math.max(1, Math.ceil((actual / total) * segmentos)));
  }
  return '▰'.repeat(llenos) + '▱'.repeat(segmentos - llenos);
}

/** 95 -> "1 hora 35 minutos" */
function formatDuracion(ms) {
  if (ms <= 0) return '0 segundos';
  const s = Math.round(ms / 1000);
  const dias = Math.floor(s / 86400);
  const horas = Math.floor((s % 86400) / 3600);
  const min = Math.floor((s % 3600) / 60);
  const seg = s % 60;

  const partes = [];
  if (dias) partes.push(`${dias} ${dias === 1 ? 'día' : 'días'}`);
  if (horas) partes.push(`${horas} ${horas === 1 ? 'hora' : 'horas'}`);
  if (min) partes.push(`${min} ${min === 1 ? 'minuto' : 'minutos'}`);
  if (!dias && !horas && seg) partes.push(`${seg} ${seg === 1 ? 'segundo' : 'segundos'}`);
  return partes.slice(0, 2).join(' ') || '0 segundos';
}

/** Marca de tiempo relativa de Discord: "hace 5 minutos" */
function tsRelativo(ms) {
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

/**
 * Convierte el valor de configuración del emoji en algo que message.react() entienda.
 * Si es el ID de un emoji personalizado, lo busca en la caché del bot.
 */
function resolverEmoji(client, valor) {
  if (!valor) return null;
  if (/^\d{15,25}$/.test(valor)) {
    return client.emojis.cache.get(valor) ?? null;
  }
  const m = /^<(a?):(\w+):(\d{15,25})>$/.exec(valor);
  if (m) return client.emojis.cache.get(m[3]) ?? valor;
  return valor; // emoji unicode normal
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { parseNumero, barra, formatDuracion, tsRelativo, resolverEmoji, dormir };
