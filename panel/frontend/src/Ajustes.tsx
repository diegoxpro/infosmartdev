import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Ajustes, api, descargar, Empresa, fecha, NOMBRE_PRODUCTO, Producto, Respaldo, tamano } from './api';
import { Modal } from './App';

const MODOS = { DESACTIVADO: 'Desactivada', BETA: 'Pruebas (beta)', PRODUCCION: 'Producción' } as const;

/** Lo que Infosmart controla de un producto de una empresa: SUNAT, consulta DNI/RUC y backups. */
export function AjustesProducto({ empresa, producto, volver }: { empresa: Empresa; producto: Producto; volver: () => void }) {
  const ruta = `/empresas/${empresa.id}/productos/${producto}`;
  const [a, setA] = useState<Ajustes | null>(null);
  const [respaldos, setRespaldos] = useState<Respaldo[]>([]);
  const [aviso, setAviso] = useState<{ texto: string; error?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState('');

  const cargar = useCallback(async () => {
    const [x, r] = await Promise.all([api<Ajustes>(`${ruta}/ajustes`), api<Respaldo[]>(`${ruta}/respaldos`)]);
    setA(x); setRespaldos(r);
  }, [ruta]);
  useEffect(() => { cargar().catch((e) => setAviso({ texto: e.message, error: true })); }, [cargar]);

  async function tarea(nombre: string, fn: () => Promise<unknown>, ok: string) {
    setOcupado(nombre); setAviso(null);
    try { await fn(); await cargar(); setAviso({ texto: ok }); }
    catch (e) { setAviso({ texto: (e as Error).message, error: true }); }
    finally { setOcupado(''); }
  }
  const guardar = (cuerpo: Record<string, unknown>, ok: string, nombre = 'guardar') =>
    tarea(nombre, () => api(`${ruta}/ajustes`, { metodo: 'PATCH', cuerpo }), ok);

  return (
    <Modal titulo={`${NOMBRE_PRODUCTO[producto]} · ${empresa.razonSocial}`} cerrar={volver}>
      <div className="detalle">
        <button className="enlace" onClick={volver}>← Volver a la empresa</button>
        {!a ? <p className="tenue">Cargando…</p> : (
          <>
            <Sunat producto={producto} a={a} ruc={empresa.ruc} ocupado={ocupado} guardar={guardar}
              cargarCert={(archivo, clave) => tarea('cert', async () => {
                const base64 = await leerBase64(archivo);
                await api(`${ruta}/ajustes/certificado`, { metodo: 'POST', cuerpo: { archivo: base64, clave } });
              }, 'Certificado cargado')} />
            <ConsultaDoc configurado={a.consultaDocConfigurado} ocupado={ocupado} guardar={guardar} />
            <Respaldos a={a} lista={respaldos} ocupado={ocupado} guardar={guardar}
              ahora={() => tarea('backup', () => api(`${ruta}/respaldos`, { metodo: 'POST' }), 'Backup terminado')} />
          </>
        )}
        {aviso && <p className={aviso.error ? 'error' : 'ok-texto'} role="status">{aviso.texto}</p>}
      </div>
    </Modal>
  );
}

function leerBase64(f: File) {
  return new Promise<string>((ok, mal) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1] ?? '');
    r.onerror = () => mal(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(f);
  });
}

type Guardar = (cuerpo: Record<string, unknown>, ok: string, nombre?: string) => Promise<void>;

