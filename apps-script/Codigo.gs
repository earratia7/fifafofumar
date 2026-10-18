/**
 * Servidor de la app FifafoFumar.
 * Vive dentro del Google Sheet (Extensiones > Apps Script) y es el único que
 * lee y escribe en la hoja. La página web solo habla con este código.
 *
 * Propiedades del script (Configuración del proyecto > Propiedades del script):
 *   CLAVE           Clave secreta que viaja en el enlace de la liga (#k=...).
 *   GEMINI_API_KEY  Llave de Google AI Studio para el escáner de marcadores.
 *   GEMINI_MODELO   (Opcional) Modelo de Gemini. Por defecto gemini-2.5-flash.
 */

const COLUMNAS = {
  Partidos: ['Torneo', 'Jornada', 'Local', 'Goles_L', 'Goles_V', 'Visitante', 'WO'],
  Equipos: ['Torneo', 'Equipo', 'Estado', 'Manager'],
  Goleadores: ['Torneo', 'Jornada', 'Equipo', 'Jugador', 'Goles'],
  Transferencias: ['Torneo', 'Jornada', 'Equipo', 'Toma', 'Cede'],
  Managers: ['Manager', 'Emoji'],
  Torneos: ['Torneo', 'Tipo', 'Semanas', 'Goleadores'],
};

// Tipos de torneo y cuántas semanas puede durar cada uno.
const TIPOS = [
  { nombre: 'Torneo Clásico', semanas: [6] },
  { nombre: 'Torneo Cinco Estrellas', semanas: [5] },
  { nombre: 'Copa La Onza', semanas: [4] },
  { nombre: 'Torneo Relámpago', semanas: [3, 2] },
];
const SEMANAS_DEFAULT = 6;

function tipoPorSemanas_(semanas) {
  const tipo = TIPOS.filter(function (t) { return t.semanas.indexOf(semanas) !== -1; })[0];
  return tipo ? tipo.nombre : 'Especial';
}

/** Revisa que el tipo exista y admita esas semanas. Regresa { tipo, semanas }. */
function validarTipo_(nombreTipo, semanas) {
  const tipo = TIPOS.filter(function (t) { return t.nombre === texto_(nombreTipo); })[0];
  if (!tipo) throw new Error('Tipo de torneo desconocido: ' + nombreTipo);
  const s = entero_(semanas) || tipo.semanas[0];
  if (tipo.semanas.indexOf(s) === -1) throw new Error(tipo.nombre + ' no puede durar ' + s + ' semanas.');
  return { tipo: tipo.nombre, semanas: s };
}

/** Última semana del torneo con algún resultado real guardado (sin contar descansos). */
function ultimaSemanaJugada_(torneo) {
  let maxima = 0;
  leerHoja_('Partidos').forEach(function (p) {
    if (texto_(p.Torneo) !== torneo) return;
    if (texto_(p.Local).toLowerCase() === DESCANSO.toLowerCase() || texto_(p.Visitante).toLowerCase() === DESCANSO.toLowerCase()) return;
    const m = texto_(p.Jornada).match(/^S(\d+)J/i);
    if (m) maxima = Math.max(maxima, entero_(m[1]));
  });
  return maxima;
}

// Managers que aparecieron con otro nombre en torneos viejos.
const ALIAS_MANAGER = { pedroga: 'Pedro' };

const DESCANSO = 'Descanso';


// ---------------------------------------------------------------------------
// Entrada de la web
// ---------------------------------------------------------------------------

function doGet(e) {
  return responder_(function () {
    verificarClave_(e.parameter.k);
    return { datos: leerTodo_() };
  });
}

function doPost(e) {
  return responder_(function () {
    const cuerpo = JSON.parse(e.postData.contents);
    verificarClave_(cuerpo.k);
    const accion = ACCIONES_[cuerpo.accion];
    if (!accion) throw new Error('Acción desconocida: ' + cuerpo.accion);
    return accion(cuerpo.datos || {});
  });
}

