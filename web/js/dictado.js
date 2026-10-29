// Entiende un resultado dictado (o escrito) sin usar IA, con lo que la app ya sabe del partido:
// qué equipos juegan, sus managers y los jugadores que suele usar cada uno.
//
//   "Toluca dos, Chivas dos. Goles de Toluca: Paulinho y Guzmán. Goles de Chivas: Álvarez y Castañeda"
//   "Ganó Rosa tres a uno a Perrito. Goles de Rosa: Kane doblete y Musiala. De Perrito: Dembélé"
import { normalizarNombre, buscarParecido } from './liga.js';

const NUMEROS = {
  cero: 0, uno: 1, una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
};
const MULTIPLICADORES = { doblete: 2, doble: 2, triplete: 3, 'hat trick': 3, hattrick: 3, poker: 4 };

// Otros nombres con los que se conoce a algunos clubes.
const APODOS = {
  chivas: ['guadalajara', 'chivas', 'rebano'],
  'club guadalajara': ['guadalajara', 'chivas', 'rebano'],
  america: ['america', 'aguilas'],
  'cruz azul': ['cruz azul', 'la maquina', 'maquina'],
  monterrey: ['monterrey', 'rayados'],
  tigres: ['tigres', 'uanl'],
  pumas: ['pumas', 'unam'],
  toluca: ['toluca', 'diablos', 'diablos rojos'],
  santos: ['santos', 'laguna'],
  atlas: ['atlas', 'zorros'],
  barca: ['barca', 'barcelona'],
  barcelona: ['barca', 'barcelona'],
  paris: ['paris', 'psg'],
  psg: ['paris', 'psg'],
  bayern: ['bayern', 'munich'],
  'real madrid': ['real madrid', 'madrid'],
  city: ['city', 'manchester city'],
  inter: ['inter', 'internazionale'],
};

// Palabras de club demasiado comunes para identificar a un equipo por sí solas.
const GENERICAS = new Set(['club', 'real', 'deportivo', 'atletico', 'sporting', 'fc', 'cf', 'united', 'de', 'la', 'el', 'los', 'del']);

// Palabras de relleno que se quitan al buscar nombres de jugadores.
const RELLENO = new Set([
  'gol', 'goles', 'golazo', 'goleadores', 'goleador', 'anotadores', 'anoto', 'anotaron', 'metio', 'metieron',
  'marco', 'marcaron', 'de', 'del', 'el', 'la', 'los', 'las', 'por', 'con', 'para', 'su', 'sus', 'a', 'al',
  'en', 'que', 'son', 'fue', 'fueron', 'equipo', 'partido', 'resultado', 'quedo', 'quedaron', 'gano', 'ganaron',
  'perdio', 'empataron', 'empate', 'final', 'marcador', 'y', 'e', 'o', 'tambien', 'mas', 'otro', 'otra',
]);

const PALABRAS_GOL = new Set(['gol', 'goles', 'goleadores', 'goleador', 'anotadores', 'anotaron', 'anoto', 'marcaron', 'metieron']);

const capitalizar = (t) => t.replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1));

