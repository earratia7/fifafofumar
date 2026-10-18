// Pantallas de la app. Los cálculos viven en liga.js y la conexión en api.js.
import * as L from './liga.js';
import { cargarDatos, enviar, esDemo, ClaveInvalida } from './api.js';

const $ = (selector, raiz = document) => raiz.querySelector(selector);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const LLAVES = { clave: 'ff_clave', datos: 'ff_datos', torneo: 'ff_torneo' };
const leerLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const guardarLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };

const estado = {
  liga: null,
  torneo: null,
  vista: 'jornadas',
  semana: null,
  historia: 'managers',
  duelo: [null, null],
  clave: '',
  cargando: false,
  actualizado: null,
  verRefuerzos: false,
};

let registro = null;      // captura de resultado en curso
let nuevoTorneo = null;   // formulario de torneo nuevo en curso


// ---------------------------------------------------------------------------
// Arranque y datos
// ---------------------------------------------------------------------------

function leerClave() {
  const m = location.hash.match(/k=([^&]+)/);
  if (m) {
    const clave = decodeURIComponent(m[1]);
    guardarLocal(LLAVES.clave, clave);
    history.replaceState(null, '', location.pathname + location.search);
    return clave;
  }
  return leerLocal(LLAVES.clave) || '';
}

async function iniciar() {
  estado.clave = leerClave();
  if (!esDemo && !estado.clave) return pantallaSinAcceso();
  const guardado = !esDemo && leerLocal(LLAVES.datos);
  if (guardado) {
    try { aplicarDatos(JSON.parse(guardado), false); } catch { /* copia dañada: se ignora */ }
  }
  await actualizar(!guardado);
}

async function actualizar(avisarSiFalla = true) {
  if (estado.cargando) return;
  estado.cargando = true;
  $('#boton-actualizar').classList.add('girando');
  try {
    aplicarDatos(await cargarDatos(estado.clave), true);
  } catch (e) {
    if (e instanceof ClaveInvalida) return pantallaSinAcceso();
    avisar(estado.liga && !avisarSiFalla ? 'Sin conexión: estás viendo lo último guardado.' : e.message, 'error');
  } finally {
    estado.cargando = false;
    $('#boton-actualizar').classList.remove('girando');
  }
}

function aplicarDatos(crudo, guardarCopia) {
  estado.liga = L.construirLiga(crudo);
  estado.actualizado = guardarCopia ? new Date() : estado.actualizado;
  if (guardarCopia && !esDemo) guardarLocal(LLAVES.datos, JSON.stringify(crudo));
  const { liga } = estado;
  if (!estado.torneo || !liga.torneos.has(estado.torneo)) {
    const preferido = leerLocal(LLAVES.torneo);
    estado.torneo = preferido && liga.torneos.has(preferido) ? preferido : L.torneosOrdenados(liga)[0]?.nombre || null;
    estado.semana = null;
  }
  render();
}

function pantallaSinAcceso() {
  $('#nombre-torneo').textContent = 'Sin acceso';
  $('#vista').innerHTML = `
    <div class="vacio">
      <span class="grande">🔒</span>
      <b>Necesitas el enlace de la liga</b>
      <p>Pídele el enlace completo a quien administra el torneo y ábrelo desde este celular. Solo hay que hacerlo una vez.</p>
    </div>`;
}


// ---------------------------------------------------------------------------
// Utilidades de pantalla
// ---------------------------------------------------------------------------

let temporizadorAviso;
function avisar(mensaje, tipo = '') {
  const el = $('#aviso');
  el.textContent = mensaje;
  el.className = `aviso visible ${tipo}`;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { el.className = 'aviso'; }, tipo === 'error' ? 5000 : 2800);
}

const vacio = (icono, texto) => `<div class="vacio"><span class="grande">${icono}</span>${texto}</div>`;

function equipoHTML(f, clase = '') {
  const nombre = f.manager || f.club || f.nombre;
  const club = f.manager ? f.club : '';
  return `<div class="equipo ${clase}">
    <span class="equipo-emoji">${esc(f.emoji || '⚽')}</span>
    <span class="equipo-manager">${esc(nombre)}</span>
    <span class="equipo-club">${esc(club) || '&nbsp;'}</span>
  </div>`;
}

const datosPartido = (p) => `data-jornada="${esc(p.jornada)}" data-local="${esc(p.local)}" data-visitante="${esc(p.visitante)}"`;

/** Lista de tipos de torneo para elegir. minimo = semanas que ya tienen resultados. */
function selectorTipo(accion, tipoActual, semanasActual, minimo = 0) {
  return `<div class="lista tipos">${L.OPCIONES_TORNEO.map((o) => {
    const elegido = o.tipo === tipoActual && o.semanas === semanasActual;
    const bloqueado = o.semanas < minimo;
    return `<button class="fila ${elegido ? 'activa' : ''}" data-accion="${accion}" data-tipo="${esc(o.tipo)}" data-semanas="${o.semanas}" ${bloqueado || elegido ? 'disabled' : ''}>
      <span style="font-size:22px">${o.icono}</span>
      <div class="principal"><b>${esc(o.tipo)}</b><small>${bloqueado ? `No disponible: ya hay resultados en la semana ${minimo}` : `${o.semanas} semanas`}</small></div>
      ${elegido ? '<span class="etiqueta verde">Elegido</span>' : ''}
    </button>`;
  }).join('')}</div>`;
}

const medalla = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}`;

function hora(fecha) {
  if (!fecha) return '';
  const dd = String(fecha.getDate()).padStart(2, '0');
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${fecha.getFullYear()} ${fecha.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`;
}


// ---------------------------------------------------------------------------
// Render principal
// ---------------------------------------------------------------------------

const VISTAS = { jornadas: vistaJornadas, tabla: vistaTabla, goleo: vistaGoleo, historia: vistaHistoria, mas: vistaMas };

function render() {
  const { liga } = estado;
  if (!liga) return;
  const t = liga.torneos.get(estado.torneo);
  $('#nombre-torneo').innerHTML = t
    ? `<i class="punto ${t.archivado ? '' : 'vivo'}"></i>${esc(t.nombre)}`
    : 'Sin torneos';
  document.querySelectorAll('.navegacion button').forEach((b) => b.classList.toggle('activa', b.dataset.vista === estado.vista));
  const aviso = esDemo ? '<div class="demo">Modo demo · los cambios no se guardan en la hoja</div>' : '';
  $('#vista').innerHTML = aviso + VISTAS[estado.vista](liga, t);
}

function cambiarVista(vista) {
  estado.vista = vista;
  render();
  window.scrollTo({ top: 0 });
}


// ---------------------------------------------------------------------------
// Jornadas
// ---------------------------------------------------------------------------

function vistaJornadas(liga, t) {
  if (!t) return vacio('🏟️', 'Todavía no hay torneos. Crea uno en <b>Más → Nuevo torneo</b>.');
  if (t.equipos.length !== 6) {
    return vacio('⚠️', `Este torneo tiene ${t.equipos.length} equipo(s). El calendario necesita 5 equipos (más el descanso) o 6.`);
  }
  const visibles = L.semanasDelTorneo(liga, t.nombre);
  if (!estado.semana || estado.semana > visibles) estado.semana = t.archivado ? visibles : L.semanaActual(liga, t.nombre);
  const semana = estado.semana;

  const chips = [];
  for (let s = 1; s <= visibles; s++) {
    const reales = L.semanaConResultados(liga, t.nombre, s).filter((p) => !p.descanso);
    const completa = reales.length && reales.every((p) => p.resultado);
    chips.push(`<button class="chip-semana ${s === semana ? 'activa' : ''} ${completa ? 'completa' : ''}" data-accion="semana" data-semana="${s}">Semana<b>${s}</b></button>`);
  }

  const partidos = L.semanaConResultados(liga, t.nombre, semana);
  const reales = partidos.filter((p) => !p.descanso);
  const jugados = reales.filter((p) => p.resultado).length;
  const porJornada = new Map();
  for (const p of partidos) {
    if (!porJornada.has(p.numJornada)) porJornada.set(p.numJornada, []);
    porJornada.get(p.numJornada).push(p);
  }

  let html = t.archivado ? '<div class="aviso-archivado">🗄️ Torneo archivado: solo consulta.</div>' : '';
  if (!t.archivado && L.torneoCompleto(liga, t.nombre)) {
    html += `<div class="campeon"><span class="copa">🏁</span><div><small>Torneo completo</small>
      <b>Se jugaron las ${visibles} semanas</b>
      <button class="boton chico principal" data-accion="cambiar-estado" style="margin-top:8px">🗄️ Archivar y cerrar</button></div></div>`;
  }
  html += `<div class="semanas" id="semanas">${chips.join('')}</div>
    <div class="progreso">
      <div class="progreso-texto"><span>Semana ${semana}</span><span><b>${jugados}</b> de ${reales.length} partidos</span></div>
      <div class="barra-progreso"><span style="width:${reales.length ? (jugados / reales.length) * 100 : 0}%"></span></div>
    </div>`;
  for (const [num, lista] of porJornada) {
    html += `<div class="jornada-titulo">Jornada ${num}</div>`;
    html += lista.map((p) => tarjetaPartido(liga, t, p)).join('');
  }
  requestAnimationFrame(() => $('#semanas .activa')?.scrollIntoView({ inline: 'center', block: 'nearest' }));
  return html;
}