function Sunat({ a, ruc, producto, ocupado, guardar, cargarCert }: {
  a: Ajustes; ruc: string; producto: Producto; ocupado: string; guardar: Guardar; cargarCert: (f: File, clave: string) => Promise<void>;
}) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [claveCert, setClaveCert] = useState('');
  const [sol, setSol] = useState({ usuario: a.solUsuario ?? '', clave: '' });
  useEffect(() => setSol((s) => ({ ...s, usuario: a.solUsuario ?? '' })), [a.solUsuario]);
  const vencido = a.certificado?.venceEl && new Date(a.certificado.venceEl) < new Date();

  const cambiarModo = (modo: Ajustes['sunatModo']) => {
    if (modo === a.sunatModo) return;
    const aviso = producto === 'LAVADERO'
      ? 'En producción los comprobantes se envían a SUNAT y son reales. En el lavadero se borran las ventas y gastos de prueba y la numeración vuelve a empezar; no se puede deshacer. ¿Activar producción?'
      : 'En producción los comprobantes se envían a SUNAT y son reales. ¿Activar producción?';
    if (modo === 'PRODUCCION' && !confirm(aviso)) return;
    guardar({ sunatModo: modo }, `Facturación electrónica: ${MODOS[modo]}`, 'modo');
  };

  return (
    <>
      <h3>SUNAT · RUC {ruc}</h3>
      <div className="botonera">
        {(Object.keys(MODOS) as Ajustes['sunatModo'][]).map((m) => (
          <button key={m} className={a.sunatModo === m ? 'primario' : ''} disabled={!!ocupado} onClick={() => cambiarModo(m)}>{MODOS[m]}</button>
        ))}
      </div>
      <div className="producto columna">
        <strong>Certificado digital</strong>
        <span className={vencido ? 'error' : 'tenue'}>
          {a.certificado ? `${a.certificado.sujeto} · vence ${a.certificado.venceEl ? fecha(a.certificado.venceEl) : '¿?'}${vencido ? ' (vencido)' : ''}` : 'Sin certificado'}
        </span>
        <form className="fila-form" onSubmit={(e: FormEvent) => { e.preventDefault(); if (archivo) cargarCert(archivo, claveCert).then(() => { setArchivo(null); setClaveCert(''); }); }}>
          <input type="file" accept=".pfx,.p12" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          <input type="password" placeholder="Contraseña del certificado" value={claveCert} onChange={(e) => setClaveCert(e.target.value)} autoComplete="off" />
          <button disabled={!archivo || ocupado === 'cert'}>{ocupado === 'cert' ? 'Cargando…' : a.certificado ? 'Reemplazar' : 'Cargar'}</button>
        </form>
      </div>
      <div className="producto columna">
        <strong>Usuario SOL secundario</strong>
        <span className="tenue">Solo para producción. {a.solConfigurada ? 'Clave guardada.' : 'Sin clave.'}</span>
        <form className="fila-form" onSubmit={(e: FormEvent) => { e.preventDefault(); guardar({ solUsuario: sol.usuario, ...(sol.clave && { solClave: sol.clave }) }, 'Usuario SOL guardado', 'sol').then(() => setSol((s) => ({ ...s, clave: '' }))); }}>
          <input placeholder="Usuario" value={sol.usuario} onChange={(e) => setSol({ ...sol, usuario: e.target.value })} autoComplete="off" />
          <input type="password" placeholder={a.solConfigurada ? '•••••• (escribe para cambiarla)' : 'Clave SOL'} value={sol.clave} onChange={(e) => setSol({ ...sol, clave: e.target.value })} autoComplete="off" />
          <button disabled={ocupado === 'sol'}>Guardar</button>
        </form>
      </div>
    </>
  );
}

function ConsultaDoc({ configurado, ocupado, guardar }: { configurado: boolean; ocupado: string; guardar: Guardar }) {
  const [token, setToken] = useState('');
  return (
    <>
      <h3>Consulta DNI y RUC</h3>
      <div className="producto columna">
        <span className="tenue">Token de Decolecta. Con él, el sistema llena nombre y dirección al buscar un cliente. {configurado ? 'Activo.' : 'Sin configurar.'}</span>
        <form className="fila-form" onSubmit={(e: FormEvent) => { e.preventDefault(); guardar({ consultaDocToken: token.trim() }, 'Token guardado', 'token').then(() => setToken('')); }}>
          <input type="password" placeholder={configurado ? '•••••• (pega otro para cambiarlo)' : 'Pega el token'} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          <button disabled={!token.trim() || ocupado === 'token'}>Guardar</button>
          {configurado && <button type="button" onClick={() => guardar({ consultaDocToken: '' }, 'Consulta desactivada', 'token')}>Quitar</button>}
        </form>
      </div>
    </>
  );
}

function Respaldos({ a, lista, ocupado, guardar, ahora }: { a: Ajustes; lista: Respaldo[]; ocupado: string; guardar: Guardar; ahora: () => Promise<void> }) {
  const [hora, setHora] = useState(a.backupHora);
  const [conservar, setConservar] = useState(a.backupConservar);
  const cambiado = hora !== a.backupHora || conservar !== a.backupConservar;
  return (
    <>
      <h3>Backups</h3>
      <div className="fila-form">
        <label>Hora diaria (Lima)<input type="time" value={hora} onChange={(e) => setHora(e.target.value)} /></label>
        <label>Conservar<input type="number" min={1} max={90} value={conservar} onChange={(e) => setConservar(Number(e.target.value))} /></label>
        <button disabled={!cambiado || ocupado === 'programa'} onClick={() => guardar({ backupHora: hora, backupConservar: conservar }, 'Programación guardada', 'programa')}>Guardar</button>
        <button className="primario" disabled={ocupado === 'backup'} onClick={ahora}>{ocupado === 'backup' ? 'Respaldando…' : 'Backup ahora'}</button>
      </div>
      <ul className="historial">
        {lista.length === 0 && <li className="tenue">Aún no hay backups. El primero se hace a la hora programada, después del primer ingreso de la empresa.</li>}
        {lista.map((r) => (
          <li key={r.id} className="fila-respaldo">
            <span>
              <span className="tenue">{new Date(r.creadoEl).toLocaleString('es-PE')}</span> {r.motivo}
              {r.ok ? ` · ${tamano(r.bytes)}` : <span className="error"> · falló: {r.error}</span>}
            </span>
            {r.ok && r.disponible && r.nombre && <button className="enlace" onClick={() => descargar(`/respaldos/${r.id}/descargar`, r.nombre!)}>Descargar</button>}
            {r.ok && !r.disponible && <span className="tenue">borrado</span>}
          </li>
        ))}
      </ul>
    </>
  );
}
