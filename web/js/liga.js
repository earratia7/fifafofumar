// Reglas y cálculos de la liga. No toca la pantalla: recibe datos y regresa datos.

export const DESCANSO = 'Descanso';
export const SEMANAS_DEFAULT = 6;

// Tipos de torneo. El Relámpago puede durar 3 o 2 semanas.
export const TIPOS = [
  { nombre: 'Torneo Clásico', icono: '🏆', semanas: [6] },
  { nombre: 'Torneo Cinco Estrellas', icono: '⭐', semanas: [5] },
  { nombre: 'Copa La Onza', icono: '🏅', semanas: [4] },
  { nombre: 'Torneo Relámpago', icono: '⚡', semanas: [3, 2] },
];

/** Todas las combinaciones que se pueden elegir: una por tipo y duración. */
export const OPCIONES_TORNEO = TIPOS.flatMap((t) => t.semanas.map((semanas) => ({ tipo: t.nombre, icono: t.icono, semanas })));

export function tipoPorSemanas(semanas) {
  return TIPOS.find((t) => t.semanas.includes(semanas))?.nombre || 'Especial';
}

export const iconoTipo = (nombre) => TIPOS.find((t) => t.nombre === nombre)?.icono || '🎮';
const ALIAS_MANAGER = { pedroga: 'Pedro' };

const RE_EMOJI = /^\s*(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic}|[\u{E0020}-\u{E007F}])*)/u;
const RE_BANDERA = /\p{Regional_Indicator}|\u{1F3F4}/u;

const texto = (v) => (v === null || v === undefined ? '' : String(v).trim());
const entero = (v) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
};
const esVerdadero = (v) => v === true || v === 1 || ['1', 'true', 'verdadero', 'si', 'sí'].includes(texto(v).toLowerCase());

export const esDescanso = (equipo) => texto(equipo).toLowerCase() === DESCANSO.toLowerCase();

export function normalizarManager(nombre) {
  const n = texto(nombre);
  if (!n) return '';
  return ALIAS_MANAGER[n.toLowerCase()] || n.charAt(0).toUpperCase() + n.slice(1);
}

/** "🦕Frankfurt (Enorme)" o "🦕Enorme  América" → { emoji, club, manager } */
export function separarEquipo(nombre) {
  const s = texto(nombre);
  if (esDescanso(s)) return { emoji: '😴', club: DESCANSO, manager: '' };
  const emoji = (s.match(RE_EMOJI) || [''])[0];
  const resto = s.slice(emoji.length).replace(/\s+/g, ' ').trim();
  const parentesis = resto.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (parentesis) return { emoji: emoji.trim(), club: parentesis[1].trim(), manager: normalizarManager(parentesis[2]) };
  const [primero = '', ...demas] = resto.split(' ');
  return { emoji: emoji.trim(), club: demas.join(' '), manager: normalizarManager(primero) };
}