function tarjetaPartido(liga, t, p) {
  const fl = liga.ficha(t.nombre, p.local);
  const fv = liga.ficha(t.nombre, p.visitante);
  if (p.descanso) {
    const quien = fl.descanso ? fv : fl;
    return `<div class="descanso">😴 Descansa <b>${esc(quien.emoji)} ${esc(quien.manager || quien.nombre)}</b></div>`;
  }
  const r = p.resultado;
  if (r) {
    return `<button class="partido" data-accion="ver-partido" ${datosPartido(p)}>
      ${equipoHTML(fl, r.gl < r.gv ? 'perdio' : '')}
      <div class="marcador"><span class="${r.gl > r.gv ? 'gano' : ''}">${r.gl}</span><span class="guion">-</span><span class="${r.gv > r.gl ? 'gano' : ''}">${r.gv}</span></div>
      ${equipoHTML(fv, r.gv < r.gl ? 'perdio' : '')}
      ${r.wo ? '<div class="partido-pie"><span class="etiqueta rojo">Ganado por W.O.</span></div>' : ''}
    </button>`;
  }
  if (t.archivado) {
    return `<div class="partido">${equipoHTML(fl)}<div class="marcador-vs"><span class="vs">VS</span><span class="etiqueta">Sin jugar</span></div>${equipoHTML(fv)}</div>`;
  }
  return `<button class="partido pendiente" data-accion="registrar" ${datosPartido(p)}>
    ${equipoHTML(fl)}
    <div class="marcador-vs"><span class="vs">VS</span><span class="boton-registrar">Registrar</span></div>
    ${equipoHTML(fv)}
  </button>`;
}


// ---------------------------------------------------------------------------
// Tabla y goleo del torneo
// ---------------------------------------------------------------------------

function vistaTabla(liga, t) {
  if (!t) return vacio('📊', 'No hay torneo seleccionado.');
  const tabla = L.tablaTorneo(liga, t.nombre);
  if (!tabla.some((f) => f.pj)) return vacio('📊', 'Todavía no hay partidos jugados en este torneo.');
  let html = '';
  if (t.archivado && tabla[0]) {
    const c = tabla[0].equipo;
    html += `<div class="campeon"><span class="copa">🏆</span><div><small>Campeón</small><b>${esc(c.emoji)} ${esc(c.manager)}</b> <span class="equipo-club">${esc(c.club)}</span></div></div>`;
  }
  html += `<div class="tarjeta"><table class="tabla">
    <thead><tr><th>#</th><th>Equipo</th><th>PJ</th><th>G-E-P</th><th>DG</th><th>Pts</th></tr></thead>
    <tbody>${tabla.map((f, i) => `
      <tr class="${i === 0 ? 'lider' : ''}">
        <td class="pos">${i + 1}</td>
        <td class="nombre"><div class="celda-equipo">
          <span class="equipo-emoji">${esc(f.equipo.emoji || '⚽')}</span>
          <span class="textos"><span class="equipo-manager">${esc(f.equipo.manager || f.nombre)}</span>
          <span class="forma">${f.forma.slice(-5).map((x) => `<i class="${x}"></i>`).join('')}</span></span>
        </div></td>
        <td>${f.pj}</td>
        <td class="gep">${f.g}-${f.e}-${f.p}</td>
        <td class="${f.dg > 0 ? 'dg-pos' : f.dg < 0 ? 'dg-neg' : ''}">${f.dg > 0 ? '+' : ''}${f.dg}</td>
        <td class="pts">${f.pts}</td>
      </tr>`).join('')}
    </tbody></table></div>
    <p class="nota">Desempate: puntos, diferencia de goles y goles a favor. Los puntitos son los últimos 5 partidos (verde ganó, amarillo empató, rojo perdió). Los descansos no cuentan.</p>`;
  return html;
}

function vistaGoleo(liga, t) {
  if (!t) return vacio('⚽', 'No hay torneo seleccionado.');
  if (!t.goleadores) return vacio('🚫', 'En este torneo no se registran goleadores. Puedes activarlo en <b>Más → Ajustes del torneo</b>.');
  const goleo = L.goleoTorneo(liga, t.nombre);
  if (!goleo.length) return vacio('⚽', 'Todavía no hay goleadores registrados.');
  const max = goleo[0].goles;
  const total = goleo.reduce((s, g) => s + g.goles, 0);
  return `<div class="titulo-seccion">Goleo individual <small>${total} goles</small></div>
    <div class="lista">${goleo.map((g, i) => `
      <div class="fila ${i < 3 ? `medalla-${i + 1}` : ''}">
        <span class="lugar">${medalla(i)}</span>
        <div class="principal">
          <b>${esc(g.jugador)}</b>
          <small>${esc(g.equipo.emoji)} ${esc(g.equipo.manager || g.equipo.nombre)}</small>
          <div class="barrita"><span style="width:${(g.goles / max) * 100}%"></span></div>
        </div>
        <span class="cifra">${g.goles}</span>
      </div>`).join('')}
    </div>`;
}


// ---------------------------------------------------------------------------
// Historia (todos los torneos)
// ---------------------------------------------------------------------------

function vistaHistoria(liga) {
  const pestañas = [['managers', 'Managers'], ['goleo', 'Goleo'], ['duelos', 'Cara a cara'], ['palmares', 'Palmarés']];
  const seg = `<div class="segmentos">${pestañas.map(([id, nombre]) =>
    `<button data-accion="historia" data-pestana="${id}" class="${estado.historia === id ? 'activo' : ''}">${nombre}</button>`).join('')}</div>`;
  const contenido = { managers: historiaManagers, goleo: historiaGoleo, duelos: historiaDuelos, palmares: historiaPalmares }[estado.historia](liga);
  return seg + contenido;
}

function historiaManagers(liga) {
  const tabla = L.tablaHistorica(liga);
  if (!tabla.length) return vacio('🏛️', 'Sin partidos todavía.');
  return tabla.map((f) => `
    <button class="tarjeta manager-tarjeta" data-accion="ver-manager" data-manager="${esc(f.manager)}">
      <span class="avatar">${esc(liga.emojiDe(f.manager))}</span>
      <span class="datos">
        <b>${esc(f.manager)}</b> <span class="trofeos">${'🏆'.repeat(f.titulos)}</span>
        <small>${f.nTorneos} torneo(s) · ${f.pj} PJ · ${f.g}G ${f.e}E ${f.p}P</small>
        <small>${f.gf} goles a favor · ${f.gc} en contra</small>
      </span>
      <span class="efectividad"><b>${f.efectividad}%</b><small>efectividad</small></span>
    </button>`).join('') +
    '<p class="nota">Efectividad = puntos ganados ÷ puntos posibles. Ordenado por títulos y luego por efectividad. Toca un manager para ver su historial.</p>';
}