const ACCIONES_ = {
  guardarResultado: guardarResultado_,
  borrarResultado: borrarResultado_,
  reemplazarResultado: reemplazarResultado_,
  editarRefuerzo: editarRefuerzo_,
  crearTorneo: crearTorneo_,
  cambiarEstadoTorneo: cambiarEstadoTorneo_,
  ajustarTorneo: ajustarTorneo_,
  guardarManager: guardarManager_,
  escanear: escanear_,
  importarHistorico: importarHistorico_,
};

function responder_(fn) {
  let salida;
  try {
    salida = Object.assign({ ok: true }, fn());
  } catch (err) {
    salida = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(salida))
    .setMimeType(ContentService.MimeType.JSON);
}

function verificarClave_(clave) {
  const correcta = PropertiesService.getScriptProperties().getProperty('CLAVE');
  if (!correcta) throw new Error('Falta configurar la CLAVE en las propiedades del script.');
  if (String(clave || '') !== correcta) throw new Error('CLAVE_INVALIDA');
}


// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

function leerTodo_() {
  const salida = {};
  Object.keys(COLUMNAS).forEach(function (nombre) {
    salida[nombre] = leerHoja_(nombre);
  });
  return salida;
}

function leerHoja_(nombre) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!hoja || hoja.getLastRow() < 2) return [];
  const valores = hoja.getDataRange().getValues();
  const encabezados = valores[0].map(function (h) { return String(h).trim(); });
  const filas = [];
  for (let i = 1; i < valores.length; i++) {
    const fila = valores[i];
    if (fila.every(function (v) { return v === '' || v === null; })) continue;
    const obj = {};
    encabezados.forEach(function (h, j) { if (h) obj[h] = fila[j]; });
    filas.push(obj);
  }
  return filas;
}


// ---------------------------------------------------------------------------
// Escritura (siempre agrega filas al final, nunca reescribe la hoja completa)
// ---------------------------------------------------------------------------

function conCandado_(fn) {
  const candado = LockService.getScriptLock();
  candado.waitLock(20000);
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    candado.releaseLock();
  }
}

/** Devuelve la hoja y el número de columna (base 1) de cada encabezado, creando lo que falte. */
function prepararHoja_(nombre) {
  const libro = SpreadsheetApp.getActive();
  const hoja = libro.getSheetByName(nombre) || libro.insertSheet(nombre);
  const ultimaCol = Math.max(hoja.getLastColumn(), 1);
  const encabezados = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0].map(function (h) { return String(h).trim(); });
  COLUMNAS[nombre].forEach(function (col) {
    if (encabezados.indexOf(col) === -1) {
      let libre = encabezados.indexOf('');
      if (libre === -1) libre = encabezados.length;
      hoja.getRange(1, libre + 1).setValue(col);
      encabezados[libre] = col;
    }
  });
  const posicion = {};
  encabezados.forEach(function (h, i) { if (h) posicion[h] = i; });
  return { hoja: hoja, posicion: posicion, ancho: encabezados.length };
}

function agregarFilas_(nombre, objetos) {
  if (!objetos.length) return;
  const h = prepararHoja_(nombre);
  const filas = objetos.map(function (obj) {
    const fila = new Array(h.ancho).fill('');
    Object.keys(obj).forEach(function (k) {
      if (k in h.posicion) fila[h.posicion[k]] = obj[k];
    });
    return fila;
  });
  h.hoja.getRange(h.hoja.getLastRow() + 1, 1, filas.length, h.ancho).setValues(filas);
}

/** Borra (de abajo hacia arriba) las filas para las que cumple(obj) es verdadero. */
function borrarFilas_(nombre, cumple) {
  const hoja = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!hoja || hoja.getLastRow() < 2) return 0;
  const valores = hoja.getDataRange().getValues();
  const encabezados = valores[0].map(function (h) { return String(h).trim(); });
  let borradas = 0;
  for (let i = valores.length - 1; i >= 1; i--) {
    const obj = {};
    encabezados.forEach(function (h, j) { obj[h] = valores[i][j]; });
    if (cumple(obj)) {
      hoja.deleteRow(i + 1);
      borradas++;
    }
  }
  return borradas;
}

