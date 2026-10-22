'use strict';

const { barra } = require('./utils');

/**
 * XP necesaria para pasar del nivel `nivel` al `nivel + 1`.
 * Con los valores por defecto (base 20, exponente 1.25):
 *   0->1: 20 | 1->2: 48 | 2->3: 79 | 3->4: 113 | 9->10: 356 ...
 * Cada nivel cuesta más que el anterior, así que no se sube fácil.
 */
function xpParaSubir(nivel, cfg) {
  return Math.max(1, Math.round(cfg.xpBase * Math.pow(nivel + 1, cfg.xpExponente)));
}

/** XP total acumulada que hace falta para *estar* en cierto nivel. */
function xpTotalHasta(nivel, cfg) {
  let total = 0;
  for (let i = 0; i < nivel; i++) total += xpParaSubir(i, cfg);
  return total;
}

/**
 * Calcula el nivel a partir de la XP acumulada. Los niveles no tienen tope.
 * Devuelve también los datos para dibujar la barra del nivel actual, que
 * empieza de cero en cada nivel: [▰▱▱▱▱▱▱▱▱▱] 1 / 20
 *   actual    → XP ganada dentro de este nivel
 *   necesario → XP que cuesta este nivel entero
 */
function calcular(xp, cfg) {
  let nivel = 0;
  let inicio = 0;
  let siguiente = xpParaSubir(0, cfg);

  while (xp >= siguiente) {
    nivel++;
    inicio = siguiente;
    siguiente += xpParaSubir(nivel, cfg);
  }

  const actual = xp - inicio;
  const necesario = siguiente - inicio;
  return {
    nivel,
    xp,
    inicio,
    siguiente,
    actual,
    necesario,
    faltan: siguiente - xp,
    barra: barra(actual, necesario, cfg.segmentosBarra),
  };
}

/** Devuelve el nivel nuevo si la XP añadida hizo subir de nivel, si no null. */
function subioDeNivel(xpAntes, xpDespues, cfg) {
  const a = calcular(xpAntes, cfg).nivel;
  const b = calcular(xpDespues, cfg).nivel;
  return b > a ? b : null;
}

module.exports = { xpParaSubir, xpTotalHasta, calcular, subioDeNivel };