function historiaGoleo(liga) {
  const goleo = L.goleoHistorico(liga).slice(0, 50);
  if (!goleo.length) return vacio('⚽', 'Sin goleadores todavía.');
  const max = goleo[0].goles;
  return `<div class="lista">${goleo.map((g, i) => `
    <div class="fila ${i < 3 ? `medalla-${i + 1}` : ''}">
      <span class="lugar">${medalla(i)}</span>
      <div class="principal">
        <b>${esc(g.jugador)}</b>
        <small>${g.managers.map(([m, n]) => `${esc(liga.emojiDe(m))} ${esc(m)} ${n}`).join(' · ')}</small>
        <div class="barrita"><span style="width:${(g.goles / max) * 100}%"></span></div>
      </div>
      <span class="cifra">${g.goles}</span>
    </div>`).join('')}</div>
    <p class="nota">Top 50 de todos los torneos. Los nombres escritos con o sin acento se cuentan juntos.</p>`;
}

function historiaDuelos(liga) {
  const managers = L.tablaHistorica(liga).map((f) => f.manager);
  if (managers.length < 2) return vacio('🤝', 'Se necesitan al menos dos managers.');
  let [a, b] = estado.duelo;
  if (!managers.includes(a)) a = managers[0];
  if (!managers.includes(b) || b === a) b = managers.find((m) => m !== a);
  estado.duelo = [a, b];
  const opciones = (sel) => managers.map((m) => `<option value="${esc(m)}" ${m === sel ? 'selected' : ''}>${esc(liga.emojiDe(m))} ${esc(m)}</option>`).join('');
  const d = L.caraACara(liga, a, b);
  const total = d.partidos.length;
  let html = `<div class="cara-elegir">
      <select class="entrada" data-campo="duelo-a">${opciones(a)}</select>
      <span class="vs">VS</span>
      <select class="entrada" data-campo="duelo-b">${opciones(b)}</select>
    </div>`;
  if (!total) return html + vacio('🤝', 'Estos dos nunca se han enfrentado.');
  html += `<div class="tarjeta">
      <div class="duelo">
        <div class="lado"><span class="equipo-emoji">${esc(liga.emojiDe(a))}</span><b>${esc(a)}</b><span class="victorias">${d.ga}</span></div>
        <div class="centro"><small>Empates</small><b>${d.e}</b><small>${total} partidos</small></div>
        <div class="lado"><span class="equipo-emoji">${esc(liga.emojiDe(b))}</span><b>${esc(b)}</b><span class="victorias">${d.gb}</span></div>
      </div>
      <div class="barra-duelo"><span class="a" style="width:${(d.ga / total) * 100}%"></span><span class="e" style="width:${(d.e / total) * 100}%"></span><span class="b" style="width:${(d.gb / total) * 100}%"></span></div>
      <p class="nota" style="text-align:center">Goles: ${esc(a)} ${d.golesA} · ${esc(b)} ${d.golesB}</p>
    </div>
    <div class="titulo-seccion">Partidos <small>del más reciente al más viejo</small></div>
    <div class="lista">${d.partidos.map((p) => {
      const fl = liga.ficha(p.torneo, p.local), fv = liga.ficha(p.torneo, p.visitante);
      return `<div class="fila">
        <div class="principal"><b>${esc(fl.emoji)} ${esc(fl.manager)} ${p.gl} - ${p.gv} ${esc(fv.manager)} ${esc(fv.emoji)}</b><small>${esc(p.torneo)} · ${esc(p.jornada)}${p.wo ? ' · W.O.' : ''}</small></div>
      </div>`;
    }).join('')}</div>`;
  return html;
}

function historiaPalmares(liga) {
  const lista = L.palmares(liga);
  if (!lista.length) return vacio('🏆', 'Todavía no hay torneos archivados. Al terminar un torneo, archívalo en <b>Más</b> para que aparezca aquí.');
  return lista.map((p) => `
    <div class="tarjeta palmares-tarjeta">
      <div class="encabezado"><div><b>${esc(p.torneo)}</b><small class="nota" style="display:block;margin:0">${L.iconoTipo(p.tipo)} ${esc(p.tipo)}</small></div><span class="etiqueta">${p.jugados} partidos</span></div>
      <div class="podio">
        ${p.campeon ? `<div><span class="icono">🏆</span><b>${esc(p.campeon.equipo.emoji)} ${esc(p.campeon.equipo.manager)}</b><small>${p.campeon.pts} pts</small></div>` : ''}
        ${p.subcampeon ? `<div><span class="icono">🥈</span>${esc(p.subcampeon.equipo.emoji)} ${esc(p.subcampeon.equipo.manager)}<small>${p.subcampeon.pts} pts</small></div>` : ''}
        ${p.pichichis.length ? `<div><span class="icono">👟</span>${p.pichichis.map((g) => `${esc(g.jugador)} (${esc(g.equipo.manager)})`).join(', ')}<small>${p.pichichis[0].goles} goles</small></div>` : ''}
      </div>
    </div>`).join('');
}


// ---------------------------------------------------------------------------
// Más: transferencias, torneos, managers y compartir
// ---------------------------------------------------------------------------

function vistaMas(liga, t) {
  let html = '';
  if (t) {
    const transf = L.transferenciasTorneo(liga, t.nombre);
    html += `<div class="titulo-seccion">Refuerzos · ${esc(t.nombre)} <small>${transf.length}</small></div>`;
    const mostrar = estado.verRefuerzos ? transf : transf.slice(0, 5);
    html += transf.length
      ? `<div class="lista">${mostrar.map((x) => {
        const f = liga.ficha(t.nombre, x.equipo);
        return `<div class="fila"><span class="equipo-emoji" style="font-size:22px">${esc(f.emoji)}</span>
          <div class="principal"><b>🟢 ${esc(x.toma)}</b><small>${esc(f.manager || f.nombre)} · ${esc(x.jornada)}${x.cede && x.cede !== 'J.G.' ? ` · cede a ${esc(x.cede)}` : ''}</small></div></div>`;
      }).join('')}${transf.length > mostrar.length ? `<button class="fila" data-accion="ver-refuerzos"><div class="principal"><b>Ver los ${transf.length} refuerzos</b></div><span class="etiqueta">▾</span></button>` : ''}</div>`
      : '<div class="tarjeta nota" style="margin:0">Sin refuerzos registrados en este torneo.</div>';

    html += `<div class="titulo-seccion">Ajustes del torneo</div><div class="tarjeta">
      <b>${esc(t.nombre)}</b> ${t.archivado ? '<span class="etiqueta">Archivado</span>' : '<span class="etiqueta verde">En curso</span>'}
      <p class="nota" style="margin:4px 0 10px">${L.iconoTipo(t.tipo)} ${esc(t.tipo)} · ${t.semanas} semanas${t.archivado ? '' : ` · hay resultados hasta la semana ${t.semanasJugadas}`}</p>
      ${t.archivado ? '' : `<p class="nota" style="margin:0 0 8px">Cambiar tipo de torneo (solo se puede acortar si no se pierden resultados):</p>
        ${selectorTipo('tipo-torneo', t.tipo, t.semanas, t.semanasJugadas)}`}
      <label class="interruptor"><span>Registrar goleadores</span><input type="checkbox" data-campo="goleadores-torneo" ${t.goleadores ? 'checked' : ''}><span class="riel"></span></label>
      <p class="nota" style="margin:0 0 12px">${t.archivado
        ? 'Si lo reactivas se podrán volver a registrar resultados.'
        : '¿Lo quieren terminar antes? Archívalo cuando quieran: la tabla final será la de los partidos jugados y queda en el palmarés.'}</p>
      <button class="boton ${t.archivado ? 'secundario' : 'peligro'}" data-accion="cambiar-estado">${t.archivado ? '♻️ Reactivar torneo' : '🗄️ Archivar torneo'}</button>
    </div>`;
  }

  html += `<div class="titulo-seccion">Torneos</div>
    <button class="boton principal" data-accion="nuevo-torneo">➕ Nuevo torneo</button>`;

  html += `<div class="titulo-seccion">Managers <small>${liga.managers.size}</small></div>
    <div class="lista">${[...liga.managers.values()].map((m) => `
      <button class="fila" data-accion="editar-manager" data-manager="${esc(m.nombre)}">
        <span class="equipo-emoji" style="font-size:24px">${esc(m.emoji || '⚽')}</span>
        <div class="principal"><b>${esc(m.nombre)}</b></div>
        <span class="etiqueta">Editar</span>
      </button>`).join('')}
      <button class="fila" data-accion="editar-manager" data-manager=""><span style="font-size:22px">➕</span><div class="principal"><b>Agregar manager</b></div></button>
    </div>`;

  html += `<div class="titulo-seccion">Compartir e instalar</div>
    <div class="tarjeta">
      <button class="boton secundario" data-accion="compartir">🔗 Compartir enlace de la liga</button>
      <p class="nota">Solo quien tenga este enlace puede ver y registrar resultados. No lo publiques en grupos abiertos.</p>
    </div>
    <div class="tarjeta">
      <b>📲 Tenerla como app en tu celular</b>
      <p class="nota"><b>iPhone (Safari):</b> botón Compartir → “Agregar a inicio”.<br><b>Android (Chrome):</b> menú ⋮ → “Agregar a la pantalla principal”.</p>
    </div>
    <p class="nota" style="text-align:center">Datos de Google Sheets${estado.actualizado ? ` · actualizado ${hora(estado.actualizado)}` : ''}</p>`;
  return html;
}