/** Quita acentos, puntos y mayúsculas para comparar nombres de jugadores. */
export function normalizarNombre(t) {
  return texto(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.\-–]/g, ' ').replace(/['’`´]/g, '').replace(/\s+/g, ' ').trim();
}

/** Un goleador "A", "." o vacío es un relleno, no un jugador real. */
export const esNombreValido = (n) => /\p{L}{2,}/u.test(texto(n));


// ---------------------------------------------------------------------------
// Construcción del modelo a partir de las filas de la hoja
// ---------------------------------------------------------------------------

export function construirLiga(crudo) {
  const managersHoja = new Map();
  for (const r of crudo.Managers || []) {
    const nombre = normalizarManager(r.Manager);
    if (nombre) managersHoja.set(nombre, { nombre, emoji: texto(r.Emoji) });
  }

  // Torneos en el orden en que aparecen en la hoja Equipos.
  const torneos = new Map();
  for (const r of crudo.Equipos || []) {
    const nombreTorneo = texto(r.Torneo);
    const equipo = texto(r.Equipo);
    if (!nombreTorneo || !equipo) continue;
    if (!torneos.has(nombreTorneo)) {
      torneos.set(nombreTorneo, { nombre: nombreTorneo, archivado: false, equipos: [], porEquipo: new Map(), orden: torneos.size });
    }
    const t = torneos.get(nombreTorneo);
    const info = separarEquipo(equipo);
    const delaColumna = esDescanso(equipo) ? '' : normalizarManager(r.Manager);
    const manager = delaColumna || info.manager;
    // Si la columna Manager trae otro nombre, todo el texto es el club ("Toluca" con manager Perrito).
    const club = !delaColumna || delaColumna === info.manager ? info.club : [info.manager, info.club].filter(Boolean).join(' ');
    // Sin emoji en el nombre, se usa el del manager (hoja Managers).
    const emoji = info.emoji || managersHoja.get(manager)?.emoji || '';
    const ficha = { nombre: equipo, emoji, club, manager, descanso: esDescanso(equipo) };
    t.equipos.push(ficha);
    t.porEquipo.set(equipo, ficha);
    if (texto(r.Estado).toLowerCase() === 'archivado') t.archivado = true;
  }

  const partidos = (crudo.Partidos || []).map((r, i) => {
    const jornada = texto(r.Jornada);
    const m = jornada.match(/^S(\d+)J(\d+)$/i);
    return {
      fila: i,
      torneo: texto(r.Torneo),
      jornada,
      semana: m ? entero(m[1]) : 0,
      numJornada: m ? entero(m[2]) : 0,
      local: texto(r.Local),
      visitante: texto(r.Visitante),
      gl: entero(r.Goles_L),
      gv: entero(r.Goles_V),
      wo: esVerdadero(r.WO),
      descanso: esDescanso(r.Local) || esDescanso(r.Visitante),
    };
  }).filter((p) => p.torneo && p.local && p.visitante);

  const goles = (crudo.Goleadores || []).map((r) => ({
    torneo: texto(r.Torneo), jornada: texto(r.Jornada), equipo: texto(r.Equipo),
    jugador: texto(r.Jugador), goles: entero(r.Goles) || 1,
  })).filter((g) => g.torneo && g.equipo);

  const transferencias = (crudo.Transferencias || []).map((r) => ({
    torneo: texto(r.Torneo), jornada: texto(r.Jornada), equipo: texto(r.Equipo),
    toma: texto(r.Toma), cede: texto(r.Cede),
  })).filter((t) => t.torneo && t.equipo);

  // Ajustes de cada torneo (hoja Torneos). Sin fila: los archivados duran lo que se jugó, los activos 6 semanas.
  const ajustes = new Map((crudo.Torneos || []).map((r) => [texto(r.Torneo), r]));
  for (const t of torneos.values()) {
    const a = ajustes.get(t.nombre);
    // Solo cuentan resultados reales: los descansos guardados no impiden acortar el torneo.
    const jugadas = Math.max(0, ...partidos.filter((p) => p.torneo === t.nombre && !p.descanso).map((p) => p.semana));
    t.semanas = entero(a?.Semanas) || (t.archivado ? jugadas || SEMANAS_DEFAULT : Math.max(SEMANAS_DEFAULT, jugadas));
    t.tipo = texto(a?.Tipo) || tipoPorSemanas(t.semanas);
    t.goleadores = !a || !['no', 'false', '0'].includes(texto(a.Goleadores).toLowerCase());
    t.semanasJugadas = jugadas;
  }

  const conGoleadores = (torneo) => torneos.get(torneo)?.goleadores !== false;
  // Orden cronológico (torneo, semana, jornada) aunque en la hoja se hayan agregado al final al corregirlos.
  const ordenTorneo = (t) => torneos.get(t)?.orden ?? 999;
  partidos.sort((a, b) => ordenTorneo(a.torneo) - ordenTorneo(b.torneo) || a.semana - b.semana || a.numJornada - b.numJornada || a.fila - b.fila);

  const liga = { torneos, partidos, goles: goles.filter((g) => conGoleadores(g.torneo)), transferencias, managersHoja };

  // Ficha de un equipo dentro de un torneo, aunque no esté dado de alta en Equipos.
  liga.ficha = (torneo, equipo) => {
    const t = torneos.get(torneo);
    const f = t && t.porEquipo.get(equipo);
    if (f) return f;
    const info = separarEquipo(equipo);
    return { nombre: equipo, emoji: info.emoji, club: info.club, manager: info.manager, descanso: esDescanso(equipo) };
  };
  liga.managerDe = (torneo, equipo) => liga.ficha(torneo, equipo).manager;

  liga.managers = listarManagers(liga);
  liga.emojiDe = (manager) => liga.managers.get(manager)?.emoji || '⚽';
  return liga;
}

function listarManagers(liga) {
  const lista = new Map();
  for (const [nombre, m] of liga.managersHoja) lista.set(nombre, { nombre, emoji: m.emoji });
  for (const t of liga.torneos.values()) {
    for (const e of t.equipos) {
      if (!e.manager) continue;
      const actual = lista.get(e.manager) || { nombre: e.manager, emoji: '' };
      // Si la hoja Managers no trae emoji, usamos el más reciente que no sea bandera.
      if (!liga.managersHoja.get(e.manager)?.emoji && e.emoji && !RE_BANDERA.test(e.emoji)) actual.emoji = e.emoji;
      lista.set(e.manager, actual);
    }
  }
  return lista;
}

export function torneosOrdenados(liga) {
  const todos = [...liga.torneos.values()];
  const activos = todos.filter((t) => !t.archivado).reverse();
  const archivados = todos.filter((t) => t.archivado).reverse();
  return [...activos, ...archivados];
}


// ---------------------------------------------------------------------------
// Calendario (misma plantilla que la app original, para respetar las jornadas)
// ---------------------------------------------------------------------------

// Cada semana es un todos contra todos. Con 5 equipos el sexto es el "Descanso".
const PLANTILLAS = {
  // 6 equipos: 15 partidos en 8 jornadas.
  6: [[[0, 1], [2, 3]], [[4, 5], [0, 2]], [[1, 3], [4, 2]], [[0, 4], [1, 5]], [[2, 5], [3, 0]], [[1, 4], [3, 5]], [[0, 5], [1, 2]], [[3, 4]]],
  // 4 equipos: 6 partidos en 3 jornadas; todos juegan en cada jornada.
  4: [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]],
};

