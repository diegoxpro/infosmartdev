import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  api, Clave, Empresa, Estado, fecha, guardarSesion, NOMBRE_PRODUCTO, Plan, Producto, Resumen, sesion,
} from './api';

export function App() {
  const [s, setS] = useState(sesion());
  if (!s) return <Ingreso alEntrar={(x) => { guardarSesion(x); setS(x); }} />;
  return <Panel nombre={s.nombre} salir={() => { guardarSesion(null); setS(null); }} />;
}

function Ingreso({ alEntrar }: { alEntrar: (s: { token: string; nombre: string }) => void }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true); setError('');
    try {
      const r = await api<{ token: string; nombre: string }>('/auth/ingresar', { metodo: 'POST', cuerpo: { usuario, clave } });
      alEntrar(r);
    } catch (err) { setError((err as Error).message); } finally { setEnviando(false); }
  }

  return (
    <div className="ingreso">
      <form className="tarjeta" onSubmit={enviar}>
        <Marca />
        <p className="tenue">Panel de administración</p>
        <label>Usuario<input value={usuario} onChange={(e) => setUsuario(e.target.value)} autoFocus autoComplete="username" /></label>
        <label>Clave<input type="password" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="current-password" /></label>
        {error && <p className="error">{error}</p>}
        <button className="primario" disabled={enviando || !usuario || !clave}>{enviando ? 'Ingresando…' : 'Ingresar'}</button>
      </form>
    </div>
  );
}

function Marca() {
  return <div className="marca"><span className="logo">i</span>Infosmart</div>;
}

function Panel({ nombre, salir }: { nombre: string; salir: () => void }) {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [buscar, setBuscar] = useState('');
  const [creando, setCreando] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [claves, setClaves] = useState<{ empresa: string; url: string; claves: Clave[] } | null>(null);

  const cargar = useCallback(async () => {
    const q = buscar.trim() ? `?buscar=${encodeURIComponent(buscar.trim())}` : '';
    const [e, r] = await Promise.all([api<Empresa[]>(`/empresas${q}`), api<Resumen>('/resumen')]);
    setEmpresas(e); setResumen(r);
  }, [buscar]);

  useEffect(() => { api<Plan[]>('/planes').then(setPlanes); }, []);
  useEffect(() => { const t = setTimeout(cargar, 250); return () => clearTimeout(t); }, [cargar]);

  return (
    <div className="app">
      <header className="barra">
        <Marca />
        <div className="barra-der"><span className="tenue">{nombre}</span><button className="enlace" onClick={salir}>Salir</button></div>
      </header>
      <main>
        {resumen && (
          <section className="cifras">
            <Cifra n={resumen.activas} t="Activas" />
            <Cifra n={resumen.prueba} t="En prueba" />
            <Cifra n={resumen.porVencer} t="Vencen en 7 días" tono="aviso" />
            <Cifra n={resumen.vencidas} t="Vencidas" tono="peligro" />
            <Cifra n={resumen.suspendidas} t="Suspendidas" />
          </section>
        )}
        <div className="acciones">
          <input className="buscar" placeholder="Buscar por nombre, RUC o subdominio" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          <button className="primario" onClick={() => setCreando(true)}>Nueva empresa</button>
        </div>
        <div className="tabla-envoltura">
          <table>
            <thead><tr><th>Empresa</th><th>Subdominio</th><th>Productos</th><th>Plan</th><th>Vence</th><th>Estado</th></tr></thead>
            <tbody>
              {empresas.map((e) => (
                <tr key={e.id} onClick={() => setAbierta(e.id)}>
                  <td><strong>{e.razonSocial}</strong><div className="tenue">RUC {e.ruc}</div></td>
                  <td className="mono">{e.url}</td>
                  <td>{e.productos.map((p) => <span key={p.id} className="etiqueta">{NOMBRE_PRODUCTO[p.producto]}</span>)}</td>
                  <td>{e.plan.nombre}</td>
                  <td>{fecha(e.venceEl)}</td>
                  <td><EstadoChip e={e} /></td>
                </tr>
              ))}
              {empresas.length === 0 && <tr><td colSpan={6} className="vacio">{buscar ? 'Sin resultados' : 'Aún no hay empresas. Crea la primera con «Nueva empresa».'}</td></tr>}
            </tbody>
          </table>
        </div>
      </main>

      {creando && (
        <NuevaEmpresa planes={planes} dominio={resumen?.dominioBase ?? 'infosmart.pe'} cerrar={() => setCreando(false)} creada={(r) => {
          setCreando(false); setClaves({ empresa: r.empresa.razonSocial, url: r.empresa.url, claves: r.claves }); cargar();
        }} />
      )}
      {abierta !== null && (
        <Detalle id={abierta} planes={planes} cerrar={() => setAbierta(null)} cambio={cargar}
          mostrarClaves={(c, e) => setClaves({ empresa: e.razonSocial, url: e.url, claves: c })} />
      )}
      {claves && <VerClaves {...claves} cerrar={() => setClaves(null)} />}
    </div>
  );
}