// ---------------------------------------------------------------------------
// Hoja inferior
// ---------------------------------------------------------------------------

function mostrarHoja(titulo, subtitulo, cuerpo, pie = '') {
  const hoja = $('#hoja');
  const estabaAbierta = !hoja.hidden;
  const scroll = estabaAbierta ? $('.hoja-cuerpo', hoja)?.scrollTop || 0 : 0;
  hoja.innerHTML = `
    <div class="hoja-cabeza"><div><h2>${titulo}</h2>${subtitulo ? `<small>${subtitulo}</small>` : ''}</div>
      <button class="cerrar" data-accion="cerrar-hoja" aria-label="Cerrar">✕</button></div>
    <div class="hoja-cuerpo">${cuerpo}</div>
    ${pie ? `<div class="hoja-pie">${pie}</div>` : ''}`;
  if (estabaAbierta) {
    $('.hoja-cuerpo', hoja).scrollTop = scroll;
    return;
  }
  hoja.hidden = false;
  $('#hoja-fondo').hidden = false;
  document.body.classList.add('sin-scroll');
  history.pushState({ hoja: true }, '');
}

function ocultarHoja() {
  $('#hoja').hidden = true;
  $('#hoja-fondo').hidden = true;
  $('#hoja').innerHTML = '';
  document.body.classList.remove('sin-scroll');
  registro = null;
  nuevoTorneo = null;
}

function cerrarHoja() {
  if (history.state?.hoja) history.back();
  else ocultarHoja();
}

window.addEventListener('popstate', () => { if (!$('#hoja').hidden) ocultarHoja(); });

// Si se abre el enlace con clave en una pestaña que ya estaba abierta, solo cambia el #: recargamos.
window.addEventListener('hashchange', () => { if (/k=/.test(location.hash)) location.reload(); });


// ---------------------------------------------------------------------------
// Elegir torneo
// ---------------------------------------------------------------------------

function abrirElegirTorneo() {
  const lista = L.torneosOrdenados(estado.liga);
  mostrarHoja('Elegir torneo', '', `<div class="lista lista-torneos">${lista.map((t) => `
    <button class="fila ${t.nombre === estado.torneo ? 'activa' : ''}" data-accion="usar-torneo" data-torneo="${esc(t.nombre)}">
      <div class="principal"><b>${esc(t.nombre)}</b><small>${L.iconoTipo(t.tipo)} ${esc(t.tipo)} · ${t.equipos.filter((e) => !e.descanso).map((e) => esc(e.emoji)).join(' ')}</small></div>
      ${t.archivado ? '<span class="etiqueta">Archivado</span>' : '<span class="etiqueta verde">En curso</span>'}
    </button>`).join('')}</div>`);
}


// ---------------------------------------------------------------------------
// Detalle de un partido jugado
// ---------------------------------------------------------------------------

function buscarDesdeBoton(boton) {
  const { jornada, local, visitante } = boton.dataset;
  return { torneo: estado.torneo, jornada, local, visitante };
}

function abrirPartido(datos) {
  const { liga } = estado;
  const t = liga.torneos.get(datos.torneo);
  const p = L.buscarPartido(liga, datos.torneo, datos.jornada, datos.local, datos.visitante);
  if (!p) return;
  const fl = liga.ficha(p.torneo, p.local), fv = liga.ficha(p.torneo, p.visitante);
  const goles = L.golesDelPartido(liga, p);
  const lista = (equipo) => {
    const porJugador = new Map();
    for (const g of goles) if (g.equipo === equipo) porJugador.set(g.jugador, (porJugador.get(g.jugador) || 0) + g.goles);
    return [...porJugador].map(([jugador, n]) => `<li>⚽ ${esc(jugador)}${n > 1 ? ` ×${n}` : ''}</li>`).join('') || '<li class="nota">—</li>';
  };
  const refuerzos = liga.transferencias.filter((x) => x.torneo === p.torneo && x.jornada === p.jornada && (x.equipo === p.local || x.equipo === p.visitante));
  const cuerpo = `
    <div class="partido" style="border:0;background:var(--superficie-2)">
      ${equipoHTML(fl)}
      <div class="marcador"><span class="${p.gl > p.gv ? 'gano' : ''}">${p.gl}</span><span class="guion">-</span><span class="${p.gv > p.gl ? 'gano' : ''}">${p.gv}</span></div>
      ${equipoHTML(fv)}
    </div>
    ${p.wo ? '<div class="recuadro amarillo">Partido ganado por W.O.</div>' : `
    <div class="titulo-seccion">Goleadores</div>
    <div class="detalle-goles"><ul>${lista(p.local)}</ul><ul class="derecha">${lista(p.visitante)}</ul></div>`}
    ${refuerzos.length ? `<div class="titulo-seccion">Refuerzo</div>${refuerzos.map((x) => `<div class="recuadro">🟢 ${esc(liga.ficha(p.torneo, x.equipo).manager)} toma a <b>${esc(x.toma)}</b> · cede ${esc(x.cede || 'J.G.')}</div>`).join('')}` : ''}`;
  const pie = t && !t.archivado
    ? `<button class="boton peligro" data-accion="corregir" ${datosPartido(p)}>✏️ Corregir resultado</button>`
    : '';
  mostrarHoja(`${esc(p.jornada)}`, esc(p.torneo), cuerpo, pie);
}

async function corregirPartido(datos) {
  const { liga } = estado;
  const p = L.buscarPartido(liga, datos.torneo, datos.jornada, datos.local, datos.visitante);
  if (!p) return;
  if (!confirm('Se borrará este resultado (con sus goleadores y refuerzo) para que lo captures de nuevo. ¿Continuar?')) return;
  const anterior = {
    gl: p.gl, gv: p.gv, wo: p.wo,
    golesL: L.golesDelPartido(liga, p).filter((g) => g.equipo === p.local).flatMap((g) => Array(g.goles).fill(g.jugador)),
    golesV: L.golesDelPartido(liga, p).filter((g) => g.equipo === p.visitante).flatMap((g) => Array(g.goles).fill(g.jugador)),
    refuerzo: liga.transferencias.find((x) => x.torneo === p.torneo && x.jornada === p.jornada && (x.equipo === p.local || x.equipo === p.visitante)),
  };
  try {
    const r = await enviar('borrarResultado', { torneo: p.torneo, jornada: p.jornada, local: p.local, visitante: p.visitante }, estado.clave);
    aplicarDatos(r.datos, true);
    ocultarHoja();
    abrirRegistro({ torneo: p.torneo, jornada: p.jornada, local: p.local, visitante: p.visitante }, anterior);
    avisar('Resultado borrado. Captúralo de nuevo.');
  } catch (e) {
    avisar(e.message, 'error');
  }
}


// ---------------------------------------------------------------------------
// Registrar resultado
// ---------------------------------------------------------------------------