/** Datos del partido que vienen de la app, ya limpios. */
function datosPartido_(d) {
  const p = {
    torneo: texto_(d.torneo), jornada: texto_(d.jornada),
    local: texto_(d.local), visitante: texto_(d.visitante),
  };
  if (!p.torneo || !p.jornada || !p.local || !p.visitante) throw new Error('Faltan datos del partido.');
  return p;
}

function esElPartido_(p) {
  return function (fila) {
    return texto_(fila.Torneo) === p.torneo && texto_(fila.Jornada) === p.jornada &&
      texto_(fila.Local) === p.local && texto_(fila.Visitante) === p.visitante;
  };
}

/** Filas de Goleadores o Transferencias que pertenecen al partido. */
function delPartido_(p) {
  return function (fila) {
    return texto_(fila.Torneo) === p.torneo && texto_(fila.Jornada) === p.jornada &&
      (texto_(fila.Equipo) === p.local || texto_(fila.Equipo) === p.visitante);
  };
}

/** Escribe partido, goleadores y refuerzo. Se llama siempre dentro de conCandado_. */
function escribirResultado_(p, d) {
  agregarFilas_('Partidos', [{
    Torneo: p.torneo, Jornada: p.jornada, Local: p.local, Goles_L: entero_(d.gl), Goles_V: entero_(d.gv),
    Visitante: p.visitante, WO: d.wo ? 1 : 0,
  }]);

  // Un renglón por jugador con el total de goles que metió en el partido.
  const porJugador = {};
  (d.goleadores || []).forEach(function (g) {
    const equipo = texto_(g.equipo), jugador = texto_(g.jugador);
    if (!equipo || !jugador) return;
    const clave = equipo + '\u0000' + jugador;
    porJugador[clave] = porJugador[clave] || { Torneo: p.torneo, Jornada: p.jornada, Equipo: equipo, Jugador: jugador, Goles: 0 };
    porJugador[clave].Goles += entero_(g.goles || 1);
  });
  agregarFilas_('Goleadores', Object.keys(porJugador).map(function (k) { return porJugador[k]; }));

  const t = d.transferencia;
  if (t && texto_(t.toma)) {
    agregarFilas_('Transferencias', [{
      Torneo: p.torneo, Jornada: p.jornada, Equipo: texto_(t.equipo),
      Toma: texto_(t.toma), Cede: texto_(t.cede) || 'J.G.',
    }]);
  }
}

function guardarResultado_(d) {
  const p = datosPartido_(d);
  return conCandado_(function () {
    if (leerHoja_('Partidos').some(esElPartido_(p))) {
      throw new Error('Ese partido ya estaba registrado. Actualiza la app para verlo.');
    }
    escribirResultado_(p, d);
    return { datos: leerTodo_() };
  });
}

/**
 * Corrige un resultado ya guardado: borra el anterior (con sus goleadores y refuerzo) y escribe
 * el nuevo en un solo paso, con la hoja bloqueada. Si algo falla, no se pierde el original.
 */
function reemplazarResultado_(d) {
  const p = datosPartido_(d);
  return conCandado_(function () {
    if (!leerHoja_('Partidos').some(esElPartido_(p))) {
      throw new Error('Ese partido ya no estaba guardado. Actualiza la app.');
    }
    borrarFilas_('Partidos', esElPartido_(p));
    borrarFilas_('Goleadores', delPartido_(p));
    borrarFilas_('Transferencias', delPartido_(p));
    escribirResultado_(p, d);
    return { datos: leerTodo_() };
  });
}

function borrarResultado_(d) {
  const p = datosPartido_(d);
  return conCandado_(function () {
    if (!borrarFilas_('Partidos', esElPartido_(p))) throw new Error('No encontré ese partido en la hoja.');
    borrarFilas_('Goleadores', delPartido_(p));
    borrarFilas_('Transferencias', delPartido_(p));
    return { datos: leerTodo_() };
  });
}

/**
 * Cambia solo el refuerzo de un partido, sin tocar marcador ni goleadores.
 * Sin "toma" se quita el refuerzo.
 */
