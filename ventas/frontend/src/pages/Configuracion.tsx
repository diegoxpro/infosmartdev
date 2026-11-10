import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Campo, useCarga, useToast } from '../components/ui';
import ImportarProductos from './ImportarProductos';
import { Roles, Usuarios } from './UsuariosRoles';
import { fecha, fechaHora, n, precioSugerido } from '../format';
import { Marca, prepararImagen, TipoImagen, urlImagen, useMarca } from '../marca';
import { ClavePermiso, Configuracion as Config, EstadoBackup, EstadoSunatGeneral, Serie, SUNAT_LABEL } from '../types';

type Pestana = 'preferencias' | 'imagenes' | 'importar' | 'series' | 'usuarios' | 'roles' | 'sunat' | 'backup' | 'red' | 'cuenta';

const PESTANAS: { id: Pestana; titulo: string; permiso?: ClavePermiso }[] = [
  { id: 'preferencias', titulo: 'Preferencias', permiso: 'config.preferencias' },
  { id: 'imagenes', titulo: 'Logotipos', permiso: 'config.preferencias' },
  { id: 'importar', titulo: 'Importar productos', permiso: 'productos.importar' },
  { id: 'series', titulo: 'Comprobantes', permiso: 'config.series' },
  { id: 'usuarios', titulo: 'Usuarios', permiso: 'config.usuarios' },
  { id: 'roles', titulo: 'Roles', permiso: 'config.usuarios' },
  { id: 'sunat', titulo: 'SUNAT', permiso: 'config.sunat' },
  { id: 'backup', titulo: 'Backup', permiso: 'config.backup' },
  { id: 'red', titulo: 'Red local', permiso: 'config.red' },
  { id: 'cuenta', titulo: 'Mi contraseña' },
];

/** ¿Tiene alguna pestaña de configuración además de su contraseña? */
export const veConfiguracion = (puede: (p: ClavePermiso) => boolean) => PESTANAS.some((p) => p.permiso && puede(p.permiso));

/** En la nube los backups y la red local los maneja Infosmart. */
const SOLO_TIENDA: Pestana[] = ['backup', 'red'];

export default function Configuracion() {
  const { puede } = useAuth();
  const { data: cfg } = useCarga(() => api<Config>('/configuracion'), []);
  const visibles = PESTANAS.filter((p) => (!p.permiso || puede(p.permiso)) && !(cfg?.nube && SOLO_TIENDA.includes(p.id)));
  const [elegida, setTab] = useState<Pestana>(visibles[0].id);
  // Si pierde el permiso de la pestaña abierta, pasa a la primera que le quede.
  const tab = visibles.some((p) => p.id === elegida) ? elegida : visibles[0].id;
  const completa = visibles.length > 1;
  return (
    <div className="stack">
      <div className="page-head"><div><h1>{completa ? 'Configuración' : 'Mi cuenta'}</h1></div></div>
      {completa && (
        <div className="tabs">
          {visibles.map((p) => (
            <button key={p.id} className={tab === p.id ? 'active' : ''} onClick={() => setTab(p.id)}>{p.titulo}</button>
          ))}
        </div>
      )}
      {tab === 'preferencias' && <Preferencias />}
      {tab === 'imagenes' && <Imagenes />}
      {tab === 'importar' && <ImportarProductos />}
      {tab === 'series' && <Series />}
      {tab === 'usuarios' && <Usuarios />}
      {tab === 'roles' && <Roles />}
      {tab === 'sunat' && <Sunat />}
      {tab === 'backup' && <Backups />}
      {tab === 'red' && <RedLocal />}
      {tab === 'cuenta' && <MiCuenta />}
    </div>
  );
}