function abrirRegistro(datos, anterior = null) {
  const { liga } = estado;
  const fl = liga.ficha(datos.torneo, datos.local);
  const fv = liga.ficha(datos.torneo, datos.visitante);
  registro = {
    ...datos, fl, fv,
    conGoleadores: liga.torneos.get(datos.torneo)?.goleadores !== false,
    gl: anterior?.gl || 0,
    gv: anterior?.gv || 0,
    golesL: anterior?.golesL || [],
    golesV: anterior?.golesV || [],
    wo: anterior?.wo || false,
    ganadorWo: anterior?.wo && anterior.gv > anterior.gl ? 'V' : 'L',
    refuerzo: Boolean(anterior?.refuerzo),
    toma: anterior?.refuerzo?.toma || '',
    cede: anterior?.refuerzo?.cede || 'J.G.',
    escaneando: false,
    guardando: false,
    dudas: '',
    sugL: L.jugadoresDelManager(liga, datos.torneo, fl.manager),
    sugV: L.jugadoresDelManager(liga, datos.torneo, fv.manager),
    todos: L.todosLosJugadores(liga),
  };
  ajustarGoles();
  renderRegistro();
}

function ajustarGoles() {
  const r = registro;
  const ajustar = (lista, n) => (lista.length > n ? lista.slice(0, n) : [...lista, ...Array(n - lista.length).fill('')]);
  r.golesL = ajustar(r.golesL, r.gl);
  r.golesV = ajustar(r.golesV, r.gv);
}

function ganadorRegistro() {
  const r = registro;
  if (r.wo) return r.ganadorWo === 'L' ? r.fl : r.fv;
  if (r.gl > r.gv) return r.fl;
  if (r.gv > r.gl) return r.fv;
  return null;
}

function bloqueGoleadores(lado) {
  const r = registro;
  const f = lado === 'L' ? r.fl : r.fv;
  const goles = lado === 'L' ? r.golesL : r.golesV;
  const leidos = (lado === 'L' ? r.leidosL : r.leidosV) || [];
  const sug = [
    ...leidos.map((nombre) => ({ nombre, delTorneo: true, leido: true })),
    ...(lado === 'L' ? r.sugL : r.sugV).filter((j) => !leidos.some((n) => L.normalizarNombre(n) === L.normalizarNombre(j.nombre))),
  ].slice(0, Math.max(8, leidos.length + 4));
  const llenos = goles.filter((g) => g.trim()).length;
  return `<div class="goleadores-bloque">
    <h3>${esc(f.emoji)} Goles de ${esc(f.manager || f.nombre)} <small>${llenos} de ${goles.length}</small></h3>
    ${sug.length ? `<div class="chips">${sug.map((j) => `<button class="chip ${j.leido ? 'leido' : j.delTorneo ? '' : 'historico'}" data-accion="chip" data-lado="${lado}" data-nombre="${esc(j.nombre)}">${j.leido ? '📸 ' : ''}${esc(j.nombre)}</button>`).join('')}
      <button class="chip" data-accion="chip" data-lado="${lado}" data-nombre="Autogol">Autogol</button></div>` : ''}
    ${goles.map((g, i) => `
      <div class="gol-fila"><span class="num">${i + 1}</span>
        <input class="entrada" data-campo="gol" data-lado="${lado}" data-i="${i}" value="${esc(g)}" placeholder="¿Quién anotó?" list="jugadores-${lado}" autocomplete="off" autocapitalize="words">
        <button class="quitar" data-accion="quitar-gol" data-lado="${lado}" data-i="${i}" aria-label="Borrar nombre">✕</button>
      </div>
      <div class="sugerencia" id="sug-${lado}-${i}">${sugerenciaHTML(lado, i, g)}</div>`).join('')}
    <datalist id="jugadores-${lado}">${[...new Set([...(lado === 'L' ? r.sugL : r.sugV).map((j) => j.nombre), ...r.todos])].map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
  </div>`;
}

function sugerenciaHTML(lado, i, nombre) {
  if (!nombre || nombre.trim().length < 3 || nombre === 'Autogol') return '';
  const r = registro;
  const propios = (lado === 'L' ? r.sugL : r.sugV).map((j) => j.nombre);
  const res = L.buscarParecido(nombre, [...propios, ...r.todos]);
  if (res.tipo !== 'parecido') return '';
  return `¿Quisiste decir <button data-accion="usar-sugerencia" data-lado="${lado}" data-i="${i}" data-nombre="${esc(res.nombre)}">${esc(res.nombre)}</button>? Ya existe así.`;
}

function renderRegistro() {
  const r = registro;
  if (!r) return;
  const contador = (lado) => {
    const valor = lado === 'L' ? r.gl : r.gv;
    return r.wo
      ? `<div class="contador"><output>${(r.ganadorWo === lado) ? 3 : 0}</output></div>`
      : `<div class="contador">
          <button data-accion="restar" data-lado="${lado}" aria-label="Quitar gol">−</button>
          <output>${valor}</output>
          <button data-accion="sumar" data-lado="${lado}" aria-label="Sumar gol">+</button>
        </div>`;
  };
  const ganador = ganadorRegistro();

  let cuerpo = `
    <label class="escaner ${r.escaneando ? 'trabajando' : ''}">
      <span class="icono">${r.escaneando ? '⏳' : '📸'}</span>
      <span><b>${r.escaneando ? 'Leyendo la foto…' : 'Escanear pantalla del resultado'}</b>
      <small>${r.escaneando ? 'Esto tarda unos segundos.' : `Toma foto o elige la captura del resumen. Llenamos ${r.conGoleadores ? 'marcador y goleadores' : 'el marcador'}; tú solo revisas.`}</small></span>
      <input type="file" accept="image/*" multiple data-campo="fotos" ${r.escaneando ? 'disabled' : ''}>
    </label>
    ${r.dudas ? `<div class="recuadro amarillo" style="white-space:pre-line">${esc(r.dudas)}</div>` : ''}
    <div class="captura">
      <div class="lado">${equipoHTML(r.fl)}${contador('L')}</div>
      <div class="lado">${equipoHTML(r.fv)}${contador('V')}</div>
    </div>
    <label class="interruptor"><span>Ganado por W.O. (no se presentó)</span><input type="checkbox" data-campo="wo" ${r.wo ? 'checked' : ''}><span class="riel"></span></label>`;

  if (r.wo) {
    cuerpo += `<div class="opciones-wo">
      <button data-accion="ganador-wo" data-lado="L" class="${r.ganadorWo === 'L' ? 'activo' : ''}">Ganó ${esc(r.fl.manager)}</button>
      <button data-accion="ganador-wo" data-lado="V" class="${r.ganadorWo === 'V' ? 'activo' : ''}">Ganó ${esc(r.fv.manager)}</button>
    </div><div class="recuadro">Se registra 3-0 sin goleadores.</div>`;
  } else {
    if (!r.conGoleadores) cuerpo += '<div class="recuadro">En este torneo no se registran goleadores: solo el marcador.</div>';
    else {
      if (r.gl + r.gv === 0) cuerpo += '<div class="recuadro">Usa + y − para el marcador, o toca a un jugador para sumarle un gol.</div>';
      cuerpo += bloqueGoleadores('L') + bloqueGoleadores('V');
    }
  }

  if (ganador) {
    cuerpo += `<label class="interruptor"><span>Refuerzo para ${esc(ganador.emoji)} ${esc(ganador.manager)}</span><input type="checkbox" data-campo="refuerzo" ${r.refuerzo ? 'checked' : ''}><span class="riel"></span></label>`;
    if (r.refuerzo) {
      cuerpo += `<div class="botones">
        <label class="campo"><span>🟢 Toma</span><input class="entrada" data-campo="toma" value="${esc(r.toma)}" list="jugadores-todos" autocomplete="off"></label>
        <label class="campo"><span>🔴 Cede</span><input class="entrada" data-campo="cede" value="${esc(r.cede)}" autocomplete="off"></label>
      </div><datalist id="jugadores-todos">${r.todos.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`;
    }
  }

  const marcador = r.wo ? (r.ganadorWo === 'L' ? '3 - 0' : '0 - 3') : `${r.gl} - ${r.gv}`;
  const pie = `<button class="boton principal" data-accion="guardar-resultado" ${r.guardando || r.escaneando ? 'disabled' : ''}>${r.guardando ? 'Guardando…' : `Guardar ${marcador}`}</button>`;
  mostrarHoja('Registrar resultado', `${esc(r.jornada)} · ${esc(r.torneo)}`, cuerpo, pie);
}

