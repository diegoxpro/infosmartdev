import { useState } from 'react';
import { api, descargar } from '../api';
import { useToast } from '../components/ui';

type ModoStock = 'reemplazar' | 'sumar';

interface FilaRevisada {
  hoja: 'Productos' | 'Presentaciones';
  fila: number;
  estado: 'nuevo' | 'actualiza' | 'igual' | 'error';
  nombre: string;
  codigo: string | null;
  cambios: string[];
  errores: string[];
  avisos: string[];
}

interface Resumen {
  productosNuevos: number;
  productosActualizados: number;
  presentacionesNuevas: number;
  presentacionesActualizadas: number;
  sinCambios: number;
  conError: number;
  unidadesEntran: number;
  unidadesSalen: number;
  categoriasNuevas: string[];
  marcasNuevas: string[];
}

interface Revision {
  archivo: string;
  modoStock: ModoStock;
  resumen: Resumen;
  columnasIgnoradas: string[];
  filas: FilaRevisada[];
}

const ESTADO: Record<FilaRevisada['estado'], [string, string]> = {
  nuevo: ['Nuevo', 'ok'],
  actualiza: ['Cambia', 'info'],
  igual: ['Sin cambios', ''],
  error: ['Error', 'danger'],
};

const FILTROS = [
  ['todos', 'Todos'],
  ['error', 'Con error'],
  ['nuevo', 'Nuevos'],
  ['actualiza', 'Cambian'],
  ['avisos', 'Con aviso'],
] as const;

const leerBase64 = (archivo: File) =>
  new Promise<string>((ok, mal) => {
    const lector = new FileReader();
    lector.onload = () => ok(String(lector.result).split(',')[1] ?? '');
    lector.onerror = () => mal(new Error('No se pudo leer el archivo'));
    lector.readAsDataURL(archivo);
  });

const miles = (x: number) => x.toLocaleString('es-PE', { maximumFractionDigits: 3 });

