# FifafoFumar

App para llevar la liga de EA SPORTS FC: calendario, resultados, tablas, goleo e historial por manager. Está pensada para usarse en el celular.

- **`web/`**: la página. Se publica sola en GitHub Pages cada vez que se sube un cambio a `main`.
- **`apps-script/Codigo.gs`**: el servidor. Vive dentro del Google Sheet de la liga, lee y guarda los datos y usa Gemini para leer las fotos del marcador.

La página no guarda ninguna llave. La clave de acceso viaja en el enlace de la liga (`#k=...`), y las llaves de Gemini y de la hoja se quedan dentro de Google.

## Tipos de torneo

Torneo Clásico (6 semanas), Torneo Cinco Estrellas (5), Copa La Onza (4) y Torneo Relámpago (3 o 2). El tipo se puede cambiar con el torneo en curso, siempre que no se pierdan semanas con resultados guardados.

## Hojas del Google Sheet

| Hoja | Columnas |
|---|---|
| Partidos | Torneo, Jornada, Local, Goles_L, Goles_V, Visitante, WO |
| Equipos | Torneo, Equipo, Estado, Manager |
| Goleadores | Torneo, Jornada, Equipo, Jugador, Goles |
| Transferencias | Torneo, Jornada, Equipo, Toma, Cede |
| Managers | Manager, Emoji |
| Torneos | Torneo, Tipo, Semanas, Goleadores |

La función `configurarHoja` crea las columnas y hojas nuevas y las llena con los datos que ya existen.

## Poner en marcha el servidor

1. En el Google Sheet: **Extensiones → Apps Script**.
2. Borra lo que haya, pega el contenido de `apps-script/Codigo.gs` y guarda.
3. **Configuración del proyecto** (engrane) → **Propiedades del script** y agrega:
   - `CLAVE`: una clave larga inventada (es la que irá en el enlace).
   - `GEMINI_API_KEY`: tu llave de Google AI Studio.
4. Arriba, elige la función `configurarHoja` → **Ejecutar** → autoriza los permisos.
5. **Implementar → Nueva implementación** → tipo **Aplicación web**:
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquier usuario**.
6. Copia la URL que termina en `/exec` y ponla en `web/js/config.js`.

Si después cambias `Codigo.gs`, ve a **Implementar → Administrar implementaciones → editar (lápiz) → Versión: nueva** para que se use el código nuevo con la misma URL.

## Enlace de la liga

`https://<usuario>.github.io/<repositorio>/#k=<CLAVE>`

Se abre una vez en cada celular. La app guarda la clave y después ya se puede abrir sin ella, o desde el ícono si se agrega a la pantalla de inicio.

## Probar en la computadora

Sin URL en `config.js`, la app funciona en **modo demo** con `web/datos-demo.json`. Ese archivo no se sube porque tiene los datos de la liga. Para probar:

```
python3 -m http.server 8600 --directory web
```

y abre `http://localhost:8600`.