function cambiarGoles(lado, delta) {
  const r = registro;
  const llave = lado === 'L' ? 'gl' : 'gv';
  r[llave] = Math.max(0, Math.min(20, r[llave] + delta));
  ajustarGoles();
  renderRegistro();
}

function tocarChip(lado, nombre) {
  const r = registro;
  const lista = lado === 'L' ? r.golesL : r.golesV;
  const libre = lista.findIndex((g) => !g.trim());
  if (libre >= 0) lista[libre] = nombre;
  else {
    // Si ya no hay casillas vacías, tocar al jugador suma un gol al marcador.
    r[lado === 'L' ? 'gl' : 'gv']++;
    ajustarGoles();
    (lado === 'L' ? r.golesL : r.golesV)[lista.length] = nombre;
  }
  renderRegistro();
}

/** Vacía la casilla sin tocar el marcador: así se cambia un goleador por otro. Para quitar el gol se usa −. */
function quitarGol(lado, i) {
  (lado === 'L' ? registro.golesL : registro.golesV)[i] = '';
  renderRegistro();
}

async function guardarResultado() {
  const r = registro;
  if (!r || r.guardando) return;
  let gl = r.gl, gv = r.gv, goleadores = [];
  if (r.wo) {
    [gl, gv] = r.ganadorWo === 'L' ? [3, 0] : [0, 3];
  } else if (r.conGoleadores) {
    const faltan = [...r.golesL, ...r.golesV].filter((g) => !g.trim()).length;
    if (faltan) {
      avisar(`Faltan ${faltan} goleador(es). Llénalos antes de guardar.`, 'error');
      $(`.gol-fila input[value=""]`, $('#hoja'))?.focus();
      return;
    }
    goleadores = [
      ...r.golesL.map((j) => ({ equipo: r.local, jugador: j.trim(), goles: 1 })),
      ...r.golesV.map((j) => ({ equipo: r.visitante, jugador: j.trim(), goles: 1 })),
    ];
  }
  const ganador = ganadorRegistro();
  const transferencia = ganador && r.refuerzo && r.toma.trim()
    ? { equipo: ganador.nombre, toma: r.toma.trim(), cede: r.cede.trim() || 'J.G.' }
    : null;

  r.guardando = true;
  renderRegistro();
  try {
    const res = await enviar('guardarResultado', {
      torneo: r.torneo, jornada: r.jornada, local: r.local, visitante: r.visitante,
      gl, gv, wo: r.wo, goleadores, transferencia,
    }, estado.clave);
    const semana = estado.semana;
    aplicarDatos(res.datos, true);
    cerrarHoja();
    const pendientes = L.semanaConResultados(estado.liga, r.torneo, semana).filter((p) => !p.descanso && !p.resultado).length;
    avisar(pendientes ? '✅ Resultado guardado' : `🎉 ¡Semana ${semana} completa!`, 'exito');
  } catch (e) {
    if (registro) {
      registro.guardando = false;
      renderRegistro();
    }
    avisar(e.message, 'error');
  }
}

/** Reduce la foto para que viaje rápido (máx. 1600 px, JPEG). */
function reducirImagen(archivo) {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
      const lienzo = document.createElement('canvas');
      lienzo.width = Math.round(img.width * escala);
      lienzo.height = Math.round(img.height * escala);
      lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
      URL.revokeObjectURL(url);
      resolver({ mime: 'image/jpeg', data: lienzo.toDataURL('image/jpeg', 0.85).split(',')[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); rechazar(new Error('No pude abrir esa imagen.')); };
    img.src = url;
  });
}

async function escanear(archivos) {
  const r = registro;
  if (!archivos.length || !r) return;
  r.escaneando = true;
  r.dudas = '';
  renderRegistro();
  try {
    const imagenes = await Promise.all([...archivos].slice(0, 4).map(reducirImagen));
    const describir = (f) => `${f.club || f.nombre} (manager ${f.manager})`;
    const res = await enviar('escanear', {
      imagenes,
      local: describir(r.fl),
      visitante: describir(r.fv),
      jugadoresLocal: r.sugL.slice(0, 40).map((j) => j.nombre),
      jugadoresVisitante: r.sugV.slice(0, 40).map((j) => j.nombre),
    }, estado.clave);
    if (registro !== r) return;
    aplicarLectura(res.lectura);
    avisar('Listo. Revisa que todo esté bien y guarda.', 'exito');
  } catch (e) {
    avisar(e.message, 'error');
  } finally {
    if (registro === r) {
      r.escaneando = false;
      renderRegistro();
    }
  }
}

function aplicarLectura(lectura) {
  const r = registro;
  const notas = [];
  // Ajusta cada nombre leído al jugador que ya conocemos, si se parece.
  const ajustar = (lista, propios) => (lista || []).map((g) => {
    if (g.autogol) return 'Autogol';
    const nombre = String(g.jugador || '').trim();
    const res = L.buscarParecido(nombre, [...propios.map((j) => j.nombre), ...r.todos]);
    return res.tipo === 'nuevo' ? nombre : res.nombre;
  });
  const numero = (...v) => Math.max(0, parseInt(v.find((x) => x !== undefined && x !== null), 10) || 0);
  r.wo = false;
  // El marcador del encabezado manda; los goleadores se acomodan a él, nunca al revés.
  r.gl = numero(lectura.marcador_local, lectura.goles_local);
  r.gv = numero(lectura.marcador_visitante, lectura.goles_visitante);
  const leidosL = ajustar(lectura.goleadores_local, r.sugL);
  const leidosV = ajustar(lectura.goleadores_visitante, r.sugV);
  r.leidosL = [...new Set(leidosL)];
  r.leidosV = [...new Set(leidosV)];
  r.golesL = leidosL.slice(0, r.gl);
  r.golesV = leidosV.slice(0, r.gv);
  const revisar = (leidos, goles, f) => {
    if (leidos.length > goles) notas.push(`⚠️ El marcador dice ${goles} de ${f.manager}, pero se leyeron ${leidos.length} goleadores (${leidos.join(', ')}). Puse los primeros ${goles}. Si alguno está mal, bórralo con ✕ y toca el correcto (marcados con 📸).`);
    if (leidos.length < goles) notas.push(`⚠️ Faltan ${goles - leidos.length} goleador(es) de ${f.manager}: no se alcanzaron a ver en las fotos.`);
  };
  revisar(leidosL, r.gl, r.fl);
  revisar(leidosV, r.gv, r.fv);
  ajustarGoles();
  if (lectura.dudas) notas.push(`🤖 ${lectura.dudas}`);
  r.dudas = notas.join('\n');
}


// ---------------------------------------------------------------------------
// Manager: ficha y edición
// ---------------------------------------------------------------------------