function editarRefuerzo_(d) {
  const p = datosPartido_(d);
  const equipo = texto_(d.equipo);
  if (equipo !== p.local && equipo !== p.visitante) throw new Error('El refuerzo debe ser de uno de los dos equipos.');
  const toma = texto_(d.toma), cede = texto_(d.cede) || 'J.G.';
  return conCandado_(function () {
    if (!leerHoja_('Partidos').some(esElPartido_(p))) throw new Error('Ese partido no está guardado.');
    const h = prepararHoja_('Transferencias');
    const valores = h.hoja.getDataRange().getValues();
    for (let i = valores.length - 1; i >= 1; i--) {
      const fila = valores[i];
      const esEste = texto_(fila[h.posicion.Torneo]) === p.torneo && texto_(fila[h.posicion.Jornada]) === p.jornada &&
        (texto_(fila[h.posicion.Equipo]) === p.local || texto_(fila[h.posicion.Equipo]) === p.visitante);
      if (!esEste) continue;
      if (!toma) {
        h.hoja.deleteRow(i + 1);
      } else {
        h.hoja.getRange(i + 1, h.posicion.Equipo + 1).setValue(equipo);
        h.hoja.getRange(i + 1, h.posicion.Toma + 1).setValue(toma);
        h.hoja.getRange(i + 1, h.posicion.Cede + 1).setValue(cede);
      }
      return { datos: leerTodo_() };
    }
    if (toma) agregarFilas_('Transferencias', [{ Torneo: p.torneo, Jornada: p.jornada, Equipo: equipo, Toma: toma, Cede: cede }]);
    return { datos: leerTodo_() };
  });
}

/**
 * Carga de un jalón un torneo ya terminado (equipos, tabla, partidos, goleadores y refuerzos).
 * Solo acepta torneos archivados. Con reemplazar: true borra antes lo que hubiera de ese torneo,
 * pero nunca toca un torneo activo.
 */
function importarHistorico_(d) {
  const torneo = texto_(d.torneo);
  const filas = d.filas || {};
  const hojas = ['Equipos', 'Torneos', 'Partidos', 'Goleadores', 'Transferencias'];
  if (!torneo) throw new Error('Falta el torneo.');
  hojas.forEach(function (h) {
    if (!Array.isArray(filas[h])) throw new Error('Faltan las filas de ' + h + '.');
    if (filas[h].some(function (f) { return texto_(f.Torneo) !== torneo; })) throw new Error('Hay filas de otro torneo en ' + h + '.');
  });
  if (filas.Equipos.some(function (e) { return texto_(e.Estado) !== 'Archivado'; })) throw new Error('Solo se importan torneos archivados.');
  return conCandado_(function () {
    const anteriores = leerHoja_('Equipos').filter(function (e) { return texto_(e.Torneo) === torneo; });
    if (anteriores.length) {
      if (!d.reemplazar) throw new Error('Ya existe un torneo con ese nombre.');
      if (anteriores.some(function (e) { return texto_(e.Estado) !== 'Archivado'; })) throw new Error('No se reemplaza un torneo activo.');
      hojas.forEach(function (h) { borrarFilas_(h, function (f) { return texto_(f.Torneo) === torneo; }); });
    }
    hojas.forEach(function (h) { agregarFilas_(h, filas[h]); });
    return { datos: leerTodo_() };
  });
}

function crearTorneo_(d) {
  const torneo = texto_(d.torneo);
  const equipos = (d.equipos || []).filter(function (e) { return texto_(e.equipo); });
  if (!torneo) throw new Error('Escribe el nombre del torneo.');
  if (equipos.length < 4 || equipos.length > 6) throw new Error('El torneo necesita de 4 a 6 equipos.');
  return conCandado_(function () {
    const existe = leerHoja_('Equipos').some(function (e) { return texto_(e.Torneo) === torneo; });
    if (existe) throw new Error('Ya existe un torneo con ese nombre.');
    const filas = equipos.map(function (e) {
      return { Torneo: torneo, Equipo: texto_(e.equipo), Estado: 'Activo', Manager: texto_(e.manager) };
    });
    if (filas.length === 5) filas.push({ Torneo: torneo, Equipo: DESCANSO, Estado: 'Activo', Manager: '' });
    agregarFilas_('Equipos', filas);
    const elegido = validarTipo_(d.tipo || TIPOS[0].nombre, d.semanas);
    agregarFilas_('Torneos', [{
      Torneo: torneo,
      Tipo: elegido.tipo,
      Semanas: elegido.semanas,
      Goleadores: d.goleadores === false ? 'No' : 'Sí',
    }]);
    return { datos: leerTodo_() };
  });
}