/** Separa en palabras, conservando la forma original de cada una para los nombres. */
function palabras(texto) {
  const separado = String(texto)
    .replace(/(\d+)\s*[-–:]\s*(\d+)/g, ' $1 a $2 ')    // "3-1" → "3 a 1"
    .replace(/([a-záéíóúüñ])(\d)/gi, '$1 $2')           // "dos2" → "dos 2"
    .replace(/(\d)([a-záéíóúüñ])/gi, '$1 $2');
  const salida = [];
  for (const m of separado.matchAll(/[\p{L}\p{M}'’.-]+|\d+|[,;:.()]/gu)) {
    const original = m[0];
    const norm = normalizarNombre(original).replace(/[^a-z0-9' -]/g, '').trim();
    if (/^[,;:.()]$/.test(original)) salida.push({ original, norm: '|', corte: true });
    else if (norm) salida.push({ original: original.replace(/\.$/, ''), norm });
  }
  return salida;
}

const numeroDe = (p) => (p && /^\d+$/.test(p.norm) ? Number(p.norm) : p && p.norm in NUMEROS ? NUMEROS[p.norm] : null);

/** Nombres con los que se puede mencionar a un equipo: club, apodos y manager. */
function alias(equipo) {
  const lista = new Set();
  const club = normalizarNombre(equipo.club || '');
  if (club) {
    lista.add(club);
    for (const a of APODOS[club] || []) lista.add(a);
    for (const w of club.split(' ')) if (w.length >= 4 && !GENERICAS.has(w)) lista.add(w);
  }
  if (equipo.manager) lista.add(normalizarNombre(equipo.manager));
  for (const a of equipo.alias || []) lista.add(normalizarNombre(a));
  return [...lista].filter(Boolean).sort((a, b) => b.split(' ').length - a.split(' ').length);
}

/** Busca en qué posiciones se menciona a cada equipo. */
function menciones(tokens, equipos) {
  const encontradas = [];
  const ocupado = new Set();
  equipos.forEach((eq, lado) => {
    for (const a of alias(eq)) {
      const partes = a.split(' ');
      for (let i = 0; i + partes.length <= tokens.length; i++) {
        if (partes.every((p, j) => tokens[i + j].norm === p) && !partes.some((_, j) => ocupado.has(i + j))) {
          encontradas.push({ lado, inicio: i, fin: i + partes.length });
          partes.forEach((_, j) => ocupado.add(i + j));
        }
      }
    }
  });
  return encontradas.sort((a, b) => a.inicio - b.inicio);
}

const palabrasNombre = (n) => normalizarNombre(n).split(' ').filter((w) => w.length >= 3);

/**
 * Jugador del manager cuyo nombre contiene todas las palabras dichas ("Mora" → "G. Mora").
 * Si hay varios, el más completo; si empatan, el que más ha usado (la lista viene ordenada así).
 */
function conTodasLasPalabras(escrito, jugadores) {
  const dichas = palabrasNombre(escrito);
  if (!dichas.length) return null;
  let mejor = null;
  for (const j of jugadores) {
    const suyas = normalizarNombre(j).split(' ');
    if (!dichas.every((w) => suyas.includes(w))) continue;
    if (!mejor || suyas.length > normalizarNombre(mejor).split(' ').length) mejor = j;
  }
  return mejor;
}

/** Convierte un pedazo de texto en goleadores (con repeticiones por doblete, "Kane dos", etc.). */
function goleadoresDe(tokens, jugadoresPropios, todos) {
  const goles = [];
  // Se separa por comas, "y", "e" y puntos.
  const trozos = [[]];
  for (const t of tokens) {
    if (t.corte || t.norm === 'y' || t.norm === 'e') trozos.push([]);
    else trozos[trozos.length - 1].push(t);
  }
  for (const trozo of trozos) {
    let veces = 1;
    const nombre = [];
    for (let i = 0; i < trozo.length; i++) {
      const t = trozo[i];
      const dosPalabras = i + 1 < trozo.length ? `${t.norm} ${trozo[i + 1].norm}` : '';
      if (MULTIPLICADORES[dosPalabras]) { veces = MULTIPLICADORES[dosPalabras]; i++; continue; }
      if (MULTIPLICADORES[t.norm]) { veces = MULTIPLICADORES[t.norm]; continue; }
      const n = numeroDe(t);
      if (n !== null && n > 1 && n <= 5) { veces = n; continue; }
      if (n !== null || RELLENO.has(t.norm)) continue;
      nombre.push(t.original);
    }
    if (!nombre.length) continue;
    const escrito = nombre.join(' ');
    let jugador;
    if (normalizarNombre(escrito).startsWith('autogol')) jugador = 'Autogol';
    else if (conTodasLasPalabras(escrito, jugadoresPropios)) jugador = conTodasLasPalabras(escrito, jugadoresPropios);
    else {
      const propio = buscarParecido(escrito, jugadoresPropios, 0.8);
      const general = propio.tipo === 'nuevo' ? buscarParecido(escrito, todos, 0.88) : propio;
      jugador = general.tipo === 'nuevo' ? capitalizar(escrito) : general.nombre;
    }
    for (let k = 0; k < veces; k++) goles.push({ jugador, conocido: jugador === 'Autogol' || [...jugadoresPropios, ...todos].includes(jugador) });
  }
  return goles;
}

/**
 * Interpreta el texto dictado.
 * equipos = [local, visitante], cada uno { club, manager, jugadores: [nombres conocidos] }.
 * Regresa { marcador: [gl|null, gv|null], goles: [[...], [...]], avisos: [] }.
 */
export function interpretarDictado(texto, equipos, todos = []) {
  const tokens = palabras(texto);
  const marcador = [null, null];
  const goles = [[], []];
  const avisos = [];
  const lista = menciones(tokens, equipos);
  if (!lista.length) {
    return { marcador, goles, avisos: ['No reconocí a ningún equipo. Di el nombre del club o del manager, por ejemplo: "Toluca dos, Chivas dos".'] };
  }

  lista.forEach((m, k) => {
    const otro = 1 - m.lado;
    let resto = tokens.slice(m.fin, k + 1 < lista.length ? lista[k + 1].inicio : tokens.length);
    // "Goles de" justo antes del siguiente equipo pertenece al siguiente, no a este.
    while (resto.length && (RELLENO.has(resto[resto.length - 1].norm) || resto[resto.length - 1].corte)) resto = resto.slice(0, -1);
    const antes = tokens.slice(Math.max(0, m.inicio - 3), m.inicio);
    const esDeGoles = antes.some((t) => PALABRAS_GOL.has(t.norm));
    let i = 0;
    while (i < resto.length && (resto[i].corte || (RELLENO.has(resto[i].norm) && resto[i].norm !== 'a'))) i++;

    // Marcador: "Toluca dos", "Toluca 2", "dos2" (palabra y dígito iguales), "Rosa tres a uno".
    if (!esDeGoles) {
      const primero = numeroDe(resto[i]);
      if (primero !== null) {
        let valor = primero;
        let j = i + 1;
        const repetido = numeroDe(resto[j]);
        if (repetido !== null && repetido === primero) j++;
        else if (repetido !== null && /^\d+$/.test(resto[j].norm)) { valor = repetido; j++; }
        marcador[m.lado] = valor;
        if (resto[j]?.norm === 'a' && numeroDe(resto[j + 1]) !== null) {
          if (marcador[otro] === null) marcador[otro] = numeroDe(resto[j + 1]);
          j += 2;
        }
        i = j;
      }
    }
    const nombres = goleadoresDe(resto.slice(i), equipos[m.lado].jugadores || [], todos);
    goles[m.lado].push(...nombres);
  });

  equipos.forEach((eq, lado) => {
    const n = goles[lado].length;
    const quien = eq.manager || eq.club;
    if (marcador[lado] === null && n) {
      marcador[lado] = n;
      avisos.push(`No escuché el marcador de ${quien}; puse ${n} por los goleadores que dijiste.`);
    } else if (marcador[lado] !== null && n && n !== marcador[lado]) {
      avisos.push(`Dijiste ${marcador[lado]} de ${quien} pero ${n} goleador(es): revisa.`);
    }
    const nuevos = goles[lado].filter((g) => !g.conocido).map((g) => g.jugador);
    if (nuevos.length) avisos.push(`Jugador(es) que no estaban en el historial de ${quien}: ${[...new Set(nuevos)].join(', ')}. Revisa que estén bien escritos.`);
  });
  if (marcador.every((x) => x === null)) avisos.push('No escuché el marcador. Ejemplo: "Toluca dos, Chivas dos".');

  return { marcador, goles: goles.map((l) => l.map((g) => g.jugador)), avisos };
}

// ---------------------------------------------------------------------------
// Dictado grabado (iPhone): el audio se manda a Gemini por la misma acción del
// escáner y aquí se le dice que solo lo pase a texto.
// ---------------------------------------------------------------------------

export const ESQUEMA_AUDIO = {
  type: 'OBJECT',
  properties: { texto: { type: 'STRING' } },
  required: ['texto'],
};

export function instruccionesAudio({ local, visitante, jugadoresLocal, jugadoresVisitante }) {
  const lista = (arr) => arr.join(', ') || '(sin historial)';
  return [
    'Transcribe en español, palabra por palabra, lo que dice la persona en el audio.',
    `Está dictando el resultado de un partido de EA SPORTS FC: LOCAL = ${local} contra VISITANTE = ${visitante}.`,
    `Jugadores que ha usado el LOCAL: ${lista(jugadoresLocal)}.`,
    `Jugadores que ha usado el VISITANTE: ${lista(jugadoresVisitante)}.`,
    '',
    'Reglas:',
    '- Escribe solo lo que se dijo, en el mismo orden. No agregues, no resumas y no completes nada.',
    '- Si un nombre que se dice es claramente un jugador, club o manager de arriba, escríbelo como aparece ahí.',
    '- Los números puedes escribirlos con letra o con dígito.',
    '- Si no se entiende nada o no se habla, regresa texto vacío.',
    'Responde en "texto".',
  ].join('\n');
}