function abrirManager(nombre) {
  const { liga } = estado;
  const fila = L.tablaHistorica(liga).find((f) => f.manager === nombre);
  if (!fila) return;
  const trayectoria = L.trayectoria(liga, nombre);
  const goleadores = L.goleoHistorico(liga)
    .map((g) => ({ jugador: g.jugador, goles: g.managers.find(([m]) => m === nombre)?.[1] || 0 }))
    .filter((g) => g.goles).sort((a, b) => b.goles - a.goles).slice(0, 5);
  const rivales = [...liga.managers.keys()].filter((m) => m !== nombre)
    .map((m) => ({ m, d: L.caraACara(liga, nombre, m) })).filter((x) => x.d.partidos.length);

  const cuerpo = `
    <div class="tarjeta">
      <div class="manager-tarjeta">
        <span class="avatar">${esc(liga.emojiDe(nombre))}</span>
        <span class="datos"><b>${esc(nombre)}</b> <span class="trofeos">${'🏆'.repeat(fila.titulos)}</span>
          <small>${fila.titulos} título(s) · ${fila.subtitulos} subcampeonato(s)</small></span>
        <span class="efectividad"><b>${fila.efectividad}%</b><small>efectividad</small></span>
      </div>
      <div class="estadisticas">
        <div><b>${fila.pj}</b><small>PJ</small></div>
        <div><b>${fila.g}</b><small>Ganados</small></div>
        <div><b>${fila.e}</b><small>Empates</small></div>
        <div><b>${fila.p}</b><small>Perdidos</small></div>
        <div><b>${fila.gf}</b><small>GF</small></div>
        <div><b>${fila.gc}</b><small>GC</small></div>
        <div><b>${fila.dg > 0 ? '+' : ''}${fila.dg}</b><small>DG</small></div>
        <div><b>${fila.pts}</b><small>Puntos</small></div>
      </div>
    </div>
    <div class="titulo-seccion">Torneo por torneo</div>
    <div class="lista">${trayectoria.map((x) => `
      <div class="fila"><span class="lugar">${x.archivado ? medalla(x.posicion - 1) : x.posicion}</span>
        <div class="principal"><b>${esc(x.torneo)}</b><small>${x.archivado ? `Terminó ${x.posicion}° de ${x.de}` : `Va ${x.posicion}° de ${x.de} (en curso)`} · ${x.fila.g}G ${x.fila.e}E ${x.fila.p}P</small></div>
        <span class="cifra">${x.fila.pts}<small>pts</small></span></div>`).join('')}</div>
    ${goleadores.length ? `<div class="titulo-seccion">Sus goleadores</div><div class="lista">${goleadores.map((g, i) => `
      <div class="fila"><span class="lugar">${i + 1}</span><div class="principal"><b>${esc(g.jugador)}</b></div><span class="cifra">${g.goles}</span></div>`).join('')}</div>` : ''}
    ${rivales.length ? `<div class="titulo-seccion">Contra cada rival</div><div class="lista">${rivales.map(({ m, d }) => `
      <button class="fila" data-accion="ir-duelo" data-a="${esc(nombre)}" data-b="${esc(m)}">
        <span style="font-size:22px">${esc(liga.emojiDe(m))}</span>
        <div class="principal"><b>vs ${esc(m)}</b><small>${d.ga}G ${d.e}E ${d.gb}P · goles ${d.golesA}-${d.golesB}</small></div>
        <span class="etiqueta ${d.ga > d.gb ? 'verde' : d.ga < d.gb ? 'rojo' : ''}">${d.ga > d.gb ? 'Domina' : d.ga < d.gb ? 'Le cuesta' : 'Parejo'}</span>
      </button>`).join('')}</div>` : ''}`;
  mostrarHoja(`${esc(liga.emojiDe(nombre))} ${esc(nombre)}`, 'Historial en todos los torneos', cuerpo);
}

function abrirEditarManager(nombre) {
  const m = estado.liga.managers.get(nombre);
  const cuerpo = `
    <label class="campo"><span>Nombre</span><input class="entrada" id="manager-nombre" value="${esc(nombre)}" ${nombre ? 'readonly' : ''} placeholder="Ej. Rosa"></label>
    <label class="campo"><span>Emoji (uno solo)</span><input class="entrada" id="manager-emoji" value="${esc(m?.emoji || '')}" placeholder="🦕" style="font-size:24px"></label>
    <p class="nota">El emoji aparece en el calendario, la tabla y el historial.</p>`;
  mostrarHoja(nombre ? 'Editar manager' : 'Nuevo manager', '', cuerpo, '<button class="boton principal" data-accion="guardar-manager">Guardar</button>');
}

async function guardarManager() {
  const manager = $('#manager-nombre').value.trim();
  const emoji = $('#manager-emoji').value.trim();
  if (!manager) return avisar('Escribe el nombre del manager.', 'error');
  try {
    const r = await enviar('guardarManager', { manager, emoji }, estado.clave);
    aplicarDatos(r.datos, true);
    cerrarHoja();
    avisar('✅ Manager guardado', 'exito');
  } catch (e) {
    avisar(e.message, 'error');
  }
}


// ---------------------------------------------------------------------------
// Torneo nuevo y archivar
// ---------------------------------------------------------------------------

function abrirNuevoTorneo() {
  const { liga } = estado;
  const ultimo = L.torneosOrdenados(liga)[0];
  const base = ultimo ? ultimo.equipos.filter((e) => !e.descanso && e.manager) : [];
  nuevoTorneo = {
    nombre: '',
    tipo: L.TIPOS[0].nombre,
    semanas: L.SEMANAS_DEFAULT,
    goleadores: true,
    archivarActual: true,
    equipos: (base.length ? base : [...liga.managers.values()].slice(0, 6))
      .map((e) => ({ manager: e.manager || e.nombre, club: '', emoji: liga.emojiDe(e.manager || e.nombre) })),
  };
  renderNuevoTorneo();
}

