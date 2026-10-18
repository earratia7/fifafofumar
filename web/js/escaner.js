// Instrucciones y formato de respuesta que se le mandan a Gemini para leer las fotos del marcador.
// Viven aquí (y no en Apps Script) para poder afinarlas sin volver a publicar el servidor.

const lista = (arr) => (arr || []).slice(0, 60).join(', ') || '(sin historial)';

export function instruccionesEscaner({ local, visitante, jugadoresLocal, jugadoresVisitante }) {
  return [
    'Eres un asistente que lee fotos de la pantalla de resumen (pestaña "Eventos") de un partido de EA SPORTS FC.',
    `El partido es: LOCAL = "${local}" contra VISITANTE = "${visitante}".`,
    'En el juego los equipos aparecen con su nombre de club oficial (ej. "Club Guadalajara" = Chivas), que puede no coincidir exactamente.',
    'El LOCAL del calendario puede aparecer a la izquierda o a la derecha del encabezado: usa el nombre del club, el escudo y los jugadores para decidirlo.',
    `Jugadores que ha usado antes el manager del LOCAL: ${lista(jugadoresLocal)}.`,
    `Jugadores que ha usado antes el manager del VISITANTE: ${lista(jugadoresVisitante)}.`,
    '',
    'Cómo es la pantalla:',
    '- Arriba está el encabezado: club izquierdo, marcador "A : B", club derecho.',
    '- Abajo hay una línea de tiempo vertical con círculos de minutos. Los eventos del club izquierdo salen a la IZQUIERDA de la línea y los del club derecho a la DERECHA.',
    '- Cada evento tiene un icono junto al minuto:',
    '    · Gol: un balón (⚽).',
    '    · Cambio: DOS nombres juntos, uno con flecha verde ↑ (entra) y otro con flecha roja ↓ (sale). NO es gol.',
    '    · Tarjeta: un rectángulo amarillo o rojo. NO es gol.',
    '    · "MT" (medio tiempo), "PT" (prórroga) y "NO HAY EVENTOS" son marcas, no eventos.',
    '',
    'Reglas:',
    '- marcador_local y marcador_visitante son los números grandes del encabezado, acomodados según quién es el LOCAL. Cópialos tal cual.',
    '  NUNCA cambies el marcador para que cuadre con los goleadores: el encabezado siempre manda.',
    '- En goleadores incluye SOLO eventos con balón. Ignora cambios, tarjetas y lesiones.',
    '- Las fotos suelen ser la misma pantalla desplazada: la misma jugada puede aparecer en varias fotos.',
    '  Un gol se identifica por su lado y su MINUTO: mismo lado y mismo minuto en dos fotos es UN solo gol.',
    '- Si un jugador anotó varias veces, ponlo una vez por cada gol, con su minuto.',
    '- Un autogol se anota para el equipo que lo recibe a favor; escribe el nombre como aparece y pon autogol=true.',
    '- Escribe el nombre como aparece en pantalla. Si claramente es un jugador de las listas, usa el nombre de la lista.',
    '- Antes de responder, cuenta tus goleadores de cada lado y compáralos con el marcador. Si no coinciden, revisa',
    '  de nuevo los iconos (¿algún cambio o tarjeta contado como gol?, ¿un gol repetido entre fotos?).',
    '  Si aun así no coincide, NO inventes ni borres: deja los goles que veas y explica la diferencia en "dudas".',
    '- Deja "dudas" vacío si todo cuadra.',
  ].join('\n');
}

const GOL = {
  type: 'OBJECT',
  properties: {
    minuto: { type: 'STRING' },
    jugador: { type: 'STRING' },
    autogol: { type: 'BOOLEAN' },
  },
  required: ['minuto', 'jugador'],
};

export const ESQUEMA_ESCANER = {
  type: 'OBJECT',
  properties: {
    club_izquierdo_en_pantalla: { type: 'STRING' },
    club_derecho_en_pantalla: { type: 'STRING' },
    izquierdo_es_local: { type: 'BOOLEAN' },
    marcador_local: { type: 'INTEGER' },
    marcador_visitante: { type: 'INTEGER' },
    goleadores_local: { type: 'ARRAY', items: GOL },
    goleadores_visitante: { type: 'ARRAY', items: GOL },
    dudas: { type: 'STRING' },
  },
  required: ['izquierdo_es_local', 'marcador_local', 'marcador_visitante', 'goleadores_local', 'goleadores_visitante'],
  propertyOrdering: ['club_izquierdo_en_pantalla', 'club_derecho_en_pantalla', 'izquierdo_es_local', 'marcador_local', 'marcador_visitante', 'goleadores_local', 'goleadores_visitante', 'dudas'],
};

/** Quita goles del mismo lado con el mismo minuto: son la misma jugada vista en dos fotos. */
export function sinRepetirMinuto(goles) {
  const vistos = new Set();
  return (goles || []).filter((g) => {
    const minuto = String(g.minuto || '').replace(/[^0-9+]/g, '');
    if (!minuto) return true;
    if (vistos.has(minuto)) return false;
    vistos.add(minuto);
    return true;
  });
}

// Modelo de Gemini y cuánto "piensa" antes de responder (null = lo que decida el modelo).
export const AJUSTES_ESCANER = { modelo: 'gemini-2.5-flash', pensamiento: null };