function cambiarEstadoTorneo_(d) {
  const torneo = texto_(d.torneo);
  const estado = d.estado === 'Archivado' ? 'Archivado' : 'Activo';
  return conCandado_(function () {
    const h = prepararHoja_('Equipos');
    const valores = h.hoja.getDataRange().getValues();
    for (let i = 1; i < valores.length; i++) {
      if (texto_(valores[i][h.posicion.Torneo]) === torneo) {
        h.hoja.getRange(i + 1, h.posicion.Estado + 1).setValue(estado);
      }
    }
    return { datos: leerTodo_() };
  });
}

/**
 * Cambia el tipo de torneo (y con él las semanas) y si se registran goleadores.
 * No permite quitar semanas que ya tienen resultados guardados.
 */
function ajustarTorneo_(d) {
  const torneo = texto_(d.torneo);
  if (!torneo) throw new Error('Falta el torneo.');
  const elegido = validarTipo_(d.tipo, d.semanas);
  const goleadores = d.goleadores === false ? 'No' : 'Sí';
  return conCandado_(function () {
    const jugada = ultimaSemanaJugada_(torneo);
    if (elegido.semanas < jugada) {
      throw new Error('No se puede: ya hay resultados guardados en la semana ' + jugada + ' y ' + elegido.tipo + ' de ' + elegido.semanas + ' semanas los borraría.');
    }
    const fila = { Torneo: torneo, Tipo: elegido.tipo, Semanas: elegido.semanas, Goleadores: goleadores };
    const h = prepararHoja_('Torneos');
    const valores = h.hoja.getDataRange().getValues();
    for (let i = 1; i < valores.length; i++) {
      if (texto_(valores[i][h.posicion.Torneo]) === torneo) {
        Object.keys(fila).forEach(function (k) { h.hoja.getRange(i + 1, h.posicion[k] + 1).setValue(fila[k]); });
        return { datos: leerTodo_() };
      }
    }
    agregarFilas_('Torneos', [fila]);
    return { datos: leerTodo_() };
  });
}

function guardarManager_(d) {
  const nombre = texto_(d.manager);
  if (!nombre) throw new Error('Escribe el nombre del manager.');
  return conCandado_(function () {
    const h = prepararHoja_('Managers');
    const valores = h.hoja.getDataRange().getValues();
    for (let i = 1; i < valores.length; i++) {
      if (texto_(valores[i][h.posicion.Manager]).toLowerCase() === nombre.toLowerCase()) {
        h.hoja.getRange(i + 1, h.posicion.Emoji + 1).setValue(texto_(d.emoji));
        return { datos: leerTodo_() };
      }
    }
    agregarFilas_('Managers', [{ Manager: nombre, Emoji: texto_(d.emoji) }]);
    return { datos: leerTodo_() };
  });
}


// ---------------------------------------------------------------------------
// Escáner de marcadores con Gemini
// ---------------------------------------------------------------------------