function Cifra({ n, t, tono }: { n: number; t: string; tono?: 'aviso' | 'peligro' }) {
  return <div className={`cifra ${n > 0 && tono ? tono : ''}`}><span>{n}</span>{t}</div>;
}

function EstadoChip({ e }: { e: Empresa }) {
  if (e.estado === 'SUSPENDIDA') return <span className="chip peligro">Suspendida</span>;
  if (e.acceso.motivo === 'VENCIDA') return <span className="chip aviso">Vencida</span>;
  if (e.estado === 'PRUEBA') return <span className="chip info">Prueba</span>;
  return <span className="chip ok">Activa</span>;
}

function Modal({ titulo, cerrar, children }: { titulo: string; cerrar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const f = (ev: KeyboardEvent) => ev.key === 'Escape' && cerrar();
    addEventListener('keydown', f); return () => removeEventListener('keydown', f);
  }, [cerrar]);
  return (
    <div className="fondo" onMouseDown={(e) => e.target === e.currentTarget && cerrar()}>
      <div className="modal" role="dialog" aria-label={titulo}>
        <div className="modal-cab"><h2>{titulo}</h2><button className="enlace" onClick={cerrar} aria-label="Cerrar">✕</button></div>
        {children}
      </div>
    </div>
  );
}

function NuevaEmpresa({ planes, dominio, cerrar, creada }: {
  planes: Plan[]; dominio: string; cerrar: () => void; creada: (r: { empresa: Empresa; claves: Clave[] }) => void;
}) {
  const [f, setF] = useState({
    razonSocial: '', ruc: '', subdominio: '', plan: planes[0]?.codigo ?? 'basico',
    adminUsuario: 'admin', contacto: '', telefono: '', correo: '', notas: '',
  });
  const [productos, setProductos] = useState<Producto[]>(['VENTAS']);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });
  const alternar = (p: Producto) => setProductos(productos.includes(p) ? productos.filter((x) => x !== p) : [...productos, p]);

  async function enviar(e: FormEvent) {
    e.preventDefault(); setEnviando(true); setError('');
    const cuerpo: Record<string, unknown> = { ...f, productos };
    for (const k of ['contacto', 'telefono', 'correo', 'notas']) if (!cuerpo[k]) delete cuerpo[k];
    try { creada(await api('/empresas', { metodo: 'POST', cuerpo })); }
    catch (err) { setError((err as Error).message); } finally { setEnviando(false); }
  }

  return (
    <Modal titulo="Nueva empresa" cerrar={cerrar}>
      <form onSubmit={enviar} className="formulario">
        <label className="ancho">Razón social<input {...campo('razonSocial')} required autoFocus /></label>
        <label>RUC<input {...campo('ruc')} inputMode="numeric" maxLength={11} required /></label>
        <label>Subdominio
          <div className="sufijo"><input {...campo('subdominio')} onChange={(e) => setF({ ...f, subdominio: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} required /><span>.{dominio}</span></div>
        </label>
        <fieldset className="ancho"><legend>Productos</legend>
          {(['VENTAS', 'LAVADERO'] as Producto[]).map((p) => (
            <label key={p} className="check"><input type="checkbox" checked={productos.includes(p)} onChange={() => alternar(p)} />{NOMBRE_PRODUCTO[p]}</label>
          ))}
        </fieldset>
        <label>Plan<select {...campo('plan')}>{planes.map((p) => <option key={p.codigo} value={p.codigo}>{p.nombre} · S/ {p.precioMensual}/mes</option>)}</select></label>
        <label>Usuario administrador<input {...campo('adminUsuario')} required /></label>
        <label>Contacto<input {...campo('contacto')} /></label>
        <label>Teléfono<input {...campo('telefono')} inputMode="tel" /></label>
        <label className="ancho">Correo<input type="email" {...campo('correo')} /></label>
        <label className="ancho">Notas<textarea rows={2} {...campo('notas')} /></label>
        {error && <p className="error ancho">{error}</p>}
        <div className="pie ancho">
          <span className="tenue">Empieza en prueba. Se crea una base de datos por producto.</span>
          <button className="primario" disabled={enviando || productos.length === 0}>{enviando ? 'Creando…' : 'Crear empresa'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Detalle({ id, planes, cerrar, cambio, mostrarClaves }: {
  id: number; planes: Plan[]; cerrar: () => void; cambio: () => void; mostrarClaves: (c: Clave[], e: Empresa) => void;
}) {
  const [e, setE] = useState<Empresa | null>(null);
  const [error, setError] = useState('');
  const [meses, setMeses] = useState(1);

  const cargar = useCallback(() => api<Empresa>(`/empresas/${id}`).then(setE), [id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function hacer(fn: () => Promise<unknown>) {
    setError('');
    try { await fn(); await cargar(); cambio(); } catch (err) { setError((err as Error).message); }
  }
  const estado = (estado: Estado) => {
    if (estado === 'SUSPENDIDA' && !confirm(`¿Suspender a ${e!.razonSocial}? Sus usuarios no podrán entrar hasta que la reactives.`)) return;
    hacer(() => api(`/empresas/${id}/estado`, { metodo: 'POST', cuerpo: { estado } }));
  };
  const restablecer = (p: Producto) => {
    if (!confirm(`¿Generar una nueva clave temporal para el administrador de ${NOMBRE_PRODUCTO[p]}?`)) return;
    hacer(async () => mostrarClaves([await api<Clave>(`/empresas/${id}/productos/${p}/restablecer-clave`, { metodo: 'POST' })], e!));
  };
  const agregar = (p: Producto) => hacer(async () => {
    const r = await api<{ empresa: Empresa; claves: Clave[] }>(`/empresas/${id}/productos`, { metodo: 'POST', cuerpo: { producto: p, adminUsuario: e!.productos[0]?.adminUsuario ?? 'admin' } });
    mostrarClaves(r.claves, r.empresa);
  });

  if (!e) return <Modal titulo="Empresa" cerrar={cerrar}><p className="tenue">Cargando…</p></Modal>;
  const faltan = (['VENTAS', 'LAVADERO'] as Producto[]).filter((p) => !e.productos.some((x) => x.producto === p));

  return (
    <Modal titulo={e.razonSocial} cerrar={cerrar}>
      <div className="detalle">
        <div className="fila-datos">
          <div><span className="tenue">RUC</span>{e.ruc}</div>
          <div><span className="tenue">Dirección</span><span className="mono">{e.url}</span></div>
          <div><span className="tenue">Estado</span><EstadoChip e={e} /></div>
          <div><span className="tenue">Vence</span>{fecha(e.venceEl)}</div>
        </div>
        {(e.contacto || e.telefono || e.correo) && <p className="tenue">{[e.contacto, e.telefono, e.correo].filter(Boolean).join(' · ')}</p>}

        <h3>Suscripción</h3>
        <div className="botonera">
          <select value={e.plan.codigo} onChange={(ev) => hacer(() => api(`/empresas/${id}`, { metodo: 'PATCH', cuerpo: { plan: ev.target.value } }))}>
            {planes.map((p) => <option key={p.codigo} value={p.codigo}>Plan {p.nombre}</option>)}
          </select>
          <select value={meses} onChange={(ev) => setMeses(Number(ev.target.value))}>
            {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m} {m === 1 ? 'mes' : 'meses'}</option>)}
          </select>
          <button onClick={() => hacer(() => api(`/empresas/${id}/renovar`, { metodo: 'POST', cuerpo: { meses } }))}>Renovar</button>
          {e.estado !== 'ACTIVA' && <button className="primario" onClick={() => estado('ACTIVA')}>Activar</button>}
          {e.estado !== 'SUSPENDIDA' && <button className="peligro" onClick={() => estado('SUSPENDIDA')}>Suspender</button>}
        </div>

        <h3>Productos</h3>
        {e.productos.map((p) => (
          <div key={p.id} className="producto">
            <div>
              <strong>{NOMBRE_PRODUCTO[p.producto]}</strong>
              <div className="tenue">Admin <span className="mono">{p.adminUsuario}</span> · BD <span className="mono">{p.baseDatos}</span></div>
              <div className="tenue">{p.aprovisionado ? 'Listo para usar' : 'Se prepara en el primer ingreso'}{p.adminClaveTemporal ? ' · clave temporal sin cambiar' : ''}</div>
            </div>
            <button onClick={() => restablecer(p.producto)}>Nueva clave</button>
          </div>
        ))}
        {faltan.map((p) => <button key={p} className="enlace" onClick={() => agregar(p)}>+ Agregar {NOMBRE_PRODUCTO[p]}</button>)}

        {error && <p className="error">{error}</p>}

        <h3>Historial</h3>
        <ul className="historial">
          {e.eventos?.map((ev) => (
            <li key={ev.id}><span className="tenue">{new Date(ev.creadoEl).toLocaleString('es-PE')}</span> {ev.tipo.replace(/_/g, ' ').toLowerCase()}{ev.detalle ? `: ${ev.detalle}` : ''}{ev.usuario ? ` (${ev.usuario})` : ''}</li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

function VerClaves({ empresa, url, claves, cerrar }: { empresa: string; url: string; claves: Clave[]; cerrar: () => void }) {
  const texto = [`Accesos de ${empresa}`, `Dirección: https://${url}`, ...claves.map((c) => `${NOMBRE_PRODUCTO[c.producto]}: usuario ${c.usuario}, clave temporal ${c.clave}`), 'Cambia la clave en tu primer ingreso.'].join('\n');
  const [copiado, setCopiado] = useState(false);
  return (
    <Modal titulo="Claves del administrador" cerrar={cerrar}>
      <p className="aviso-caja">Copia estas claves ahora: no se vuelven a mostrar. Si se pierden, genera una nueva desde la empresa.</p>
      <pre className="claves">{texto}</pre>
      <div className="pie">
        <span />
        <button className="primario" onClick={async () => { try { await navigator.clipboard.writeText(texto); setCopiado(true); } catch { /* sin portapapeles */ } }}>{copiado ? 'Copiado' : 'Copiar'}</button>
      </div>
    </Modal>
  );
}