export const equiposValidos = (n) => n in PLANTILLAS;

export function generarCalendario(equipos, semana) {
  const plantilla = PLANTILLAS[equipos.length];
  if (!plantilla) return [];
  const cal = [];
  plantilla.forEach((jornada, j) => {
    for (let [a, b] of jornada) {
      if (semana % 2 === 0) [a, b] = [b, a];
      cal.push({ jornada: `S${semana}J${j + 1}`, numJornada: j + 1, local: equipos[a].nombre, visitante: equipos[b].nombre });
    }
  });
  return cal;
}

export function buscarPartido(liga, torneo, jornada, local, visitante) {
  return liga.partidos.find((p) => p.torneo === torneo && p.jornada === jornada && p.local === local && (!visitante || p.visitante === visitante));
}

/** Calendario de una semana con el resultado de cada partido (o null si falta). */
export function semanaConResultados(liga, torneo, semana) {
  const t = liga.torneos.get(torneo);
  if (!t) return [];
  return generarCalendario(t.equipos, semana).map((p) => ({
    ...p,
    descanso: esDescanso(p.local) || esDescanso(p.visitante),
    resultado: buscarPartido(liga, torneo, p.jornada, p.local, p.visitante) || null,
  }));
}

/** Primera semana que todavía tiene partidos sin jugar (sin contar descansos). */
export function semanaActual(liga, torneo) {
  const total = semanasDelTorneo(liga, torneo);
  for (let s = 1; s <= total; s++) {
    if (semanaConResultados(liga, torneo, s).some((p) => !p.descanso && !p.resultado)) return s;
  }
  return total;
}

/** Semanas a mostrar: las que dura el torneo, o las jugadas si se jugaron de más. */
export function semanasDelTorneo(liga, torneo) {
  const t = liga.torneos.get(torneo);
  if (!t) return 1;
  return Math.max(1, t.archivado ? t.semanasJugadas || t.semanas : Math.max(t.semanas, t.semanasJugadas));
}

/** Verdadero si ya se jugaron todos los partidos de todas las semanas del torneo. */
export function torneoCompleto(liga, torneo) {
  const total = semanasDelTorneo(liga, torneo);
  for (let s = 1; s <= total; s++) {
    if (semanaConResultados(liga, torneo, s).some((p) => !p.descanso && !p.resultado)) return false;
  }
  return true;
}


// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------

const filaVacia = () => ({ pj: 0, g: 0, e: 0, p: 0, gf: 0, gc: 0, pts: 0, forma: [] });

function sumar(fila, propios, ajenos) {
  fila.pj++;
  fila.gf += propios;
  fila.gc += ajenos;
  if (propios > ajenos) { fila.g++; fila.pts += 3; fila.forma.push('G'); }
  else if (propios < ajenos) { fila.p++; fila.forma.push('P'); }
  else { fila.e++; fila.pts += 1; fila.forma.push('E'); }
}

const ordenarTabla = (a, b) => b.pts - a.pts || b.dg - a.dg || b.gf - a.gf || a.nombre.localeCompare(b.nombre);

export function tablaTorneo(liga, torneo) {
  const t = liga.torneos.get(torneo);
  if (!t) return [];
  const filas = new Map(t.equipos.filter((e) => !e.descanso).map((e) => [e.nombre, { ...filaVacia(), equipo: e, nombre: e.nombre }]));
  for (const p of liga.partidos) {
    if (p.torneo !== torneo || p.descanso) continue;
    const l = filas.get(p.local), v = filas.get(p.visitante);
    if (!l || !v) continue;
    sumar(l, p.gl, p.gv);
    sumar(v, p.gv, p.gl);
  }
  return [...filas.values()].map((f) => ({ ...f, dg: f.gf - f.gc })).sort(ordenarTabla);
}