function escanear_(d) {
  const props = PropertiesService.getScriptProperties();
  const llave = props.getProperty('GEMINI_API_KEY');
  if (!llave) throw new Error('Falta configurar GEMINI_API_KEY en las propiedades del script.');
  // La app puede mandar su propio modelo, instrucciones y formato de respuesta para afinar el
  // escáner sin volver a publicar este código. Si no los manda, se usan los de aquí abajo.
  const modeloApp = texto_(d.modelo);
  const modelo = /^gemini-[a-z0-9.\-]+$/.test(modeloApp) ? modeloApp : (props.getProperty('GEMINI_MODELO') || 'gemini-2.5-flash');
  const imagenes = d.imagenes || [];
  if (!imagenes.length) throw new Error('No llegó ninguna foto.');

  const lista = function (arr) { return (arr || []).slice(0, 60).join(', ') || '(sin historial)'; };
  const instrucciones = typeof d.instrucciones === 'string' && d.instrucciones.length < 20000 ? d.instrucciones : [
    'Eres un asistente que lee capturas o fotos de la pantalla de resumen de un partido de EA SPORTS FC.',
    'El partido es: LOCAL = "' + texto_(d.local) + '" contra VISITANTE = "' + texto_(d.visitante) + '".',
    'En el juego los equipos aparecen con su nombre de club, que puede no coincidir exactamente con esos nombres.',
    'Usa el nombre del club, el escudo y los jugadores para decidir cuál lado de la pantalla es el LOCAL y cuál el VISITANTE.',
    'Jugadores que han usado antes el LOCAL: ' + lista(d.jugadoresLocal) + '.',
    'Jugadores que han usado antes el VISITANTE: ' + lista(d.jugadoresVisitante) + '.',
    '',
    'Reglas:',
    '- marcador_local y marcador_visitante son los números grandes del encabezado (ej. "2 : 2"). Cópialos tal cual.',
    '  NUNCA cambies el marcador para que cuadre con los goleadores: el encabezado siempre manda.',
    '- En goleadores incluye SOLO goles: un nombre con el icono de balón (⚽) junto al minuto.',
    '- NO son goles: los CAMBIOS (dos nombres juntos, uno con flecha verde ↑ que entra y otro con flecha roja ↓ que sale),',
    '  las tarjetas (rectángulo amarillo o rojo) ni las lesiones. Ignóralos aunque estén en la línea de tiempo.',
    '- Las fotos suelen ser la misma pantalla desplazada: la misma jugada aparece en varias fotos.',
    '  Un gol se identifica por su MINUTO: si dos fotos muestran un gol del mismo lado en el mismo minuto, es UN solo gol',
    '  aunque el nombre se lea distinto; usa el nombre que se lea mejor.',
    '- Si al final el número de goleadores de un lado no coincide con el marcador del encabezado, NO lo corrijas inventando',
    '  ni borrando: deja los goles que veas y explica la diferencia en "dudas".',
    '- Un autogol cuenta para el equipo que lo recibe a favor; escribe el nombre como aparece y pon autogol=true.',
    '- Si un jugador anotó varias veces, repítelo una vez por gol con su minuto.',
    '- Escribe el nombre como aparece en pantalla. Si es claramente un jugador de las listas, usa el nombre de la lista.',
    '- Si varias fotos muestran lo mismo, no dupliques goles: cada gol es único por jugador y minuto.',
    '- Si no estás seguro de algo, explícalo en "dudas".',
  ].join('\n');

  const partes = [{ text: instrucciones }];
  imagenes.slice(0, 6).forEach(function (img) {
    partes.push({ inline_data: { mime_type: img.mime || 'image/jpeg', data: img.data } });
  });

  const gol = {
    type: 'OBJECT',
    properties: {
      jugador: { type: 'STRING' },
      minuto: { type: 'STRING' },
      autogol: { type: 'BOOLEAN' },
    },
    required: ['jugador'],
  };
  const esquema = d.esquema && typeof d.esquema === 'object' ? d.esquema : {
    type: 'OBJECT',
    properties: {
      marcador_local: { type: 'INTEGER' },
      marcador_visitante: { type: 'INTEGER' },
      goleadores_local: { type: 'ARRAY', items: gol },
      goleadores_visitante: { type: 'ARRAY', items: gol },
      lado_izquierdo_es_local: { type: 'BOOLEAN' },
      dudas: { type: 'STRING' },
    },
    required: ['marcador_local', 'marcador_visitante', 'goleadores_local', 'goleadores_visitante'],
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent';
  const peticion = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': llave },
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: partes }],
      generationConfig: generacion_(esquema, d.pensamiento),
    }),
  };

  // La app manda reintentos: 1 cuando tiene otro modelo de respaldo, para no esperar de más.
  const reintentos = Math.min(Math.max(parseInt(d.reintentos, 10) || 3, 1), 3);
  let respuesta;
  for (let intento = 1; intento <= reintentos; intento++) {
    respuesta = UrlFetchApp.fetch(url, peticion);
    const codigo = respuesta.getResponseCode();
    if (codigo === 200) break;
    if ((codigo === 429 || codigo >= 500) && intento < reintentos) {
      Utilities.sleep(4000 * intento);
      continue;
    }
    if (codigo === 429) throw new Error('Gemini está saturado o se acabó la cuota gratis por ahora. Intenta en un minuto o captura a mano.');
    throw new Error('Gemini respondió con error ' + codigo + ': ' + respuesta.getContentText().slice(0, 300));
  }

  const cuerpo = JSON.parse(respuesta.getContentText());
  const textoJson = cuerpo.candidates && cuerpo.candidates[0] && cuerpo.candidates[0].content &&
    cuerpo.candidates[0].content.parts.map(function (p) { return p.text || ''; }).join('');
  if (!textoJson) throw new Error('Gemini no regresó resultado. Intenta con otra foto.');
  const lectura = JSON.parse(textoJson);
  lectura.goleadores_local = sinRepetirMinuto_(lectura.goleadores_local);
  lectura.goleadores_visitante = sinRepetirMinuto_(lectura.goleadores_visitante);
  return { lectura: lectura };
}

