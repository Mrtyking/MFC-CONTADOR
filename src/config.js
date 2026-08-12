'use strict';

/**
 * Configuración por defecto de cada servidor.
 * Todo esto se puede cambiar en caliente con /config.
 */
const DEFAULTS = {
  // --- Reacciones ---
  emojiOk: '1291246124006510623', // emoji del check (ID del emoji personalizado)
  emojiFail: '❌',
  emojiHito: '🎉',

  // --- Reglas del conteo ---
  permitirRepetir: false, // false = un mismo usuario no puede contar dos veces seguidas
  celebrarHitos: true, // reacción extra en múltiplos de 100
  borrarInvalidos: false, // borrar mensajes que no son números
  avisarBorrados: true, // avisar si borran/editan el último número

  // --- Timeouts ---
  timeoutsActivos: true,
  // Para castigar a un admin hay que quitarle roles. Con esto en true solo se
  // le quitan los que dan permiso de Administrador; los de color, VIP y demás
  // se quedan. En false se le quitan todos los que el bot alcance.
  quitarSoloRolesAdmin: true,
  minutosPorNumero: 1, // minutos = número arruinado × este factor
  timeoutMinimoMin: 3,
  timeoutMaximoMin: 40320, // 28 días (máximo que permite Discord)

  // --- Anti-spam (reincidencia) ---
  multiplicadorSpam: 2, // cada infracción seguida multiplica el castigo por esto
  maxMultiplicadorSpam: 16, // tope del multiplicador
  ventanaSpamMin: 360, // 6 h sin arruinar = las infracciones se olvidan

  // --- Niveles ---
  xpPorAcierto: 1,
  xpBase: 20, // dificultad base del nivel 1
  xpExponente: 1.25, // cuánto se encarece cada nivel siguiente
  segmentosBarra: 10, // ▱▱▱▱▱▱▱▱▱▱
};

/** Claves que /config acepta, con su tipo y límites. */
const ESQUEMA = {
  emojiOk: { tipo: 'texto' },
  emojiFail: { tipo: 'texto' },
  permitirRepetir: { tipo: 'bool' },
  celebrarHitos: { tipo: 'bool' },
  borrarInvalidos: { tipo: 'bool' },
  avisarBorrados: { tipo: 'bool' },
  timeoutsActivos: { tipo: 'bool' },
  quitarSoloRolesAdmin: { tipo: 'bool' },
  minutosPorNumero: { tipo: 'num', min: 0.1, max: 60 },
  timeoutMinimoMin: { tipo: 'num', min: 1, max: 40320 },
  timeoutMaximoMin: { tipo: 'num', min: 1, max: 40320 },
  multiplicadorSpam: { tipo: 'num', min: 1, max: 10 },
  maxMultiplicadorSpam: { tipo: 'num', min: 1, max: 100 },
  ventanaSpamMin: { tipo: 'num', min: 1, max: 43200 },
  xpPorAcierto: { tipo: 'num', min: 0, max: 100 },
  xpBase: { tipo: 'num', min: 1, max: 10000 },
  xpExponente: { tipo: 'num', min: 1, max: 3 },
};

module.exports = { DEFAULTS, ESQUEMA };
