'use strict';

const MAX_DISCORD_MS = 28 * 24 * 60 * 60 * 1000; // límite duro de Discord

/**
 * Calcula el castigo por romper la cadena.
 *
 * Base: cuanto más alto es el número que se arruinó, más largo el timeout.
 *   minutos = número × minutosPorNumero  (acotado entre el mínimo y el máximo)
 *
 * Reincidencia (anti-spam): si el usuario vuelve a romper la cadena dentro de la
 * ventana anti-spam, el castigo se multiplica (×2, ×4, ×8… hasta el tope).
 * Si dejó pasar la ventana entera sin romper nada, sus infracciones se olvidan
 * y vuelve a recibir el timeout normal.
 */
function calcularCastigo({ numeroArruinado, usuario, cfg, ahora = Date.now() }) {
  const ventanaMs = cfg.ventanaSpamMin * 60 * 1000;
  const expiro = !usuario.ultimaInfraccion || ahora - usuario.ultimaInfraccion > ventanaMs;

  // Infracciones seguidas, contando esta
  const infraccionesPrevias = expiro ? 0 : usuario.infracciones;
  const infracciones = infraccionesPrevias + 1;

  const multiplicador = Math.min(
    cfg.maxMultiplicadorSpam,
    Math.pow(cfg.multiplicadorSpam, infracciones - 1),
  );

  const baseMin = Math.max(
    cfg.timeoutMinimoMin,
    Math.min(cfg.timeoutMaximoMin, Math.round(numeroArruinado * cfg.minutosPorNumero)),
  );

  const totalMin = Math.min(cfg.timeoutMaximoMin, Math.round(baseMin * multiplicador));
  const ms = Math.min(MAX_DISCORD_MS, totalMin * 60 * 1000);

  return {
    ms,
    minutos: totalMin,
    baseMinutos: baseMin,
    multiplicador,
    infracciones,
    reincidente: infraccionesPrevias > 0,
  };
}

// El timeout en sí lo aplica sanciones.castigar(), que también sabe castigar a admins.
module.exports = { calcularCastigo, MAX_DISCORD_MS };