/** Configuración de Gemini. pensamiento = cuánto "piensa" antes de responder (más = más lento y cuidadoso). */
function generacion_(esquema, pensamiento) {
  const config = { temperature: 0, responseMimeType: 'application/json', responseSchema: esquema };
  if (pensamiento !== undefined && pensamiento !== null && !isNaN(parseInt(pensamiento, 10))) {
    config.thinkingConfig = { thinkingBudget: parseInt(pensamiento, 10) };
  }
  return config;
}

/** Quita goles del mismo lado con el mismo minuto: son la misma jugada vista en dos fotos. */
function sinRepetirMinuto_(goles) {
  const vistos = {};
  return (goles || []).filter(function (g) {
    const minuto = texto_(g.minuto).replace(/[^0-9+]/g, '');
    if (!minuto) return true;
    if (vistos[minuto]) return false;
    vistos[minuto] = true;
    return true;
  });
}


// ---------------------------------------------------------------------------
// Preparación de la hoja (se ejecuta UNA vez a mano desde el editor)
// ---------------------------------------------------------------------------

/**
 * Agrega la columna Manager a la hoja Equipos, la llena para los torneos viejos,
 * crea la hoja Managers con el emoji de cada uno y la hoja Torneos con las
 * semanas y si se llevaron goleadores. Se puede ejecutar varias veces: solo
 * llena lo que falte.
 */
