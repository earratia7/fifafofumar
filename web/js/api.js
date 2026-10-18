// Comunicación con el servidor de Apps Script (o con datos de prueba en modo demo).
import { API_URL } from './config.js';

export const esDemo = !API_URL;

export class ClaveInvalida extends Error {}

function revisar(respuesta) {
  if (respuesta.ok) return respuesta;
  if (respuesta.error === 'CLAVE_INVALIDA') throw new ClaveInvalida('El enlace no es válido.');
  throw new Error(respuesta.error || 'Algo salió mal en el servidor.');
}

export async function cargarDatos(clave) {
  if (esDemo) return demo.cargar();
  const r = await fetch(`${API_URL}?k=${encodeURIComponent(clave)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`No pude conectarme con la hoja (error ${r.status}).`);
  return revisar(await r.json()).datos;
}

/** Ejecuta una acción en el servidor. Regresa la respuesta completa (normalmente trae los datos actualizados). */
export async function enviar(accion, datos, clave) {
  if (esDemo) return demo.enviar(accion, datos);
  // text/plain evita la verificación previa de CORS que Apps Script no contesta.
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ k: clave, accion, datos }),
  });
  if (!r.ok) throw new Error(`No pude conectarme con la hoja (error ${r.status}).`);
  return revisar(await r.json());
}


// ---------------------------------------------------------------------------
// Modo demo: lee datos-demo.json y simula los cambios solo en memoria.
// ---------------------------------------------------------------------------

const demo = {
  datos: null,

  async cargar() {
    if (!this.datos) {
      const r = await fetch('datos-demo.json', { cache: 'no-store' });
      this.datos = r.ok ? await r.json() : { Partidos: [], Equipos: [], Goleadores: [], Transferencias: [], Managers: [] };
      this.datos.Managers = this.datos.Managers || [];
      this.datos.Torneos = this.datos.Torneos || [];
    }
    await new Promise((ok) => setTimeout(ok, 300));
    return structuredClone(this.datos);
  },

  async enviar(accion, d) {
    await this.cargar();
    await new Promise((ok) => setTimeout(ok, 500));
    const D = this.datos;
    const mismoPartido = (p) => p.Torneo === d.torneo && p.Jornada === d.jornada && p.Local === d.local && p.Visitante === d.visitante;
    switch (accion) {
      case 'guardarResultado': {
        if (D.Partidos.some(mismoPartido)) return { ok: false, error: 'Ese partido ya estaba registrado.' };
        D.Partidos.push({ Torneo: d.torneo, Jornada: d.jornada, Local: d.local, Goles_L: d.gl, Goles_V: d.gv, Visitante: d.visitante, WO: d.wo ? 1 : 0 });
        for (const g of d.goleadores) D.Goleadores.push({ Torneo: d.torneo, Jornada: d.jornada, Equipo: g.equipo, Jugador: g.jugador, Goles: g.goles || 1 });
        if (d.transferencia?.toma) D.Transferencias.push({ Torneo: d.torneo, Jornada: d.jornada, Equipo: d.transferencia.equipo, Toma: d.transferencia.toma, Cede: d.transferencia.cede });
        break;
      }
      case 'borrarResultado': {
        D.Partidos = D.Partidos.filter((p) => !mismoPartido(p));
        const delPartido = (r) => r.Torneo === d.torneo && r.Jornada === d.jornada && (r.Equipo === d.local || r.Equipo === d.visitante);
        D.Goleadores = D.Goleadores.filter((r) => !delPartido(r));
        D.Transferencias = D.Transferencias.filter((r) => !delPartido(r));
        break;
      }
      case 'crearTorneo': {
        if (D.Equipos.some((e) => e.Torneo === d.torneo)) return { ok: false, error: 'Ya existe un torneo con ese nombre.' };
        for (const e of d.equipos) D.Equipos.push({ Torneo: d.torneo, Equipo: e.equipo, Estado: 'Activo', Manager: e.manager });
        if (d.equipos.length === 5) D.Equipos.push({ Torneo: d.torneo, Equipo: 'Descanso', Estado: 'Activo', Manager: '' });
        D.Torneos.push({ Torneo: d.torneo, Semanas: d.semanas || 6, Goleadores: d.goleadores === false ? 'No' : 'Sí' });
        break;
      }
      case 'cambiarEstadoTorneo':
        for (const e of D.Equipos) if (e.Torneo === d.torneo) e.Estado = d.estado;
        break;
      case 'ajustarTorneo': {
        const fila = { Torneo: d.torneo, Semanas: d.semanas, Goleadores: d.goleadores === false ? 'No' : 'Sí' };
        const i = D.Torneos.findIndex((x) => x.Torneo === d.torneo);
        if (i >= 0) D.Torneos[i] = fila;
        else D.Torneos.push(fila);
        break;
      }
      case 'guardarManager': {
        const m = D.Managers.find((x) => x.Manager.toLowerCase() === d.manager.toLowerCase());
        if (m) m.Emoji = d.emoji;
        else D.Managers.push({ Manager: d.manager, Emoji: d.emoji });
        break;
      }
      case 'escanear':
        await new Promise((ok) => setTimeout(ok, 1200));
        return {
          ok: true,
          lectura: {
            goles_local: 2, goles_visitante: 1,
            goleadores_local: [{ jugador: d.jugadoresLocal[0] || 'Jugador 1', minuto: "12'" }, { jugador: 'Mbape', minuto: "77'" }],
            goleadores_visitante: [{ jugador: d.jugadoresVisitante[0] || 'Jugador 2', minuto: "40'" }],
            dudas: 'Modo demo: esta lectura es inventada para probar la pantalla.',
          },
        };
      default:
        return { ok: false, error: 'Acción desconocida' };
    }
    return { ok: true, datos: structuredClone(D) };
  },
};