/** Configuración → Importar productos: carga o actualiza productos, precios y stock desde un Excel. */
export default function ImportarProductos() {
  const avisar = useToast();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [modo, setModo] = useState<ModoStock>('reemplazar');
  const [revision, setRevision] = useState<Revision | null>(null);
  const [resultado, setResultado] = useState<Resumen | null>(null);
  const [ocupado, setOcupado] = useState<'' | 'revisar' | 'importar' | 'plantilla' | 'productos'>('');
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number][0]>('todos');
  const [entradaArchivo, setEntradaArchivo] = useState(0);

  const tarea = async (cual: typeof ocupado, fn: () => Promise<void>) => {
    setOcupado(cual);
    try {
      await fn();
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setOcupado('');
    }
  };

  const cuerpo = async (m: ModoStock) => {
    if (!archivo) throw new Error('Elige el archivo de Excel');
    if (archivo.size > 12 * 1024 * 1024) throw new Error('El archivo pesa más de 12 MB');
    return { nombre: archivo.name, archivo: await leerBase64(archivo), modoStock: m };
  };

  const revisar = (m = modo) =>
    tarea('revisar', async () => {
      setResultado(null);
      setRevision(await api<Revision>('/importacion/revisar', { body: await cuerpo(m) }));
      setFiltro('todos');
    });

  const importar = () =>
    tarea('importar', async () => {
      if (!revision) return;
      const { resumen: r } = revision;
      const partes = [
        r.productosNuevos && `crear ${r.productosNuevos} productos`,
        r.productosActualizados && `cambiar ${r.productosActualizados} productos`,
        r.presentacionesNuevas + r.presentacionesActualizadas && `guardar ${r.presentacionesNuevas + r.presentacionesActualizadas} presentaciones`,
      ].filter(Boolean);
      const errores = r.conError ? `\n\nLas ${r.conError} filas con error NO se importan.` : '';
      if (!window.confirm(`Se va a ${partes.join(', ')}.${errores}\n\n¿Importar ahora?`)) return;
      const hecho = await api<Resumen>('/importacion/importar', { body: await cuerpo(revision.modoStock) });
      setResultado(hecho);
      setRevision(null);
      setArchivo(null);
      setEntradaArchivo((x) => x + 1);
      avisar('Importación lista');
    });

  const cambiarModo = (m: ModoStock) => {
    setModo(m);
    if (revision) revisar(m);
  };

  const hoy = new Date().toISOString().slice(0, 10);
  const r = revision?.resumen;
  const hayCambios = !!r && r.productosNuevos + r.productosActualizados + r.presentacionesNuevas + r.presentacionesActualizadas > 0;
  const filas = (revision?.filas ?? []).filter((f) =>
    filtro === 'todos' ? true : filtro === 'avisos' ? f.avisos.length > 0 : f.estado === filtro,
  );

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <div className="card card-pad stack">
        <div>
          <h2>1. Prepara el Excel</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Descarga la plantilla para productos nuevos, o tus productos actuales para corregir precios, costos o stock y volver a subirlos.
            Una celda vacía no cambia nada. El producto se busca por <b>ID sistema</b>, luego por <b>código de barras</b> y, si no tiene código, por su <b>nombre</b>.
          </p>
        </div>
        <div className="row">
          <button className="btn" disabled={!!ocupado} onClick={() => tarea('plantilla', () => descargar('/importacion/plantilla', 'plantilla_productos.xlsx'))}>
            {ocupado === 'plantilla' ? 'Descargando…' : 'Descargar plantilla vacía'}
          </button>
          <button className="btn" disabled={!!ocupado} onClick={() => tarea('productos', () => descargar('/importacion/plantilla?conProductos=1', `productos_${hoy}.xlsx`))}>
            {ocupado === 'productos' ? 'Descargando…' : 'Descargar mis productos en Excel'}
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Hoja <b>Productos</b>: nombre, código, categoría, marca, costo, precios 1/2/3, stock, stock mínimo, vencimiento y lote (opcionales).
          Hoja <b>Presentaciones</b> (opcional): cajetillas, paquetes o cajas con sus unidades, código y precios. También sirve un Excel propio si los títulos de las columnas se parecen.
        </p>
      </div>

      <div className="card card-pad stack">
        <h2>2. Sube el archivo y revisa</h2>
        <div className="grid-2">
          <label className="field">
            <span>Archivo de Excel (.xlsx) o CSV</span>
            <input
              key={entradaArchivo}
              type="file"
              accept=".xlsx,.csv"
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null);
                setRevision(null);
                setResultado(null);
              }}
            />
          </label>
          <div className="field" role="radiogroup" aria-label="La columna Stock trae">
            <span>La columna Stock trae…</span>
            <label className="check">
              <input type="radio" name="modo-stock" checked={modo === 'reemplazar'} onChange={() => cambiarModo('reemplazar')} />
              el stock contado: reemplaza el stock actual
            </label>
            <label className="check">
              <input type="radio" name="modo-stock" checked={modo === 'sumar'} onChange={() => cambiarModo('sumar')} />
              lo que ingresa: se suma al stock actual
            </label>
          </div>
        </div>
        {modo === 'sumar' && (
          <div className="alert warn">
            Usa “se suma” solo con un Excel que traiga lo que está entrando. Si subes el archivo de “Descargar mis productos”, el stock se duplicaría.
          </div>
        )}
        <div className="row">
          <button className="btn btn-primary" onClick={() => revisar()} disabled={!archivo || !!ocupado}>
            {ocupado === 'revisar' ? 'Revisando…' : 'Revisar archivo'}
          </button>
          <span className="small muted">Todavía no se guarda nada: primero verás qué se va a crear o cambiar.</span>
        </div>
      </div>

      {resultado && (
        <div className="alert info">
          <div>
            <b>Importación terminada.</b> Productos creados: {resultado.productosNuevos}, actualizados: {resultado.productosActualizados}
            {resultado.presentacionesNuevas + resultado.presentacionesActualizadas > 0 &&
              `, presentaciones guardadas: ${resultado.presentacionesNuevas + resultado.presentacionesActualizadas}`}
            . {resultado.conError > 0 && `${resultado.conError} filas con error no se importaron. `}
            Los cambios de stock quedan en el kardex como “Importación”.
          </div>
        </div>
      )}

      {revision && r && (
        <div className="card">
          <div className="card-head">
            <h2>3. Revisa y confirma</h2>
            <span className="small muted">{revision.archivo}</span>
          </div>
          <div className="card-pad stack">
            <div className="grid-4">
              <div className={`card stat${r.productosNuevos ? '' : ' cero'}`}>
                <div className="label">Productos nuevos</div>
                <div className="value">{miles(r.productosNuevos)}</div>
              </div>
              <div className={`card stat${r.productosActualizados ? '' : ' cero'}`}>
                <div className="label">Productos que cambian</div>
                <div className="value">{miles(r.productosActualizados)}</div>
              </div>
              <div className={`card stat${r.presentacionesNuevas + r.presentacionesActualizadas ? '' : ' cero'}`}>
                <div className="label">Presentaciones</div>
                <div className="value">{miles(r.presentacionesNuevas + r.presentacionesActualizadas)}</div>
              </div>
              <div className={`card stat${r.conError ? ' danger' : ' cero'}`}>
                <div className="label">Filas con error</div>
                <div className="value">{miles(r.conError)}</div>
              </div>
            </div>
            <div className="small muted">
              Sin cambios: {miles(r.sinCambios)} filas. Stock: entran {miles(r.unidadesEntran)} unidades
              {r.unidadesSalen > 0 && `, salen ${miles(r.unidadesSalen)}`}.
              {r.categoriasNuevas.length > 0 && ` Categorías nuevas: ${r.categoriasNuevas.join(', ')}.`}
              {r.marcasNuevas.length > 0 && ` Marcas nuevas: ${r.marcasNuevas.join(', ')}.`}
              {revision.columnasIgnoradas.length > 0 && ` Columnas que no se usan: ${revision.columnasIgnoradas.join(', ')}.`}
            </div>
            {r.conError > 0 && (
              <div className="alert warn">Las filas con error no se importan. Corrígelas en el Excel y vuelve a revisar, o importa solo las correctas.</div>
            )}
            {revision.filas.length > 0 && (
              <div className="tabs" style={{ marginBottom: 0 }}>
                {FILTROS.map(([k, t]) => (
                  <button key={k} className={filtro === k ? 'active' : ''} onClick={() => setFiltro(k)}>{t}</button>
                ))}
              </div>
            )}
          </div>
          {revision.filas.length > 0 && (
            <div className="table-wrap" style={{ maxHeight: 520 }}>
              <table>
                <thead>
                  <tr><th>Fila</th><th>Producto</th><th>Qué pasa</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {filas.slice(0, 500).map((f) => (
                    <tr key={`${f.hoja}-${f.fila}`}>
                      <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{f.hoja === 'Presentaciones' ? 'Pres. ' : ''}{f.fila}</td>
                      <td>
                        <div>{f.nombre || '—'}</div>
                        {f.codigo && <div className="small muted mono">{f.codigo}</div>}
                      </td>
                      <td className="small">
                        {f.errores.map((x) => <div key={x} style={{ color: 'var(--danger)' }}>{x}</div>)}
                        {f.cambios.map((x) => <div key={x}>{x}</div>)}
                        {f.avisos.map((x) => <div key={x} style={{ color: 'var(--warn)' }}>{x}</div>)}
                      </td>
                      <td><span className={`badge ${ESTADO[f.estado][1]}`}>{ESTADO[f.estado][0]}</span></td>
                    </tr>
                  ))}
                  {!filas.length && <tr><td colSpan={4} className="muted">No hay filas con este filtro.</td></tr>}
                </tbody>
              </table>
              {filas.length > 500 && <div className="small muted card-pad">Se muestran 500 de {miles(filas.length)} filas.</div>}
            </div>
          )}
          <div className="card-pad row" style={{ borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-primary" onClick={importar} disabled={!hayCambios || !!ocupado}>
              {ocupado === 'importar' ? 'Importando…' : r.conError ? 'Importar las filas correctas' : 'Importar'}
            </button>
            <button className="btn" onClick={() => setRevision(null)} disabled={!!ocupado}>Cancelar</button>
            {!hayCambios && <span className="small muted">El archivo no trae nada nuevo para guardar.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