export function goleoTorneo(liga, torneo) {
  const mapa = new Map();
  for (const g of liga.goles) {
    if (g.torneo !== torneo || !esNombreValido(g.jugador)) continue;
    const clave = `${normalizarNombre(g.jugador)}|${g.equipo}`;
    const f = mapa.get(clave) || { jugador: g.jugador, equipo: liga.ficha(torneo, g.equipo), goles: 0 };
    f.goles += g.goles;
    mapa.set(clave, f);
  }
  return [...mapa.values()].sort((a, b) => b.goles - a.goles || a.jugador.localeCompare(b.jugador));
}

export function golesDelPartido(liga, partido) {
  return liga.goles.filter((g) => g.torneo === partido.torneo && g.jornada === partido.jornada &&
    (g.equipo === partido.local || g.equipo === partido.visitante));
}

export function transferenciasTorneo(liga, torneo) {
  return liga.transferencias.filter((t) => t.torneo === torneo && esNombreValido(t.toma))
    .sort((a, b) => b.jornada.localeCompare(a.jornada, 'es', { numeric: true }));
}


// ---------------------------------------------------------------------------
// Historial por manager
// ---------------------------------------------------------------------------

/** Campeón y subcampeón de cada torneo archivado, del más reciente al más viejo. */
export function palmares(liga) {
  return [...liga.torneos.values()].filter((t) => t.archivado).reverse().map((t) => {
    const tabla = tablaTorneo(liga, t.nombre);
    const goleo = t.goleadores ? goleoTorneo(liga, t.nombre) : [];
    const maxGoles = goleo[0]?.goles || 0;
    return {
      torneo: t.nombre,
      tipo: t.tipo,
      campeon: tabla[0] || null,
      subcampeon: tabla[1] || null,
      pichichis: goleo.filter((g) => g.goles === maxGoles && maxGoles > 0),
      jugados: liga.partidos.filter((p) => p.torneo === t.nombre && !p.descanso).length,
    };
  });
}

export function tablaHistorica(liga) {
  const filas = new Map();
  const fila = (m) => {
    if (!filas.has(m)) filas.set(m, { ...filaVacia(), nombre: m, manager: m, torneos: new Set(), titulos: 0, subtitulos: 0 });
    return filas.get(m);
  };
  for (const p of liga.partidos) {
    if (p.descanso) continue;
    const ml = liga.managerDe(p.torneo, p.local), mv = liga.managerDe(p.torneo, p.visitante);
    if (!ml || !mv) continue;
    const l = fila(ml), v = fila(mv);
    l.torneos.add(p.torneo);
    v.torneos.add(p.torneo);
    sumar(l, p.gl, p.gv);
    sumar(v, p.gv, p.gl);
  }
  for (const pal of palmares(liga)) {
    if (pal.campeon?.equipo.manager) fila(pal.campeon.equipo.manager).titulos++;
    if (pal.subcampeon?.equipo.manager) fila(pal.subcampeon.equipo.manager).subtitulos++;
  }
  return [...filas.values()].map((f) => ({
    ...f,
    dg: f.gf - f.gc,
    nTorneos: f.torneos.size,
    efectividad: f.pj ? Math.round((f.pts / (f.pj * 3)) * 100) : 0,
  })).sort((a, b) => b.titulos - a.titulos || b.efectividad - a.efectividad || b.pts - a.pts);
}

/** Goleadores de todos los torneos, juntando nombres escritos distinto ("Eberé" = "Ebere"). */
export function goleoHistorico(liga) {
  const mapa = new Map();
  for (const g of liga.goles) {
    if (!esNombreValido(g.jugador)) continue;
    const clave = normalizarNombre(g.jugador);
    const f = mapa.get(clave) || { jugador: g.jugador, goles: 0, managers: new Map(), torneos: new Set(), escrituras: new Map() };
    f.goles += g.goles;
    f.torneos.add(g.torneo);
    f.escrituras.set(g.jugador, (f.escrituras.get(g.jugador) || 0) + g.goles);
    const m = liga.managerDe(g.torneo, g.equipo);
    if (m) f.managers.set(m, (f.managers.get(m) || 0) + g.goles);
    mapa.set(clave, f);
  }
  return [...mapa.values()].map((f) => ({
    ...f,
    // Mostramos la forma de escribirlo que más se ha usado.
    jugador: [...f.escrituras.entries()].sort((a, b) => b[1] - a[1])[0][0],
    managers: [...f.managers.entries()].sort((a, b) => b[1] - a[1]),
  })).sort((a, b) => b.goles - a.goles || a.jugador.localeCompare(b.jugador));
}