function Preferencias() {
  const avisar = useToast();
  const { data } = useCarga(() => api<Config>('/configuracion'), []);
  const [f, setF] = useState<Record<string, string | boolean>>({});
  useEffect(() => {
    if (data)
      setF({
        empresaNombre: data.empresaNombre,
        empresaRuc: data.empresaRuc ?? '',
        empresaDireccion: data.empresaDireccion ?? '',
        permitirVentaSinStock: data.permitirVentaSinStock,
        margen1: String(n(data.margen1)),
        margen2: String(n(data.margen2)),
        margen3: String(n(data.margen3)),
        redondeoPrecio: String(n(data.redondeoPrecio)),
        diasAvisoVencimiento: String(data.diasAvisoVencimiento),
        montoInicialCaja: String(n(data.montoInicialCaja)),
        mensajeTicket: data.mensajeTicket ?? '',
      });
  }, [data]);
  if (!data || !('margen1' in f)) return null;
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const guardar = async () => {
    try {
      await api('/configuracion', {
        method: 'PATCH',
        body: {
          empresaNombre: f.empresaNombre,
          empresaRuc: f.empresaRuc || undefined,
          empresaDireccion: f.empresaDireccion || undefined,
          permitirVentaSinStock: f.permitirVentaSinStock,
          margen1: n(f.margen1),
          margen2: n(f.margen2),
          margen3: n(f.margen3),
          redondeoPrecio: n(f.redondeoPrecio),
          diasAvisoVencimiento: Math.round(n(f.diasAvisoVencimiento)),
          montoInicialCaja: n(f.montoInicialCaja),
          mensajeTicket: String(f.mensajeTicket),
        },
      });
      avisar('Preferencias guardadas');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  const ejemplo = (m: string | boolean) => precioSugerido(10, n(m), n(f.redondeoPrecio)).toFixed(2);
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <div className="card card-pad stack">
        <h2>Datos de la tienda</h2>
        <div className="grid-2">
          <Campo label="Nombre"><input value={String(f.empresaNombre)} onChange={(e) => set('empresaNombre', e.target.value)} /></Campo>
          <Campo label="RUC"><input className="mono" value={String(f.empresaRuc)} onChange={(e) => set('empresaRuc', e.target.value.replace(/\D/g, ''))} maxLength={11} /></Campo>
          <Campo label="Dirección" className="span-2"><input value={String(f.empresaDireccion)} onChange={(e) => set('empresaDireccion', e.target.value)} /></Campo>
        </div>
      </div>
      <div className="card card-pad stack">
        <div>
          <h2>Márgenes de ganancia</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Se usan para sugerir precios al registrar compras. Cada producto puede tener su propio margen.
          </p>
        </div>
        <div className="grid-4">
          {[1, 2, 3].map((i) => (
            <Campo key={i} label={`Precio ${i} (%)`} ayuda={`Costo S/ 10 → S/ ${ejemplo(f[`margen${i}`])}`}>
              <input className="num" type="number" min="0" step="any" value={String(f[`margen${i}`])} onChange={(e) => set(`margen${i}`, e.target.value)} />
            </Campo>
          ))}
          <Campo label="Redondear a" ayuda="Hacia arriba">
            <select value={String(f.redondeoPrecio)} onChange={(e) => set('redondeoPrecio', e.target.value)}>
              <option value="0">Sin redondeo</option>
              <option value="0.1">S/ 0.10</option>
              <option value="0.5">S/ 0.50</option>
              <option value="1">S/ 1.00</option>
            </select>
          </Campo>
        </div>
      </div>
      <div className="card card-pad stack">
        <h2>Stock y vencimientos</h2>
        <label className="check">
          <input type="checkbox" checked={Boolean(f.permitirVentaSinStock)} onChange={(e) => set('permitirVentaSinStock', e.target.checked)} />
          Permitir vender productos sin stock (el stock queda en negativo)
        </label>
        <Campo label="Avisar vencimientos con anticipación de (días)" className="" ayuda="Aparecen en Inicio como “por vencer”">
          <input className="num" style={{ width: 120 }} type="number" min="0" value={String(f.diasAvisoVencimiento)} onChange={(e) => set('diasAvisoVencimiento', e.target.value)} />
        </Campo>
      </div>
      <div className="card card-pad stack">
        <h2>Caja y ticket</h2>
        <div className="grid-2">
          <Campo label="Monto inicial de caja" ayuda="Se propone al abrir la caja">
            <input className="num" type="number" min="0" step="0.1" value={String(f.montoInicialCaja)} onChange={(e) => set('montoInicialCaja', e.target.value)} />
          </Campo>
          <Campo label="Mensaje al pie del ticket">
            <input value={String(f.mensajeTicket)} onChange={(e) => set('mensajeTicket', e.target.value)} />
          </Campo>
        </div>
      </div>
      <div><button className="btn btn-primary" onClick={guardar}>Guardar preferencias</button></div>
      {data.nube ? <AdministradoPorInfosmart consulta={!!data.consultaDocConfigurada} /> : <ConsultaDocumentos configurada={!!data.consultaDocConfigurada} />}
    </div>
  );
}

/** En la nube la consulta DNI/RUC, los backups y SUNAT se contratan y configuran con Infosmart. */
function AdministradoPorInfosmart({ consulta }: { consulta: boolean }) {
  return (
    <div className="card card-pad stack">
      <h2>Servicios de Infosmart</h2>
      <p className="muted small" style={{ margin: 0 }}>
        La consulta de DNI y RUC, el certificado y la clave SOL para SUNAT y las copias de seguridad diarias de tus datos los administra Infosmart.
        Para cambiarlos, comunícate con Infosmart.
      </p>
      <span className={`badge ${consulta ? 'ok' : ''}`} style={{ alignSelf: 'flex-start' }}>
        {consulta ? 'Consulta DNI y RUC activa' : 'Consulta DNI y RUC sin contratar: solo búsqueda en clientes guardados'}
      </span>
    </div>
  );
}

/** Token de Decolecta para autollenar clientes por DNI/RUC. El servidor nunca lo devuelve. */
function ConsultaDocumentos({ configurada: inicial }: { configurada: boolean }) {
  const avisar = useToast();
  const [configurada, setConfigurada] = useState(inicial);
  const [token, setToken] = useState('');
  const guardar = async (valor: string) => {
    try {
      const r = await api<Config>('/configuracion', { method: 'PATCH', body: { consultaDocToken: valor } });
      setConfigurada(!!r.consultaDocConfigurada);
      setToken('');
      avisar(valor ? 'Token de consulta guardado' : 'Consulta en línea desactivada');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };
  return (
    <div className="card card-pad stack">
      <div>
        <h2>Consulta de DNI y RUC</h2>
        <p className="muted small" style={{ margin: '4px 0 0' }}>
          Con un token de Decolecta (decolecta.com, antes apis.net.pe) la pantalla Clientes llena el nombre y la dirección al buscar un DNI o RUC.
          Necesita internet solo al buscar; sin conexión se escribe a mano. Los clientes guardados se encuentran siempre, aunque no haya internet.
        </p>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Campo label={configurada ? 'Token (ya configurado; escribe otro para cambiarlo)' : 'Token'} className="grow">
          <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={configurada ? '••••••••••••' : 'Pega aquí tu token'} />
        </Campo>
        <button className="btn btn-primary" onClick={() => guardar(token.trim())} disabled={!token.trim()}>Guardar token</button>
        {configurada && <button className="btn" onClick={() => guardar('')}>Quitar</button>}
      </div>
      <span className={`badge ${configurada ? 'ok' : ''}`} style={{ alignSelf: 'flex-start' }}>{configurada ? 'Consulta en línea activa' : 'Sin configurar: solo búsqueda en clientes guardados'}</span>
    </div>
  );
}

const IMAGENES: { tipo: TipoImagen; titulo: string; ayuda: string; fondo?: 'oscuro' | 'ticket' }[] = [
  { tipo: 'LOGO', titulo: 'Logotipo de la tienda', ayuda: 'Se muestra en el menú y en la pantalla de ingreso. Se reduce a 512 px como máximo.', fondo: 'oscuro' },
  { tipo: 'FAVICON', titulo: 'Favicon', ayuda: 'El ícono de la pestaña del navegador. Mejor una imagen cuadrada y simple; se reduce a 64 × 64 px.' },
  {
    tipo: 'LOGO_BOLETA',
    titulo: 'Logo de las boletas',
    ayuda: 'Se imprime arriba del ticket de venta (boleta y nota de venta). Queda en blanco y negro, como lo imprime la ticketera. Un logo con trazos gruesos y buen contraste sale mejor.',
    fondo: 'ticket',
  },
];

function Imagenes() {
  const avisar = useToast();
  const { marca, setMarca } = useMarca();
  const [ocupado, setOcupado] = useState<TipoImagen | null>(null);

  const subir = async (tipo: TipoImagen, archivo: File | undefined) => {
    if (!archivo) return;
    setOcupado(tipo);
    try {
      const base64 = await prepararImagen(archivo, tipo);
      setMarca(await api<Marca>(`/configuracion/imagenes/${tipo}`, { method: 'PUT', body: { archivo: base64 } }));
      avisar('Imagen guardada');
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setOcupado(null);
    }
  };
  const quitar = async (tipo: TipoImagen) => {
    if (!window.confirm('¿Quitar esta imagen?')) return;
    setOcupado(tipo);
    try {
      setMarca(await api<Marca>(`/configuracion/imagenes/${tipo}`, { method: 'DELETE' }));
      avisar('Imagen quitada');
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      {IMAGENES.map(({ tipo, titulo, ayuda, fondo }) => {
        const url = urlImagen(tipo, marca);
        return (
          <div key={tipo} className="card card-pad stack">
            <div>
              <h2>{titulo}</h2>
              <p className="muted small" style={{ margin: '4px 0 0' }}>{ayuda}</p>
            </div>
            <div className="row" style={{ gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className={`vista-imagen ${fondo ?? ''} ${tipo === 'FAVICON' ? 'favicon' : ''}`}>
                {url ? <img src={url} alt={titulo} /> : <span className="muted small">Sin imagen</span>}
              </div>
              <div className="row">
                <label className={`btn ${ocupado ? 'disabled' : ''}`}>
                  {ocupado === tipo ? 'Guardando…' : url ? 'Cambiar imagen' : 'Elegir imagen'}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/x-icon,image/vnd.microsoft.icon,.ico"
                    hidden
                    disabled={!!ocupado}
                    onChange={(e) => {
                      subir(tipo, e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>
                {url && <button className="btn" onClick={() => quitar(tipo)} disabled={!!ocupado}>Quitar</button>}
              </div>
            </div>
          </div>
        );
      })}
      <p className="small muted" style={{ margin: 0 }}>Las imágenes se guardan en la base de datos, así que también entran en los backups.</p>
    </div>
  );
}

const EMISOR = [
  ['empresaRuc', 'RUC', '10715971963'],
  ['empresaRazonSocial', 'Razón social (como figura en SUNAT)', 'DIEGO MARTIN GUEVARA VASQUEZ'],
  ['empresaDireccion', 'Dirección fiscal', 'JR. LOS OLIVOS 130 - URB. LOS JARDINES'],
  ['empresaUbigeo', 'Ubigeo', '220901'],
  ['empresaDepartamento', 'Departamento', 'SAN MARTIN'],
  ['empresaProvincia', 'Provincia', 'SAN MARTIN'],
  ['empresaDistrito', 'Distrito', 'TARAPOTO'],
  ['codigoEstablecimiento', 'Código de establecimiento', '0000'],
] as const;
type CampoEmisor = (typeof EMISOR)[number][0];

function Sunat() {
  const avisar = useToast();
  const { data: cfg } = useCarga(() => api<Config>('/configuracion'), []);
  const { data: estado, setData: setEstado } = useCarga(() => api<EstadoSunatGeneral>('/sunat/estado'), []);
  const [f, setF] = useState<(Record<CampoEmisor, string> & { sunatModo: Config['sunatModo'] }) | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [claveCert, setClaveCert] = useState('');
  const [sol, setSol] = useState({ usuario: '', clave: '' });
  const [ocupado, setOcupado] = useState('');
  useEffect(() => {
    if (cfg)
      setF({
        ...(Object.fromEntries(EMISOR.map(([k]) => [k, (cfg[k] as string | null) ?? ''])) as Record<CampoEmisor, string>),
        sunatModo: cfg.sunatModo,
      });
  }, [cfg]);
  useEffect(() => {
    if (estado?.solUsuario) setSol((s) => ({ ...s, usuario: s.usuario || estado.solUsuario! }));
  }, [estado]);
  if (!f || !estado) return null;
  const nube = !!cfg?.nube;

  const tarea = async (nombre: string, fn: () => Promise<void>) => {
    setOcupado(nombre);
    try {
      await fn();
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setOcupado('');
    }
  };

  const guardar = () =>
    tarea('guardar', async () => {
      const { sunatModo, ...emisor } = f;
      if (!nube && sunatModo === 'PRODUCCION' && !estado.solConfigurado) throw new Error('Para producción primero guarda el usuario SOL secundario');
      if (!nube && sunatModo !== 'DESACTIVADO' && !estado.certificado) throw new Error('Primero carga el certificado digital');
      // En la nube el modo y el RUC los fija Infosmart.
      const datos = Object.fromEntries(Object.entries(emisor).filter(([k]) => !nube || k !== 'empresaRuc').map(([k, v]) => [k, v.trim()]));
      await api('/configuracion', { method: 'PATCH', body: nube ? datos : { ...datos, sunatModo } });
      setEstado(await api<EstadoSunatGeneral>('/sunat/estado'));
      avisar('Datos de SUNAT guardados');
    });

  const subirCertificado = () =>
    tarea('cert', async () => {
      if (!archivo) throw new Error('Elige el archivo .pfx');
      const base64 = await new Promise<string>((ok, mal) => {
        const lector = new FileReader();
        lector.onload = () => ok(String(lector.result).split(',')[1]);
        lector.onerror = () => mal(new Error('No se pudo leer el archivo'));
        lector.readAsDataURL(archivo);
      });
      setEstado(await api<EstadoSunatGeneral>('/sunat/certificado', { body: { archivo: base64, clave: claveCert } }));
      setArchivo(null);
      setClaveCert('');
      avisar('Certificado cargado');
    });

  const guardarSol = () =>
    tarea('sol', async () => {
      setEstado(await api<EstadoSunatGeneral>('/sunat/sol', { body: { usuario: sol.usuario.trim().toUpperCase(), clave: sol.clave } }));
      setSol((s) => ({ ...s, clave: '' }));
      avisar('Usuario SOL guardado');
    });

  const probar = () =>
    tarea('beta', async () => {
      const r = await api<{ codigo: string; descripcion: string; observaciones: string[] }>('/sunat/probar-beta', { method: 'POST' });
      const ok = r.codigo === '0';
      avisar(ok ? `SUNAT beta aceptó la boleta de prueba: ${r.descripcion}` : `SUNAT beta respondió ${r.codigo}: ${r.descripcion}`, !ok);
    });

  const dias = estado.certificado ? Math.floor((new Date(estado.certificado.venceEl).getTime() - Date.now()) / 86_400_000) : 0;
  const conteo = Object.entries(estado.conteo).filter(([k, v]) => k !== 'NO_APLICA' && v);
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      {estado.atrasadas > 0 && (
        <div className="alert danger">
          Hay {estado.atrasadas} boletas con más de 2 días sin aceptar en SUNAT. Revísalas en Ventas: el plazo para enviarlas es corto.
        </div>
      )}
      <div className="card card-pad stack">
        <div>
          <h2>Envío de boletas</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Las boletas B001 se firman con tu certificado y se envían a SUNAT apenas se emiten. Sin internet quedan "por enviar" y se reintenta solo cada
            2 minutos. Las boletas libres (L001) nunca se envían.
          </p>
        </div>
        {nube ? (
          <div className="alert info">
            Modo: <b>{f.sunatModo === 'PRODUCCION' ? 'Producción (boletas reales)' : f.sunatModo === 'BETA' ? 'Pruebas (SUNAT beta, sin validez)' : 'Desactivado'}</b>.
            {' '}El modo, el certificado digital y el usuario SOL los administra Infosmart.
          </div>
        ) : (
        <Campo label="Modo">
          <select value={f.sunatModo} onChange={(e) => setF({ ...f, sunatModo: e.target.value as Config['sunatModo'] })} style={{ maxWidth: 360 }}>
            <option value="DESACTIVADO">Desactivado (no se envía nada)</option>
            <option value="BETA">Pruebas (SUNAT beta, sin validez)</option>
            <option value="PRODUCCION">Producción (boletas reales)</option>
          </select>
        </Campo>
        )}
        {conteo.length > 0 && (
          <div className="row small" style={{ gap: 8 }}>
            {conteo.map(([k, v]) => (
              <span key={k} className={`badge ${SUNAT_LABEL[k as keyof typeof SUNAT_LABEL].clase}`}>
                {SUNAT_LABEL[k as keyof typeof SUNAT_LABEL].texto}: {v}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="card card-pad stack">
        <h2>Datos del emisor</h2>
        <div className="grid-2">
          {EMISOR.map(([k, label, ejemplo]) => (
            <Campo key={k} label={label} className={k === 'empresaRazonSocial' || k === 'empresaDireccion' ? 'span-2' : ''}>
              <input
                className={k === 'empresaRuc' || k === 'empresaUbigeo' || k === 'codigoEstablecimiento' ? 'mono' : ''}
                value={f[k]}
                disabled={nube && k === 'empresaRuc'}
                placeholder={ejemplo}
                maxLength={k === 'empresaRuc' ? 11 : k === 'empresaUbigeo' ? 6 : k === 'codigoEstablecimiento' ? 4 : undefined}
                onChange={(e) => setF({ ...f, [k]: e.target.value })}
              />
            </Campo>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          El nombre comercial del ticket se toma de Preferencias. El código de establecimiento es 0000 si solo tienes el domicilio fiscal.
        </p>
        <div><button className="btn btn-primary" onClick={guardar} disabled={!!ocupado}>Guardar</button></div>
      </div>
      <div className="card card-pad stack">
        <div>
          <h2>Certificado digital</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            {nube ? (
              'Infosmart guarda tu certificado cifrado y lo renueva contigo cuando se acerca su vencimiento.'
            ) : (
              <>
                Se guarda solo en esta PC, en la carpeta <span className="mono">backend/secretos</span>. No va a la base de datos ni a los backups: guarda tu
                .pfx original en un lugar seguro.
              </>
            )}
          </p>
        </div>
        {estado.certificado ? (
          <div className={`alert ${dias < 30 ? 'warn' : 'info'}`}>
            <div>
              <b>{estado.certificado.sujeto}</b>
              <div className="small">
                Emitido por {estado.certificado.emisor} · vence el {fecha(estado.certificado.venceEl)}
                {dias < 30 && ` (en ${Math.max(dias, 0)} días, renuévalo)`}
              </div>
            </div>
          </div>
        ) : (
          <div className="alert warn">{estado.errorCertificado ?? 'Aún no hay certificado cargado.'}</div>
        )}
        {!nube && (
        <div className="grid-2">
          <Campo label="Archivo .pfx o .p12">
            <input type="file" accept=".pfx,.p12" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          </Campo>
          <Campo label="Contraseña del certificado">
            <input type="password" autoComplete="off" value={claveCert} onChange={(e) => setClaveCert(e.target.value)} />
          </Campo>
        </div>
        )}
        <div className="row">
          {!nube && <button className="btn" onClick={subirCertificado} disabled={!!ocupado || !archivo}>{ocupado === 'cert' ? 'Cargando…' : 'Cargar certificado'}</button>}
          <button className="btn" onClick={probar} disabled={!!ocupado || !estado.certificado}>{ocupado === 'beta' ? 'Probando…' : 'Probar con SUNAT beta'}</button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          La prueba firma una boleta de S/ 1.00 y la envía al entorno beta de SUNAT (no tiene validez). Necesita internet y el RUC guardado arriba.
        </p>
      </div>
      {!nube && (
      <div className="card card-pad stack">
        <div>
          <h2>Usuario SOL secundario</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Solo para producción. Créalo en SUNAT Operaciones en Línea con el perfil de envío de comprobantes electrónicos. No uses tu usuario principal.
          </p>
        </div>
        <div className="grid-2">
          <Campo label="Usuario" ayuda="Sin el RUC; el sistema lo antepone">
            <input className="mono" value={sol.usuario} onChange={(e) => setSol({ ...sol, usuario: e.target.value })} autoComplete="off" />
          </Campo>
          <Campo label="Clave SOL" ayuda={estado.solConfigurado ? 'Ya hay una clave guardada; escribe otra solo para cambiarla' : undefined}>
            <input type="password" value={sol.clave} onChange={(e) => setSol({ ...sol, clave: e.target.value })} autoComplete="new-password" />
          </Campo>
        </div>
        <div><button className="btn" onClick={guardarSol} disabled={!!ocupado || !sol.usuario.trim()}>Guardar usuario SOL</button></div>
      </div>
      )}
    </div>
  );
}

function Backups() {
  const avisar = useToast();
  const { data: cfg } = useCarga(() => api<Config>('/configuracion'), []);
  const { data: estado, setData: setEstado } = useCarga(() => api<EstadoBackup>('/backups'), []);
  const [f, setF] = useState<{ backupCarpeta: string; backupHora: string; backupConservar: string; pgDumpRuta: string } | null>(null);
  const [haciendo, setHaciendo] = useState(false);
  useEffect(() => {
    if (cfg)
      setF({
        backupCarpeta: cfg.backupCarpeta ?? '',
        backupHora: cfg.backupHora,
        backupConservar: String(cfg.backupConservar),
        pgDumpRuta: cfg.pgDumpRuta ?? '',
      });
  }, [cfg]);
  if (!f || !estado) return null;

  const guardar = async () => {
    try {
      await api('/configuracion', {
        method: 'PATCH',
        body: { backupCarpeta: f.backupCarpeta.trim(), backupHora: f.backupHora, backupConservar: Math.round(n(f.backupConservar)), pgDumpRuta: f.pgDumpRuta.trim() },
      });
      setEstado(await api<EstadoBackup>('/backups'));
      avisar('Configuración de backup guardada');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  const ahora = async () => {
    setHaciendo(true);
    try {
      const r = await api<EstadoBackup>('/backups', { body: {} });
      setEstado(r);
      const ultimo = r.historial[0];
      if (ultimo?.ok) avisar('Backup listo');
      else avisar(`El backup falló: ${ultimo?.error ?? 'error desconocido'}`, true);
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setHaciendo(false);
    }
  };

  const mb = (b: number | null) => (b == null ? '' : `${(b / 1024 / 1024).toFixed(2)} MB`);
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      {estado.atrasado ? (
        <div className="alert warn">No hay un backup correcto en las últimas 48 horas. Revisa la carpeta y presiona "Hacer backup ahora".</div>
      ) : (
        <div className="alert info">Último backup correcto: {fechaHora(estado.ultimoOk?.fecha)} ({estado.ultimoOk?.origen}).</div>
      )}
      <div className="card card-pad stack">
        <div>
          <h2>Copia en Google Drive</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Instala <b>Google Drive para escritorio</b> en la PC e indica aquí una carpeta dentro de tu unidad, por ejemplo{' '}
            <span className="mono">G:\Mi unidad\Backups Candys</span>. El sistema guarda ahí la copia y Drive la sube a la nube cuando hay internet.
          </p>
        </div>
        <div className="grid-2">
          <Campo label="Carpeta de Google Drive" className="span-2" ayuda={`Siempre se guarda además una copia local en ${estado.carpetaLocal}`}>
            <input className="mono" value={f.backupCarpeta} onChange={(e) => setF({ ...f, backupCarpeta: e.target.value })} placeholder="G:\Mi unidad\Backups Candys" />
          </Campo>
          <Campo label="Hora del backup diario" ayuda="Si la PC está apagada a esa hora, se hace al encenderla">
            <input type="time" value={f.backupHora} onChange={(e) => setF({ ...f, backupHora: e.target.value })} />
          </Campo>
          <Campo label="Conservar los últimos" ayuda="Backups; los más antiguos se borran">
            <input className="num" type="number" min="1" max="365" value={f.backupConservar} onChange={(e) => setF({ ...f, backupConservar: e.target.value })} />
          </Campo>
          <Campo label="Ruta de pg_dump (opcional)" className="span-2" ayuda="Déjala vacía si pg_dump está en el PATH">
            <input className="mono" value={f.pgDumpRuta} onChange={(e) => setF({ ...f, pgDumpRuta: e.target.value })} placeholder="C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" />
          </Campo>
        </div>
        <div className="row">
          <button className="btn btn-primary" onClick={guardar}>Guardar</button>
          <button className="btn" onClick={ahora} disabled={haciendo}>{haciendo ? 'Haciendo backup…' : 'Hacer backup ahora'}</button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>También se hace un backup automático cada vez que se cierra la caja.</p>
      </div>
      <div className="card">
        <div className="card-head"><h2>Últimos backups</h2></div>
        <table>
          <thead><tr><th>Fecha</th><th>Origen</th><th>Resultado</th><th className="num">Tamaño</th></tr></thead>
          <tbody>
            {estado.historial.map((b) => (
              <tr key={b.id}>
                <td className="small">{fechaHora(b.fecha)}</td>
                <td>{b.origen}</td>
                <td>{b.ok ? <span className="badge ok">Correcto</span> : <span className="badge danger" title={b.error ?? ''}>Falló</span>}{!b.ok && <div className="small muted">{b.error}</div>}</td>
                <td className="num small">{mb(b.tamano)}</td>
              </tr>
            ))}
            {!estado.historial.length && <tr><td colSpan={4} className="muted">Aún no hay backups.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Series() {
  const avisar = useToast();
  const { data, recargar } = useCarga(() => api<Serie[]>('/series'), []);
  const cambiar = async (s: Serie) => {
    const v = window.prompt(`Último número emitido en ${s.serie}. La próxima venta usará el siguiente.`, String(s.ultimoNumero));
    if (v === null || !/^\d+$/.test(v.trim())) return;
    try {
      await api(`/series/${s.id}`, { method: 'PATCH', body: { ultimoNumero: Number(v) } });
      avisar('Numeración actualizada');
      recargar();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };
  return (
    <div className="card" style={{ maxWidth: 820 }}>
      <div className="card-head">
        <h2>Series de comprobantes</h2>
        <span className="small muted">Continúa la numeración que traías de SysVent</span>
      </div>
      <table>
        <thead><tr><th>Serie</th><th>Comprobante</th><th className="num">Último emitido</th><th className="num">Siguiente</th><th /></tr></thead>
        <tbody>
          {data?.map((s) => (
            <tr key={s.id}>
              <td className="mono"><b>{s.serie}</b></td>
              <td>{s.tipo === 'BOLETA' ? 'Boleta de venta' : 'Boleta libre (no va a SUNAT, se imprime como nota de venta)'}</td>
              <td className="num mono">{String(s.ultimoNumero).padStart(8, '0')}</td>
              <td className="num mono">{String(s.ultimoNumero + 1).padStart(8, '0')}</td>
              <td className="actions"><button className="btn btn-sm" onClick={() => cambiar(s)}>Cambiar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiCuenta() {
  const avisar = useToast();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const cambiar = async () => {
    try {
      await api('/auth/cambiar-password', { body: { actual, nueva } });
      avisar('Contraseña cambiada');
      setActual(''); setNueva(''); setRepetir('');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };
  return (
    <div className="card card-pad stack" style={{ maxWidth: 420 }}>
      <h2>Cambiar contraseña</h2>
      <Campo label="Contraseña actual"><input type="password" value={actual} onChange={(e) => setActual(e.target.value)} autoComplete="current-password" /></Campo>
      <Campo label="Nueva contraseña" ayuda="Mínimo 6 caracteres"><input type="password" value={nueva} onChange={(e) => setNueva(e.target.value)} autoComplete="new-password" /></Campo>
      <Campo label="Repite la nueva"><input type="password" value={repetir} onChange={(e) => setRepetir(e.target.value)} autoComplete="new-password" /></Campo>
      <div><button className="btn btn-primary" onClick={cambiar} disabled={!actual || nueva.length < 6 || nueva !== repetir}>Cambiar</button></div>
    </div>
  );
}

interface InfoRed {
  ip: string;
  origen: 'configuracion' | 'env' | 'auto';
  detectadas: string[];
  envIp: string | null;
  activo: boolean;
  certificadoVence: string | null;
  https: string;
  entrada: string;
}

const ORIGEN_IP: Record<InfoRed['origen'], string> = {
  configuracion: 'Elegida aquí',
  env: 'Fijada en el archivo .env (RED_IP)',
  auto: 'Detectada automáticamente',
};

/** IP de la PC en el WiFi: la usan los celulares del inventario (QR y certificado HTTPS). */
function RedLocal() {
  const avisar = useToast();
  const { data, setData } = useCarga(() => api<InfoRed>('/red/info'), []);
  const [manual, setManual] = useState('');
  const [guardando, setGuardando] = useState(false);
  if (!data) return null;

  const fijar = async (ip: string | null) => {
    setGuardando(true);
    try {
      const r = await api<InfoRed>('/red/ip', { method: 'PUT', body: { ip } });
      setData(r);
      setManual('');
      avisar(ip ? `Listo: los celulares usarán ${r.ip}` : `Listo: el sistema detecta la IP solo (ahora ${r.ip})`);
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setGuardando(false);
    }
  };

  const perdida = data.origen !== 'auto' && !data.detectadas.includes(data.ip);
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      {!data.activo && <div className="alert warn">El acceso de los celulares está desactivado (HTTPS_PORT=0 en el archivo .env).</div>}
      {perdida && (
        <div className="alert danger"><div>
          La PC ya no tiene la IP <b className="mono">{data.ip}</b>
          {data.detectadas.length ? <>. Ahora tiene <b className="mono">{data.detectadas.join(', ')}</b>. Elige la nueva abajo para que los celulares puedan conectarse.</> : '. No se detecta ninguna red: revisa que la PC esté conectada al WiFi.'}
        </div></div>
      )}
      <div className="card card-pad stack">
        <div>
          <h2>IP de esta PC para los celulares</h2>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            Los celulares del inventario entran por esta dirección (va en el código QR). Si el router le cambia la IP a la PC, elige aquí la nueva:
            el certificado de seguridad se rehace solo y los celulares <b>no</b> tienen que volver a instalar nada.
          </p>
        </div>
        <div className="row">
          <span className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{data.ip}</span>
          <span className={`badge ${perdida ? 'danger' : 'ok'}`}>{ORIGEN_IP[data.origen]}</span>
        </div>
        <div>
          <b>IP que tiene ahora la PC</b>
          {data.detectadas.length ? (
            <table style={{ marginTop: 8 }}>
              <tbody>
                {data.detectadas.map((ip) => (
                  <tr key={ip}>
                    <td className="mono">{ip}</td>
                    <td className="actions">
                      {ip === data.ip ? (
                        <span className="badge ok">En uso</span>
                      ) : (
                        <button className="btn btn-sm btn-primary" disabled={guardando} onClick={() => fijar(ip)}>Usar esta</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No se detectó ninguna red. Conecta la PC al WiFi o al cable de la tienda.</p>
          )}
        </div>
        <div className="grid-2">
          <Campo label="Escribir otra IP" ayuda="Por ejemplo 192.168.1.51. La ves en Windows con el comando ipconfig.">
            <input className="mono" value={manual} onChange={(e) => setManual(e.target.value)} placeholder="192.168.1.51" inputMode="decimal" />
          </Campo>
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={guardando || !manual.trim()} onClick={() => fijar(manual.trim())}>Guardar IP</button>
          <button className="btn" disabled={guardando || data.origen === 'auto'} onClick={() => fijar(null)} title="Toma sola la IP del WiFi cada vez que cambie">
            Detectar automáticamente
          </button>
        </div>
        {data.origen === 'env' && (
          <p className="small muted" style={{ margin: 0 }}>Lo que elijas aquí manda sobre el RED_IP del archivo .env ({data.envIp}).</p>
        )}
      </div>
      <div className="card card-pad stack">
        <h2>Datos de la conexión</h2>
        <div className="small">
          <div>Página del QR: <span className="mono">{data.entrada}</span></div>
          <div>Sistema para celulares: <span className="mono">{data.https}</span></div>
          {data.certificadoVence && <div>Certificado válido hasta {fecha(data.certificadoVence)} (se renueva solo).</div>}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Si hay un inventario en curso, vuelve a abrir Realizar inventario para ver el QR con la nueva IP. En el router puedes reservar la IP de la PC para que no cambie.
        </p>
      </div>
    </div>
  );
}