function configurarHoja() {
  const h = prepararHoja_('Equipos');
  const valores = h.hoja.getDataRange().getValues();
  const emojis = {};
  for (let i = 1; i < valores.length; i++) {
    const equipo = texto_(valores[i][h.posicion.Equipo]);
    if (!equipo) continue;
    const info = separarEquipo_(equipo);
    let manager = texto_(valores[i][h.posicion.Manager]);
    if (!manager && info.manager) {
      manager = info.manager;
      h.hoja.getRange(i + 1, h.posicion.Manager + 1).setValue(manager);
    }
    // Nos quedamos con el emoji más reciente que no sea bandera.
    if (manager && info.emoji && !/\p{Regional_Indicator}|\u{1F3F4}/u.test(info.emoji)) emojis[manager] = info.emoji;
    if (manager && !(manager in emojis)) emojis[manager] = '';
  }

  const m = prepararHoja_('Managers');
  const existentes = leerHoja_('Managers').map(function (r) { return texto_(r.Manager).toLowerCase(); });
  const nuevos = Object.keys(emojis)
    .filter(function (n) { return existentes.indexOf(n.toLowerCase()) === -1; })
    .map(function (n) { return { Manager: n, Emoji: emojis[n] || '⚽' }; });
  agregarFilas_('Managers', nuevos);

  // Torneos: semanas jugadas y si los goleadores son reales o relleno ("A", ".", etc.).
  prepararHoja_('Torneos');
  const yaEstan = leerHoja_('Torneos').map(function (r) { return texto_(r.Torneo); });
  const archivados = {};
  leerHoja_('Equipos').forEach(function (e) {
    const t = texto_(e.Torneo);
    if (!t) return;
    if (!(t in archivados)) archivados[t] = true;
    if (texto_(e.Estado).toLowerCase() !== 'archivado') archivados[t] = false;
  });
  const maxSemana = {};
  leerHoja_('Partidos').forEach(function (p) {
    const m = texto_(p.Jornada).match(/^S(\d+)J/i);
    if (m) maxSemana[texto_(p.Torneo)] = Math.max(maxSemana[texto_(p.Torneo)] || 0, entero_(m[1]));
  });
  const goles = {};
  leerHoja_('Goleadores').forEach(function (g) {
    const t = texto_(g.Torneo);
    goles[t] = goles[t] || { total: 0, validos: 0 };
    goles[t].total++;
    if (/\p{L}{2,}/u.test(texto_(g.Jugador))) goles[t].validos++;
  });
  const torneosNuevos = Object.keys(archivados).filter(function (t) { return yaEstan.indexOf(t) === -1; }).map(function (t) {
    const g = goles[t];
    const semanas = archivados[t] ? (maxSemana[t] || SEMANAS_DEFAULT) : Math.max(SEMANAS_DEFAULT, maxSemana[t] || 0);
    return {
      Torneo: t,
      Tipo: tipoPorSemanas_(semanas),
      Semanas: semanas,
      Goleadores: g && g.validos < g.total / 2 ? 'No' : 'Sí',
    };
  });
  agregarFilas_('Torneos', torneosNuevos);

  // Torneos que ya estaban en la hoja pero todavía no tienen tipo.
  const ht = prepararHoja_('Torneos');
  const filasT = ht.hoja.getDataRange().getValues();
  for (let i = 1; i < filasT.length; i++) {
    if (texto_(filasT[i][ht.posicion.Torneo]) && !texto_(filasT[i][ht.posicion.Tipo])) {
      ht.hoja.getRange(i + 1, ht.posicion.Tipo + 1).setValue(tipoPorSemanas_(entero_(filasT[i][ht.posicion.Semanas])));
    }
  }

  SpreadsheetApp.flush();
  Logger.log('Listo. Managers nuevos: ' + nuevos.map(function (n) { return n.Emoji + ' ' + n.Manager; }).join(', '));
  Logger.log('Torneos: ' + leerHoja_('Torneos').map(function (t) { return t.Torneo + ' = ' + t.Tipo + ' (' + t.Semanas + ' semanas, goleadores: ' + t.Goleadores + ')'; }).join(', '));
}

/** Separa "🦕Frankfurt (Enorme)" o "🦕Enorme  América" en emoji, club y manager. */
function separarEquipo_(nombre) {
  const s = texto_(nombre);
  if (s.toLowerCase() === DESCANSO.toLowerCase()) return { emoji: '', club: DESCANSO, manager: '' };
  const emoji = (s.match(/^\s*(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic}|[\u{E0020}-\u{E007F}])*)/u) || [''])[0];
  const resto = s.slice(emoji.length).replace(/\s+/g, ' ').trim();
  let manager, club;
  const parentesis = resto.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (parentesis) {
    club = parentesis[1].trim();
    manager = parentesis[2].trim();
  } else {
    const partes = resto.split(' ');
    manager = partes[0] || '';
    club = partes.slice(1).join(' ');
  }
  manager = ALIAS_MANAGER[manager.toLowerCase()] || manager;
  return { emoji: emoji.trim(), club: club, manager: manager };
}


// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function texto_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function entero_(v) {
  const n = parseInt(v, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}