export function caraACara(liga, a, b) {
  const res = { a, b, ga: 0, gb: 0, e: 0, golesA: 0, golesB: 0, partidos: [] };
  for (const p of liga.partidos) {
    if (p.descanso) continue;
    const ml = liga.managerDe(p.torneo, p.local), mv = liga.managerDe(p.torneo, p.visitante);
    let ladoA, ladoB;
    if (ml === a && mv === b) [ladoA, ladoB] = [p.gl, p.gv];
    else if (ml === b && mv === a) [ladoA, ladoB] = [p.gv, p.gl];
    else continue;
    res.golesA += ladoA;
    res.golesB += ladoB;
    if (ladoA > ladoB) res.ga++;
    else if (ladoB > ladoA) res.gb++;
    else res.e++;
    res.partidos.push(p);
  }
  res.partidos.reverse();
  return res;
}

/** Posición final de un manager en cada torneo que jugó. */
export function trayectoria(liga, manager) {
  const salida = [];
  for (const t of [...liga.torneos.values()].reverse()) {
    const tabla = tablaTorneo(liga, t.nombre);
    const i = tabla.findIndex((f) => f.equipo.manager === manager);
    if (i === -1) continue;
    salida.push({ torneo: t.nombre, archivado: t.archivado, posicion: i + 1, de: tabla.length, fila: tabla[i] });
  }
  return salida;
}


// ---------------------------------------------------------------------------
// Sugerencias de goleadores al registrar un partido
// ---------------------------------------------------------------------------

/** Jugadores de un manager: primero los del torneo actual (y sus refuerzos), luego su historial. */
export function jugadoresDelManager(liga, torneo, manager) {
  const puntaje = new Map();
  const nombreBonito = new Map();
  const sumarJugador = (nombre, puntos) => {
    if (!esNombreValido(nombre)) return;
    const clave = normalizarNombre(nombre);
    puntaje.set(clave, (puntaje.get(clave) || 0) + puntos);
    if (!nombreBonito.has(clave) || puntos >= 100) nombreBonito.set(clave, nombre);
  };
  for (const g of liga.goles) {
    if (liga.managerDe(g.torneo, g.equipo) !== manager) continue;
    sumarJugador(g.jugador, g.torneo === torneo ? 100 * g.goles : g.goles);
  }
  for (const t of liga.transferencias) {
    if (t.torneo === torneo && liga.managerDe(t.torneo, t.equipo) === manager) sumarJugador(t.toma, 150);
  }
  return [...puntaje.entries()].sort((a, b) => b[1] - a[1]).map(([clave, puntos]) => ({ nombre: nombreBonito.get(clave), delTorneo: puntos >= 100 }));
}

export function todosLosJugadores(liga) {
  const vistos = new Map();
  for (const g of liga.goles) if (esNombreValido(g.jugador)) vistos.set(normalizarNombre(g.jugador), g.jugador);
  return [...vistos.values()];
}

function similitud(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let previa = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const actual = [i];
    for (let j = 1; j <= n; j++) {
      actual[j] = Math.min(previa[j] + 1, actual[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previa = actual;
  }
  return 1 - previa[n] / Math.max(m, n);
}

const apellidos = (n) => new Set(n.split(' ').filter((w) => w.length >= 3));

/**
 * Busca si un nombre escrito ya existe con otra forma de escribirse.
 * Regresa { tipo: 'identico' | 'parecido' | 'nuevo', nombre }.
 */
export function buscarParecido(escrito, existentes, umbral = 0.82) {
  const ne = normalizarNombre(escrito);
  if (!ne) return { tipo: 'nuevo', nombre: null };
  const ae = apellidos(ne);
  let mejor = null, mejorPuntaje = 0;
  for (const ex of existentes) {
    const nx = normalizarNombre(ex);
    if (nx === ne) return { tipo: 'identico', nombre: ex };
    const ax = apellidos(nx);
    let puntaje = similitud(ne, nx);
    for (const a of (ae.size ? ae : [ne])) for (const b of (ax.size ? ax : [nx])) puntaje = Math.max(puntaje, similitud(a, b));
    if ([...ae].some((w) => ax.has(w))) puntaje = Math.max(puntaje, 0.96);
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = ex; }
  }
  return mejorPuntaje >= umbral ? { tipo: 'parecido', nombre: mejor } : { tipo: 'nuevo', nombre: null };
}