function renderNuevoTorneo() {
  const nt = nuevoTorneo;
  const managers = [...estado.liga.managers.keys()];
  const hayActivo = L.torneosOrdenados(estado.liga).some((t) => !t.archivado);
  const cuerpo = `
    <label class="campo"><span>Nombre del torneo</span><input class="entrada" data-campo="nt-nombre" value="${esc(nt.nombre)}" placeholder="Ej. MásGas FC27#2"></label>
    <div class="titulo-seccion" style="margin-top:6px">Equipos <small>${nt.equipos.length} de 5–6 · el orden define el calendario</small></div>
    ${nt.equipos.map((e, i) => `
      <div class="equipo-nuevo">
        <input class="entrada emoji" data-campo="nt-emoji" data-i="${i}" value="${esc(e.emoji)}" aria-label="Emoji">
        <select class="entrada" data-campo="nt-manager" data-i="${i}">${managers.map((m) => `<option ${m === e.manager ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
        <input class="entrada" data-campo="nt-club" data-i="${i}" value="${esc(e.club)}" placeholder="Club (ej. América)">
      </div>`).join('')}
    <div class="botones" style="margin-top:8px">
      ${nt.equipos.length < 6 ? '<button class="boton chico secundario" data-accion="nt-agregar">➕ Equipo</button>' : '<span></span>'}
      ${nt.equipos.length > 5 ? '<button class="boton chico secundario" data-accion="nt-quitar">➖ Quitar último</button>' : '<span></span>'}
    </div>
    <button class="boton chico secundario" data-accion="nt-sortear" style="width:100%;margin-top:8px">🎲 Sortear orden</button>
    ${nt.equipos.length === 5 ? '<p class="nota">Con 5 equipos se agrega un “Descanso” automáticamente.</p>' : ''}
    <div class="titulo-seccion">Tipo de torneo <small>se puede cambiar después</small></div>
    ${selectorTipo('nt-tipo', nt.tipo, nt.semanas)}
    <label class="interruptor"><span>Registrar goleadores</span><input type="checkbox" data-campo="nt-goleadores" ${nt.goleadores ? 'checked' : ''}><span class="riel"></span></label>
    ${hayActivo ? `<label class="interruptor"><span>Archivar el torneo que está en curso</span><input type="checkbox" data-campo="nt-archivar" ${nt.archivarActual ? 'checked' : ''}><span class="riel"></span></label>` : ''}`;
  mostrarHoja('Nuevo torneo', '', cuerpo, '<button class="boton principal" data-accion="crear-torneo">Crear torneo</button>');
}

async function crearTorneo() {
  const nt = nuevoTorneo;
  const nombre = nt.nombre.trim();
  if (!nombre) return avisar('Escribe el nombre del torneo.', 'error');
  const repetidos = nt.equipos.map((e) => e.manager).filter((m, i, a) => a.indexOf(m) !== i);
  if (repetidos.length) return avisar(`${repetidos[0]} está dos veces.`, 'error');
  const equipos = nt.equipos.map((e) => ({
    manager: e.manager,
    equipo: e.club.trim() ? `${e.emoji.trim()}${e.club.trim()} (${e.manager})` : `${e.emoji.trim()} ${e.manager}`,
  }));
  try {
    const activos = L.torneosOrdenados(estado.liga).filter((t) => !t.archivado).map((t) => t.nombre);
    let r = await enviar('crearTorneo', { torneo: nombre, equipos, tipo: nt.tipo, semanas: nt.semanas, goleadores: nt.goleadores }, estado.clave);
    if (nt.archivarActual) {
      for (const t of activos) r = await enviar('cambiarEstadoTorneo', { torneo: t, estado: 'Archivado' }, estado.clave);
    }
    estado.torneo = nombre;
    estado.semana = null;
    guardarLocal(LLAVES.torneo, nombre);
    aplicarDatos(r.datos, true);
    cerrarHoja();
    estado.vista = 'jornadas';
    render();
    avisar(`🏁 ¡${nombre} creado!`, 'exito');
  } catch (e) {
    avisar(e.message, 'error');
  }
}

async function cambiarEstadoTorneo() {
  const t = estado.liga.torneos.get(estado.torneo);
  if (!t) return;
  const nuevo = t.archivado ? 'Activo' : 'Archivado';
  const pregunta = t.archivado ? `¿Reactivar ${t.nombre}?` : `¿Archivar ${t.nombre}? Ya no se podrán registrar resultados (se puede reactivar después).`;
  if (!confirm(pregunta)) return;
  try {
    const r = await enviar('cambiarEstadoTorneo', { torneo: t.nombre, estado: nuevo }, estado.clave);
    aplicarDatos(r.datos, true);
    avisar(t.archivado ? '♻️ Torneo reactivado' : '🗄️ Torneo archivado', 'exito');
  } catch (e) {
    avisar(e.message, 'error');
  }
}

async function ajustarTorneo(cambios) {
  const t = estado.liga.torneos.get(estado.torneo);
  if (!t) return;
  try {
    const r = await enviar('ajustarTorneo', { torneo: t.nombre, tipo: t.tipo, semanas: t.semanas, goleadores: t.goleadores, ...cambios }, estado.clave);
    aplicarDatos(r.datos, true);
    avisar('✅ Ajuste guardado', 'exito');
  } catch (e) {
    avisar(e.message, 'error');
    render();
  }
}

async function compartir() {
  const url = `${location.origin}${location.pathname}${estado.clave ? `#k=${encodeURIComponent(estado.clave)}` : ''}`;
  try {
    if (navigator.share) await navigator.share({ title: 'FifafoFumar', text: 'Liga FifafoFumar', url });
    else {
      await navigator.clipboard.writeText(url);
      avisar('🔗 Enlace copiado', 'exito');
    }
  } catch { /* el usuario canceló */ }
}


// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

document.addEventListener('click', (ev) => {
  const nav = ev.target.closest('.navegacion button');
  if (nav) return cambiarVista(nav.dataset.vista);
  if (ev.target.id === 'hoja-fondo') return cerrarHoja();

  const el = ev.target.closest('[data-accion]');
  if (!el) return;
  const d = el.dataset;
  switch (d.accion) {
    case 'actualizar': return actualizar();
    case 'elegir-torneo': return estado.liga && abrirElegirTorneo();
    case 'usar-torneo':
      estado.torneo = d.torneo;
      estado.semana = null;
      guardarLocal(LLAVES.torneo, d.torneo);
      cerrarHoja();
      return render();
    case 'cerrar-hoja': return cerrarHoja();
    case 'semana':
      estado.semana = Number(d.semana);
      return render();
    case 'registrar': return abrirRegistro(buscarDesdeBoton(el));
    case 'ver-partido': return abrirPartido(buscarDesdeBoton(el));
    case 'corregir': return corregirPartido(buscarDesdeBoton(el));
    case 'sumar': return cambiarGoles(d.lado, 1);
    case 'restar': return cambiarGoles(d.lado, -1);
    case 'chip': return tocarChip(d.lado, d.nombre);
    case 'quitar-gol': return quitarGol(d.lado, Number(d.i));
    case 'usar-sugerencia':
      (d.lado === 'L' ? registro.golesL : registro.golesV)[Number(d.i)] = d.nombre;
      return renderRegistro();
    case 'ganador-wo':
      registro.ganadorWo = d.lado;
      return renderRegistro();
    case 'guardar-resultado': return guardarResultado();
    case 'historia':
      estado.historia = d.pestana;
      return render();
    case 'ver-manager': return abrirManager(d.manager);
    case 'ir-duelo':
      estado.duelo = [d.a, d.b];
      estado.historia = 'duelos';
      cerrarHoja();
      return cambiarVista('historia');
    case 'editar-manager': return abrirEditarManager(d.manager);
    case 'guardar-manager': return guardarManager();
    case 'nuevo-torneo': return abrirNuevoTorneo();
    case 'nt-agregar': {
      const usados = new Set(nuevoTorneo.equipos.map((e) => e.manager));
      const libre = [...estado.liga.managers.keys()].find((m) => !usados.has(m)) || [...estado.liga.managers.keys()][0];
      nuevoTorneo.equipos.push({ manager: libre, club: '', emoji: estado.liga.emojiDe(libre) });
      return renderNuevoTorneo();
    }
    case 'nt-quitar':
      nuevoTorneo.equipos.pop();
      return renderNuevoTorneo();
    case 'nt-sortear': {
      const e = nuevoTorneo.equipos;
      for (let i = e.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [e[i], e[j]] = [e[j], e[i]];
      }
      return renderNuevoTorneo();
    }
    case 'crear-torneo': return crearTorneo();
    case 'nt-tipo':
      nuevoTorneo.tipo = d.tipo;
      nuevoTorneo.semanas = Number(d.semanas);
      return renderNuevoTorneo();
    case 'tipo-torneo': {
      if (!confirm(`¿Cambiar a ${d.tipo} de ${d.semanas} semanas?`)) return undefined;
      return ajustarTorneo({ tipo: d.tipo, semanas: Number(d.semanas) });
    }
    case 'cambiar-estado': return cambiarEstadoTorneo();
    case 'compartir': return compartir();
    case 'ver-refuerzos':
      estado.verRefuerzos = true;
      return render();
    default: return undefined;
  }
});

document.addEventListener('input', (ev) => {
  const el = ev.target;
  const campo = el.dataset?.campo;
  if (!campo) return;
  if (campo === 'gol' && registro) {
    const { lado, i } = el.dataset;
    (lado === 'L' ? registro.golesL : registro.golesV)[Number(i)] = el.value;
    const caja = document.getElementById(`sug-${lado}-${i}`);
    if (caja) caja.innerHTML = sugerenciaHTML(lado, Number(i), el.value);
  } else if (campo === 'toma' && registro) registro.toma = el.value;
  else if (campo === 'cede' && registro) registro.cede = el.value;
  else if (campo === 'nt-nombre') nuevoTorneo.nombre = el.value;
  else if (campo === 'nt-club') nuevoTorneo.equipos[Number(el.dataset.i)].club = el.value;
  else if (campo === 'nt-emoji') nuevoTorneo.equipos[Number(el.dataset.i)].emoji = el.value;
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  const campo = el.dataset?.campo;
  if (!campo) return;
  if (campo === 'fotos') {
    escanear(el.files);
    el.value = '';
  } else if (campo === 'wo') {
    registro.wo = el.checked;
    renderRegistro();
  } else if (campo === 'refuerzo') {
    registro.refuerzo = el.checked;
    renderRegistro();
  } else if (campo === 'duelo-a' || campo === 'duelo-b') {
    estado.duelo[campo === 'duelo-a' ? 0 : 1] = el.value;
    render();
  } else if (campo === 'nt-manager') {
    const e = nuevoTorneo.equipos[Number(el.dataset.i)];
    e.manager = el.value;
    e.emoji = estado.liga.emojiDe(el.value);
    renderNuevoTorneo();
  } else if (campo === 'nt-archivar') {
    nuevoTorneo.archivarActual = el.checked;
  } else if (campo === 'nt-goleadores') {
    nuevoTorneo.goleadores = el.checked;
  } else if (campo === 'goleadores-torneo') {
    ajustarTorneo({ goleadores: el.checked });
  }
});

iniciar();
