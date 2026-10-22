'use strict';

/**
 * Lee el número de un mensaje del contador. Acepta:
 *   · Cifras, con texto detrás:  "13", "13 vamos!"
 *   · Cuentas:                    "1+1", "99999999-99999998", "(2+3)*4", "10/2", "2^5", "3x4"
 *   · Palabras en español o inglés, si el mensaje es solo el número:
 *                                 "uno", "veintitrés", "dos mil trescientos",
 *                                 "twenty-one", "one hundred and five"
 *
 * Devuelve { valor, texto } (texto = lo que escribió) o null si no es un número.
 *
 * Las cuentas se leen con un analizador propio, nunca con eval(): solo entiende
 * números, + - * / ^ y paréntesis. Una cuenta que no da un entero positivo
 * (3/2, 5-9, 1/0) no cuenta como número.
 */

const MAX_LARGO = 200; // no se analizan mensajes más largos que esto
const MAX_PARENTESIS = 20;

function leerNumero(contenido) {
  const limpio = normalizar(contenido);
  if (!limpio) return null;
  return leerCuenta(limpio) ?? leerPalabras(limpio);
}

/**
 * Quita lo que no cambia el número: formato de Discord alrededor (**3**,
 * ||3||, `3`, > 3, # 3) y cifras raras del móvil (３ → 3, 3️⃣ → 3).
 */
function normalizar(contenido) {
  return String(contenido ?? '')
    .normalize('NFKC')
    .replace(/(\d)️?⃣/g, '$1')
    .trim()
    .replace(/^[\s*_~|`>#]+/, '')
    .replace(/[\s*_~|`]+$/, '')
    .slice(0, MAX_LARGO);
}

/**
 * ¿Es un intento de número aunque esté mal escrito? ("3a", "3/2", "5-9")
 * Sirve para castigarlo como número equivocado (suave) y no como charla.
 */
function pareceNumero(contenido) {
  return /\p{Nd}/u.test(normalizar(contenido));
}

/* ------------------------------------------------------------------ */
/* Cifras y cuentas                                                    */
/* ------------------------------------------------------------------ */

const OPERADORES = {
  '+': '+',
  '-': '-',
  '−': '-',
  '*': '*',
  '×': '*',
  x: '*',
  X: '*',
  '/': '/',
  '÷': '/',
  '^': '^',
  '(': '(',
  ')': ')',
};

/** Trocea el principio del mensaje en números y operadores; para en lo primero que no entienda. */
function trocear(s) {
  const piezas = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      i++;
      continue;
    }
    const cifras = /^\d+/.exec(s.slice(i));
    if (cifras) {
      if (cifras[0].length > 15) break;
      piezas.push({ num: Number(cifras[0]), fin: i + cifras[0].length });
      i += cifras[0].length;
      continue;
    }
    const op = OPERADORES[s[i]];
    if (!op) break;
    piezas.push({ op, fin: i + 1 });
    i++;
  }
  return piezas;
}

/**
 * Analiza la cuenta más larga posible desde el principio.
 * Si un operador no va seguido de nada válido ("13 - vamos"), se queda con lo de antes.
 * Devuelve { valor, pos } (pos = piezas usadas) o null.
 */
function analizar(piezas) {
  let parentesis = 0;
  const op = (p) => piezas[p]?.op;

  function primario(p) {
    const t = piezas[p];
    if (!t) return null;
    if (t.num !== undefined) return { valor: t.num, pos: p + 1 };
    if (t.op !== '(' || parentesis >= MAX_PARENTESIS) return null;
    parentesis++;
    const dentro = suma(p + 1);
    parentesis--;
    if (dentro && op(dentro.pos) === ')') return { valor: dentro.valor, pos: dentro.pos + 1 };
    return null;
  }

  function potencia(p) {
    const base = primario(p);
    if (!base || op(base.pos) !== '^') return base;
    const exp = potencia(base.pos + 1);
    return exp ? { valor: base.valor ** exp.valor, pos: exp.pos } : base;
  }

  function producto(p) {
    let izq = potencia(p);
    while (izq && (op(izq.pos) === '*' || op(izq.pos) === '/')) {
      const signo = op(izq.pos);
      const der = potencia(izq.pos + 1);
      if (!der) break;
      izq = { valor: signo === '*' ? izq.valor * der.valor : izq.valor / der.valor, pos: der.pos };
    }
    return izq;
  }

  function suma(p) {
    let izq = producto(p);
    while (izq && (op(izq.pos) === '+' || op(izq.pos) === '-')) {
      const signo = op(izq.pos);
      const der = producto(izq.pos + 1);
      if (!der) break;
      izq = { valor: signo === '+' ? izq.valor + der.valor : izq.valor - der.valor, pos: der.pos };
    }
    return izq;
  }

  return suma(0);
}

function leerCuenta(s) {
  if (!/^[\d(]/.test(s)) return null;
  const piezas = trocear(s);
  const r = analizar(piezas);
  if (!r) return null;

  const fin = piezas[r.pos - 1].fin;
  // "13abc" no es un número (pero "13 vamos" y "13!" sí)
  if (/^[\p{L}\p{N}_]/u.test(s.slice(fin))) return null;
  if (!Number.isSafeInteger(r.valor) || r.valor < 0) return null;
  return { valor: r.valor, texto: s.slice(0, fin).trim() };
}

/* ------------------------------------------------------------------ */
/* Números escritos con palabras                                       */
/* ------------------------------------------------------------------ */

/** Palabras que suman su valor. Sin tildes: se quitan antes de buscar. */
const UNIDADES = {
  // Español
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21,
  veintiuno: 21, veintiuna: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300,
  cuatrocientos: 400, cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600,
  seiscientas: 600, setecientos: 700, setecientas: 700, ochocientos: 800, ochocientas: 800,
  novecientos: 900, novecientas: 900,
  // Inglés
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/** Palabras que cierran un grupo: "dos mil" = 2 × 1000. */
const MILES = {
  mil: 1e3, thousand: 1e3,
  millon: 1e6, millones: 1e6, million: 1e6, millions: 1e6,
};

const CONECTORES = new Set(['y', 'and']);

function leerPalabras(s) {
  if (/\d/.test(s)) return null; // mezcla de cifras y palabras: no

  const palabras = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // fuera tildes
    .replace(/[^\p{L}\s-]/gu, ' ') // fuera signos y emojis: "¡veinte!" → "veinte"
    .split(/[\s-]+/)
    .filter(Boolean);
  if (!palabras.length || palabras.length > 12) return null;

  // Solo cuenta si TODO el mensaje es el número: "una pregunta" no es un 1
  let total = 0;
  let grupo = 0;
  let hayNumero = false;
  for (let i = 0; i < palabras.length; i++) {
    const p = palabras[i];
    if (CONECTORES.has(p)) {
      if (!hayNumero || i === palabras.length - 1) return null;
    } else if (p in UNIDADES) {
      grupo += UNIDADES[p];
      hayNumero = true;
    } else if (p === 'hundred' || p === 'hundreds') {
      grupo = (grupo || 1) * 100;
      hayNumero = true;
    } else if (p in MILES) {
      total += (grupo || 1) * MILES[p];
      grupo = 0;
      hayNumero = true;
    } else {
      return null;
    }
  }
  if (!hayNumero) return null;

  const valor = total + grupo;
  return Number.isSafeInteger(valor) ? { valor, texto: s.trim() } : null;
}

module.exports = { leerNumero, pareceNumero };
