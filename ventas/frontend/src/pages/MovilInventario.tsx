import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { useCallback, useEffect, useRef, useState } from 'react';
import '../movil.css';
import { nombreMarca, useMarca } from '../marca';

/**
 * Página del celular para el inventario. No usa usuario del sistema: entra con
 * el token del QR. Todo lo que el operador acepta se guarda primero en el
 * celular (localStorage) y se envía a la PC; si se cierra la página, se apaga
 * el teléfono o se va la señal, al volver se reenvía y sigue donde quedó.
 */

const CLAVE_OP = 'candys.inv.operador';
const CLAVE_COLA = 'candys.inv.cola';
const CLAVE_NOMBRE = 'candys.inv.nombre';

interface Operador {
  token: string;
  nombre: string;
  /** Token del QR con el que entró: si escanea otro inventario, entra de nuevo. */
  qr: string;
}

interface ConteoLocal {
  clienteId: string;
  productoId: number;
  producto: string;
  cantidad: number;
  lotes?: Lote[];
  /** Versión anterior (una sola fecha): se convierte al enviar. */
  fechaVencimiento?: string;
  creado: number;
  error?: string;
}

interface ConteoServidor {
  id: number;
  clienteId: string;
  producto: string;
  cantidad: string;
  estado: 'APLICADO' | 'PENDIENTE' | 'SUMADO' | 'REEMPLAZADO' | 'DESCARTADO';
  fecha: string;
}

interface Sesion {
  operador: { id: number; nombre: string };
  inventario: { id: number; estado: 'EN_CURSO' | 'REVISION' | 'VALIDADO' | 'CANCELADO' };
  total: number;
  conteos: ConteoServidor[];
}

interface ProductoMovil {
  id: number;
  nombre: string;
  codigoBarra: string | null;
  unidad: string;
  stock: string;
  controlaVencimiento: boolean;
  contado?: boolean;
}

interface Lote {
  fecha: string;
  cantidad: number;
}

interface Hallado {
  producto: ProductoMovil;
  presentacion: { nombre: string; factor: string } | null;
  lotesSistema: Lote[];
  yaContado: { cantidad: string; conteos: { operador: string; cantidad: string; estado: string; fecha: string }[] } | null;
}

class ErrorApi extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const leer = <T,>(clave: string, defecto: T): T => {
  try {
    const v = localStorage.getItem(clave);
    return v ? (JSON.parse(v) as T) : defecto;
  } catch {
    return defecto;
  }
};
const guardar = (clave: string, v: unknown) => {
  try {
    if (v === null) localStorage.removeItem(clave);
    else localStorage.setItem(clave, JSON.stringify(v));
  } catch {
    /* sin almacenamiento: igual se envía a la PC */
  }
};

const nuevoId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

async function llamar<T>(ruta: string, op: string | null, body?: unknown): Promise<T> {
  const res = await fetch(`/api/inventario-movil${ruta}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(op ? { 'x-operador': op } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
    throw new ErrorApi(msg ?? 'No se pudo conectar con la PC', res.status);
  }
  return data as T;
}

const ESTADO_TXT: Record<ConteoServidor['estado'], { t: string; c: string }> = {
  APLICADO: { t: 'Guardado', c: 'ok' },
  PENDIENTE: { t: 'La PC decide', c: 'warn' },
  SUMADO: { t: 'Sumado', c: 'ok' },
  REEMPLAZADO: { t: 'Reemplazó', c: 'ok' },
  DESCARTADO: { t: 'Descartado', c: 'danger' },
};

const hora = (v: string | number) => new Date(v).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

export default function MovilInventario() {
  const qr = new URLSearchParams(location.search).get('t') ?? '';
  const [op, setOp] = useState<Operador | null>(() => {
    const o = leer<Operador | null>(CLAVE_OP, null);
    return o && (!qr || o.qr === qr) ? o : null;
  });
  const [error, setError] = useState('');
  const salir = useCallback(() => {
    guardar(CLAVE_OP, null);
    setOp(null);
  }, []);

  if (!op) return <Entrar qr={qr} alEntrar={(o) => (guardar(CLAVE_OP, o), setOp(o))} error={error} setError={setError} />;
  return <Contador key={op.token} op={op} claveCola={CLAVE_COLA} alSalir={salir} />;
}

/**
 * Pantalla de conteo. La usan el celular (entra con el QR) y la PC (la cajera
 * o el administrador con su usuario; ahí se cuenta con el lector de códigos USB).
 * Lo aceptado se guarda primero en `claveCola` y luego se envía.
 */
export function Contador({ op, claveCola, alSalir, enPc = false }: { op: Pick<Operador, 'token' | 'nombre'>; claveCola: string; alSalir: () => void; enPc?: boolean }) {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [sinSenal, setSinSenal] = useState(false);
  const [cola, setCola] = useState<ConteoLocal[]>(() => leer(claveCola, []));
  const [pantalla, setPantalla] = useState<'inicio' | 'escanear' | 'buscar'>('inicio');
  const [hallado, setHallado] = useState<Hallado | null>(null);
  const [aviso, setAviso] = useState('');
  const [codigo, setCodigo] = useState('');
  const lector = useRef<HTMLInputElement>(null);
  const enviando = useRef(false);
  const ultimoModo = useRef<'escanear' | 'buscar' | 'lector'>(enPc ? 'lector' : 'escanear');
  const colaRef = useRef(cola);
  colaRef.current = cola;

  const actualizarCola = (fn: (c: ConteoLocal[]) => ConteoLocal[]) => {
    const n = fn(colaRef.current);
    colaRef.current = n;
    guardar(claveCola, n);
    setCola(n);
  };

  const salir = alSalir;

  const cargarSesion = useCallback(async () => {
    if (!op) return;
    try {
      setSesion(await llamar<Sesion>('/sesion', op.token));
      setSinSenal(false);
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 401) salir();
      else setSinSenal(true);
    }
  }, [op, salir]);

  /** Envía a la PC lo que está guardado en el celular. */
  const enviarCola = useCallback(async () => {
    if (!op || enviando.current || !colaRef.current.length) return;
    enviando.current = true;
    try {
      for (const c of [...colaRef.current]) {
        try {
          await llamar('/conteos', op.token, {
            clienteId: c.clienteId,
            productoId: c.productoId,
            cantidad: c.cantidad,
            lotes: c.lotes ?? (c.fechaVencimiento ? [{ fecha: c.fechaVencimiento, cantidad: c.cantidad }] : []),
          });
          actualizarCola((q) => q.filter((x) => x.clienteId !== c.clienteId));
          setSinSenal(false);
        } catch (e) {
          if (e instanceof ErrorApi && e.status >= 400 && e.status < 500) {
            // La PC lo rechazó (p. ej. ya cerró el conteo): queda a la vista con el motivo.
            actualizarCola((q) => q.map((x) => (x.clienteId === c.clienteId ? { ...x, error: e.message } : x)));
            if (e.status === 401) salir();
          } else {
            setSinSenal(true);
            break;
          }
        }
      }
    } finally {
      enviando.current = false;
      cargarSesion();
    }
  }, [op, cargarSesion, salir]);

  useEffect(() => {
    if (!op) return;
    cargarSesion();
    enviarCola();
    const t = setInterval(() => {
      enviarCola();
      cargarSesion();
    }, 5000);
    const online = () => enviarCola();
    window.addEventListener('online', online);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', online);
    };
  }, [op, cargarSesion, enviarCola]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(''), 2500);
    return () => clearTimeout(t);
  }, [aviso]);

  // En la PC el cursor vuelve al campo del lector para escanear seguido.
  useEffect(() => {
    if (enPc && pantalla === 'inicio' && !hallado) lector.current?.focus();
  }, [enPc, pantalla, hallado]);

  const abierto = !sesion || sesion.inventario.estado === 'EN_CURSO';
  const sinEnviar = cola.filter((c) => !c.error);
  const rechazados = cola.filter((c) => c.error);

  const elegir = async (buscar: () => Promise<Hallado>, desde: 'escanear' | 'buscar' | 'lector') => {
    ultimoModo.current = desde;
    try {
      setHallado(await buscar());
      setPantalla('inicio');
    } catch (e) {
      setPantalla('inicio');
      if (e instanceof ErrorApi && e.status === 404) setAviso(e.message);
      else setAviso(enPc ? 'No se pudo conectar con el sistema. Intenta de nuevo.' : 'Sin conexión con la PC. Acércate al WiFi e intenta de nuevo.');
    }
  };

  const aceptar = (cantidad: number, lotes: Lote[]) => {
    const h = hallado!;
    actualizarCola((q) => [...q, { clienteId: nuevoId(), productoId: h.producto.id, producto: h.producto.nombre, cantidad, lotes, creado: Date.now() }]);
    setHallado(null);
    setAviso(`✓ ${h.producto.nombre}: ${cantidad}`);
    setTimeout(enviarCola, 0);
    // Para contar rápido: si venía de la cámara, la vuelve a abrir.
    if (ultimoModo.current === 'escanear') setPantalla('escanear');
  };

  return (
    <div className={enPc ? 'mv mv-pc' : 'mv'}>
      <header className="mv-head">
        <div>
          <b>Inventario {sesion ? `#${sesion.inventario.id}` : ''}</b>
          <span>{op.nombre} · {sesion?.total ?? 0} contados</span>
        </div>
        {!enPc && <button className="mv-link" onClick={() => confirm('¿Salir de este inventario en este celular?') && salir()}>Salir</button>}
      </header>

      {sinSenal && (
        <div className="mv-banda warn">
          {enPc
            ? 'Sin conexión con el sistema. Lo que cuentes se guarda en esta PC y se envía al volver.'
            : 'Sin conexión con la PC. Lo que cuentes se guarda en el celular y se envía al volver la señal.'}
        </div>
      )}
      {!abierto && (
        <div className="mv-banda info">
          {sesion?.inventario.estado === 'REVISION'
            ? 'El administrador cerró el conteo. Ya no se reciben más productos.'
            : 'Este inventario terminó. Gracias por tu ayuda.'}
        </div>
      )}
      {aviso && <div className="mv-toast">{aviso}</div>}

      {pantalla === 'escanear' && (
        <Escaner
          onCodigo={(codigo) => elegir(() => llamar<Hallado>(`/codigo/${encodeURIComponent(codigo)}`, op.token), 'escanear')}
          onCerrar={() => setPantalla('inicio')}
        />
      )}
      {pantalla === 'buscar' && (
        <Buscar token={op.token} onElegir={(p) => elegir(() => llamar<Hallado>(`/producto/${p.id}`, op.token), 'buscar')} onCerrar={() => setPantalla('inicio')} />
      )}

      {pantalla === 'inicio' && (
        <main className="mv-main">
          {enPc ? (
            <form
              className="mv-lector"
              onSubmit={(e) => {
                e.preventDefault();
                const c = codigo.trim();
                if (!c) return;
                setCodigo('');
                elegir(() => llamar<Hallado>(`/codigo/${encodeURIComponent(c)}`, op.token), 'lector');
              }}
            >
              <label className="mv-campo">
                Escanea con el lector o escribe el código y presiona Enter
                <input ref={lector} value={codigo} onChange={(e) => setCodigo(e.target.value)} disabled={!abierto} inputMode="numeric" autoComplete="off" placeholder="Código de barras" />
              </label>
              <button className="mv-btn verde" disabled={!abierto || !codigo.trim()}>Buscar código</button>
            </form>
          ) : (
          <button className="mv-btn verde grande" disabled={!abierto} onClick={() => setPantalla('escanear')}>
            <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M3 7V4h3M18 4h3v3M21 17v3h-3M6 20H3v-3M7 8v8M10 8v8M13 8v8M16 8v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            Escanear código
          </button>
          )}
          <button className="mv-btn" disabled={!abierto} onClick={() => setPantalla('buscar')}>Buscar por nombre (sin código)</button>

          {(sinEnviar.length > 0 || rechazados.length > 0) && (
            <section className="mv-lista">
              <h3>{enPc ? 'En esta PC' : 'En el celular'}</h3>
              {sinEnviar.map((c) => (
                <div key={c.clienteId} className="mv-fila">
                  <span className="grow">{c.producto}</span><b>{c.cantidad}</b><span className="mv-chip warn">Sin enviar</span>
                </div>
              ))}
              {rechazados.map((c) => (
                <div key={c.clienteId} className="mv-fila">
                  <span className="grow">{c.producto}<small>{c.error}</small></span><b>{c.cantidad}</b>
                  <button className="mv-link" onClick={() => actualizarCola((q) => q.filter((x) => x.clienteId !== c.clienteId))}>Quitar</button>
                </div>
              ))}
            </section>
          )}

          <section className="mv-lista">
            <h3>Mis últimos conteos</h3>
            {sesion?.conteos.length ? (
              sesion.conteos.map((c) => (
                <div key={c.id} className="mv-fila">
                  <span className="grow">{c.producto}<small>{hora(c.fecha)}</small></span>
                  <b>{Number(c.cantidad)}</b>
                  <span className={`mv-chip ${ESTADO_TXT[c.estado].c}`}>{ESTADO_TXT[c.estado].t}</span>
                </div>
              ))
            ) : (
              <p className="mv-vacio">Aún no cuentas productos.</p>
            )}
          </section>
        </main>
      )}

      {hallado && <Cantidad hallado={hallado} onCancelar={() => setHallado(null)} onAceptar={aceptar} />}
    </div>
  );
}

function Entrar({ qr, alEntrar, error, setError }: { qr: string; alEntrar: (o: Operador) => void; error: string; setError: (e: string) => void }) {
  const [nombre, setNombre] = useState(() => leer(CLAVE_NOMBRE, ''));
  const [ocupado, setOcupado] = useState(false);
  const { marca } = useMarca();
  if (!qr) {
    return (
      <div className="mv mv-centro">
        <h2>Inventario</h2>
        <p>Escanea el código QR que aparece en la PC (Realizar inventario › Iniciar) para entrar.</p>
      </div>
    );
  }
  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true);
    setError('');
    try {
      const r = await llamar<{ token: string; nombre: string }>('/entrar', null, { token: qr, nombre: nombre.trim() });
      guardar(CLAVE_NOMBRE, nombre.trim());
      alEntrar({ token: r.token, nombre: r.nombre, qr });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <form className="mv mv-centro" onSubmit={entrar}>
      <h2>Inventario · {nombreMarca(marca)}</h2>
      <label className="mv-campo">
        Tu nombre
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus maxLength={40} placeholder="Ej. Juan" autoComplete="given-name" />
      </label>
      {error && <div className="mv-banda danger">{error}</div>}
      <button className="mv-btn verde grande" disabled={ocupado || nombre.trim().length < 2}>{ocupado ? 'Conectando…' : 'Entrar'}</button>
    </form>
  );
}

const FORMATOS = [
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93, BarcodeFormat.ITF, BarcodeFormat.CODABAR,
];

const CLAVE_CAMARA = 'candys.inv.camara';

interface Camara {
  id: string;
  nombre: string;
}

/**
 * Cámaras traseras ordenadas para que la principal quede primero. En los
 * Samsung (A55 y otros) "environment" puede abrir el gran angular o el macro,
 * que no enfocan de cerca; la principal suele ser "camera2 0" / la de número
 * más bajo.
 */
async function listarCamaras(): Promise<Camara[]> {
  const todas = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const traseras = todas.filter((d) => /back|rear|trasera|posterior|environment/i.test(d.label));
  const lista = traseras.length ? traseras : todas;
  const numero = (l: string) => Number(/(?:camera2?\s*|c[aá]mara\s*)(\d+)/i.exec(l)?.[1] ?? 99);
  return [...lista]
    .sort((x, y) => numero(x.label) - numero(y.label))
    .map((d, i) => ({ id: d.deviceId, nombre: d.label || `Cámara ${i + 1}` }));
}

interface Detector {
  detect(fuente: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

/** Lector nativo de Android (Chrome): más rápido y preciso que el de JavaScript. */
async function detectorNativo(): Promise<Detector | null> {
  const BD = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
  if (!BD) return null;
  try {
    const soportados = await BD.getSupportedFormats();
    const formatos = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar'].filter((f) => soportados.includes(f));
    return formatos.includes('ean_13') ? new BD({ formats: formatos }) : null;
  } catch {
    return null;
  }
}

function Escaner({ onCodigo, onCerrar }: { onCodigo: (c: string) => void; onCerrar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [manual, setManual] = useState('');
  const [camaras, setCamaras] = useState<Camara[]>([]);
  const [camara, setCamara] = useState<string | null>(() => leer<string | null>(CLAVE_CAMARA, null));
  const [linterna, setLinterna] = useState<boolean | null>(null);
  const pista = useRef<MediaStreamTrack | null>(null);
  const listo = useRef(false);
  const alLeer = useRef(onCodigo);
  alLeer.current = onCodigo;

  useEffect(() => {
    let vivo = true;
    let stream: MediaStream | null = null;
    let zxing: IScannerControls | null = null;
    let temporizador = 0;
    listo.current = false;

    const leido = (texto: string) => {
      if (listo.current || !vivo) return;
      listo.current = true;
      navigator.vibrate?.(80);
      alLeer.current(texto);
    };

    (async () => {
      try {
        let lista = await listarCamaras().catch(() => [] as Camara[]);
        // Sin permiso todavía no hay nombres: se pide una vez y se vuelve a listar.
        if (!lista.some((c) => c.nombre && !c.nombre.startsWith('Cámara '))) {
          const prueba = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          prueba.getTracks().forEach((t) => t.stop());
          lista = await listarCamaras();
        }
        if (!vivo) return;
        setCamaras(lista);
        const elegida = lista.find((c) => c.id === camara) ?? lista[0];
        stream = await navigator.mediaDevices.getUserMedia({
          video: elegida
            ? { deviceId: { exact: elegida.id }, width: { ideal: 1920 }, height: { ideal: 1080 } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (!vivo) return stream.getTracks().forEach((t) => t.stop());
        const track = stream.getVideoTracks()[0];
        pista.current = track;
        const cap = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { focusMode?: string[]; torch?: boolean };
        if (cap.focusMode?.includes('continuous')) {
          await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
        }
        setLinterna(cap.torch ? false : null);
        const v = video.current!;
        v.srcObject = stream;
        await v.play().catch(() => undefined);

        const nativo = await detectorNativo();
        if (nativo) {
          const buscar = async () => {
            if (!vivo || listo.current) return;
            try {
              if (v.readyState >= 2) {
                const r = await nativo.detect(v);
                if (r[0]?.rawValue) return leido(r[0].rawValue);
              }
            } catch {
              /* cuadro sin imagen todavía */
            }
            temporizador = window.setTimeout(buscar, 120);
          };
          buscar();
        } else {
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATOS);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const lector = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
          zxing = await lector.decodeFromStream(stream, v, (r) => r && leido(r.getText()));
          if (!vivo) zxing.stop();
        }
      } catch (e) {
        if (!vivo) return;
        const err = e as Error;
        if (camara && err.name === 'OverconstrainedError') {
          // La cámara guardada ya no existe: se vuelve a la principal.
          guardar(CLAVE_CAMARA, null);
          return setCamara(null);
        }
        setError(
          err.name === 'NotAllowedError'
            ? 'No diste permiso para usar la cámara. Actívalo en el candado de la barra de direcciones.'
            : window.isSecureContext
              ? 'No se pudo abrir la cámara. Prueba "Cambiar cámara" o escribe el código abajo.'
              : 'La cámara necesita la conexión segura (https). Vuelve a escanear el QR de la PC.',
        );
      }
    })();

    return () => {
      vivo = false;
      clearTimeout(temporizador);
      zxing?.stop();
      stream?.getTracks().forEach((t) => t.stop());
      pista.current = null;
    };
  }, [camara]);

  const indice = Math.max(0, camaras.findIndex((c) => c.id === camara));
  const cambiarCamara = () => {
    if (camaras.length < 2) return;
    const sig = camaras[(indice + 1) % camaras.length].id;
    guardar(CLAVE_CAMARA, sig);
    setError('');
    setCamara(sig);
  };
  const alternarLinterna = async () => {
    const t = pista.current;
    if (!t || linterna === null) return;
    try {
      await t.applyConstraints({ advanced: [{ torch: !linterna } as MediaTrackConstraintSet] });
      setLinterna(!linterna);
    } catch {
      setLinterna(null);
    }
  };

  return (
    <div className="mv-escaner">
      <video ref={video} playsInline muted autoPlay />
      <div className="mv-mira" aria-hidden="true" />
      <div className="mv-escaner-pie">
        {error ? <div className="mv-banda danger">{error}</div> : <p>Apunta al código de barras, a unos 15 cm</p>}
        <div className="mv-escaner-botones">
          {camaras.length > 1 && (
            <button type="button" className="mv-btn" onClick={cambiarCamara}>Cambiar cámara ({indice + 1}/{camaras.length})</button>
          )}
          {linterna !== null && (
            <button type="button" className="mv-btn" onClick={alternarLinterna}>{linterna ? 'Apagar luz' : 'Linterna'}</button>
          )}
        </div>
        <form
          className="mv-manual"
          onSubmit={(e) => {
            e.preventDefault();
            if (manual.trim()) onCodigo(manual.trim());
          }}
        >
          <input inputMode="numeric" placeholder="o escribe el código" value={manual} onChange={(e) => setManual(e.target.value)} />
          <button className="mv-btn">Buscar</button>
        </form>
        <button className="mv-btn" onClick={onCerrar}>Cerrar cámara</button>
      </div>
    </div>
  );
}

function Buscar({ token, onElegir, onCerrar }: { token: string; onElegir: (p: ProductoMovil) => void; onCerrar: () => void }) {
  const [q, setQ] = useState('');
  const [lista, setLista] = useState<ProductoMovil[]>([]);
  const [cargando, setCargando] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) return setLista([]);
    let vigente = true;
    setCargando(true);
    const t = setTimeout(() => {
      llamar<ProductoMovil[]>(`/buscar?q=${encodeURIComponent(q)}`, token)
        .then((r) => vigente && setLista(r))
        .catch(() => vigente && setLista([]))
        .finally(() => vigente && setCargando(false));
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [q, token]);
  return (
    <main className="mv-main">
      <div className="mv-buscar">
        <input type="search" autoFocus placeholder="Nombre del producto" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="mv-link" onClick={onCerrar}>Cerrar</button>
      </div>
      <section className="mv-lista">
        {lista.map((p) => (
          <button key={p.id} className="mv-fila boton" onClick={() => onElegir(p)}>
            <span className="grow">{p.nombre}<small>{p.codigoBarra ?? 'Sin código'}</small></span>
            {p.contado && <span className="mv-chip ok">Ya contado</span>}
          </button>
        ))}
        {!cargando && q.trim().length >= 2 && !lista.length && <p className="mv-vacio">No hay productos con ese nombre.</p>}
      </section>
    </main>
  );
}

interface Fila {
  id: number;
  fecha: string;
  cantidad: string;
}

const numero = (v: string) => Number(v.replace(',', '.'));
const fechaCorta = (f: string) => f.split('-').reverse().join('/');
let siguienteFila = 1;
const fila = (fecha = '', cantidad = ''): Fila => ({ id: siguienteFila++, fecha, cantidad });

/**
 * Cantidad del producto. Con vencimiento se cuenta por fecha: aparecen los
 * lotes que el sistema conoce (fecha y cantidad) para corregirlos, se pueden
 * agregar otras fechas y el total es la suma.
 */
function Cantidad({ hallado, onCancelar, onAceptar }: { hallado: Hallado; onCancelar: () => void; onAceptar: (c: number, lotes: Lote[]) => void }) {
  const { producto, presentacion, yaContado, lotesSistema } = hallado;
  const obligatorio = producto.controlaVencimiento;
  const [porFecha, setPorFecha] = useState(obligatorio || lotesSistema.length > 0);
  const [cantidad, setCantidad] = useState('');
  const [filas, setFilas] = useState<Fila[]>(() =>
    lotesSistema.length ? lotesSistema.map((l) => fila(l.fecha, String(l.cantidad))) : [fila()],
  );

  const enUso = filas.filter((f) => f.fecha || f.cantidad.trim());
  const totalFilas = Math.round(enUso.reduce((s, f) => s + (numero(f.cantidad) || 0), 0) * 1000) / 1000;
  const filasOk = enUso.every((f) => f.cantidad.trim() !== '' && Number.isFinite(numero(f.cantidad)) && numero(f.cantidad) >= 0 && (!!f.fecha || numero(f.cantidad) === 0));
  const valor = porFecha ? totalFilas : numero(cantidad);
  const valido = porFecha ? filasOk : cantidad.trim() !== '' && Number.isFinite(valor) && valor >= 0;
  const cambiar = (id: number, campo: 'fecha' | 'cantidad', v: string) =>
    setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, [campo]: campo === 'cantidad' ? v.replace(/[^\d.,]/g, '') : v } : f)));
  const sumar = (d: number) => setCantidad(String(Math.max(0, (numero(cantidad) || 0) + d)));
  const activarFechas = (si: boolean) => {
    setPorFecha(si);
    // Al pasar a fechas, lo ya escrito queda en la primera fila.
    if (si && cantidad && !lotesSistema.length) setFilas([fila('', cantidad)]);
  };

  return (
    <div className="mv-hoja" role="dialog" aria-modal="true" aria-labelledby="mv-prod">
      <form
        className="mv-hoja-caja"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valido) return;
          const lotes = porFecha ? enUso.filter((f) => numero(f.cantidad) > 0).map((f) => ({ fecha: f.fecha, cantidad: numero(f.cantidad) })) : [];
          onAceptar(valor, lotes);
        }}
      >
        <h2 id="mv-prod">{producto.nombre}</h2>
        <p className="mv-sub">
          {producto.codigoBarra ?? 'Sin código'} · se cuenta en {producto.unidad} · en sistema: <b>{Number(producto.stock)}</b>
        </p>
        {presentacion && (
          <div className="mv-banda info">
            Escaneaste la presentación <b>{presentacion.nombre}</b> (x{Number(presentacion.factor)}). Escribe el total en <b>unidades</b>.
          </div>
        )}
        {yaContado && (
          <div className="mv-banda warn">
            Ya fue contado: {yaContado.conteos.map((c) => `${c.operador} ${Number(c.cantidad)} (${hora(c.fecha)})`).join(', ')}. Si lo registras, la PC decidirá si se suma o reemplaza.
          </div>
        )}

        {porFecha ? (
          <>
            <div className="mv-lotes">
              <div className="mv-lotes-cab"><span>Vence el</span><span>Cantidad</span><span /></div>
              {filas.map((f) => (
                <div key={f.id} className="mv-lote">
                  <input type="date" value={f.fecha} onChange={(e) => cambiar(f.id, 'fecha', e.target.value)} aria-label="Fecha de vencimiento" />
                  <input inputMode="decimal" value={f.cantidad} onChange={(e) => cambiar(f.id, 'cantidad', e.target.value)} placeholder="0" aria-label="Cantidad de esa fecha" />
                  <button type="button" className="mv-link" onClick={() => setFilas((fs) => (fs.length > 1 ? fs.filter((x) => x.id !== f.id) : [fila()]))} aria-label="Quitar esta fecha">✕</button>
                </div>
              ))}
              <button type="button" className="mv-btn" onClick={() => setFilas((fs) => [...fs, fila()])}>+ Agregar otra fecha</button>
            </div>
            {lotesSistema.length > 0 && (
              <p className="mv-sub">El sistema tenía: {lotesSistema.map((l) => `${fechaCorta(l.fecha)} → ${l.cantidad}`).join(' · ')}. Corrige lo que no coincida y pon 0 en la fecha que ya no está.</p>
            )}
            <div className="mv-total"><span>Total</span><b>{totalFilas}</b></div>
            {!filasOk && <p className="mv-error">Cada cantidad necesita su fecha de vencimiento.</p>}
          </>
        ) : (
          <label className="mv-campo">
            Cantidad en unidades
            <div className="mv-cant">
              <button type="button" className="mv-btn" onClick={() => sumar(-1)} aria-label="Restar uno">−</button>
              <input inputMode="decimal" autoFocus value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="0" />
              <button type="button" className="mv-btn" onClick={() => sumar(1)} aria-label="Sumar uno">+</button>
            </div>
          </label>
        )}
        {!obligatorio && (
          <label className="mv-check">
            <input type="checkbox" checked={porFecha} onChange={(e) => activarFechas(e.target.checked)} /> Registrar fechas de vencimiento
          </label>
        )}
        <div className="mv-acciones">
          <button type="button" className="mv-btn" onClick={onCancelar}>Cancelar</button>
          <button className="mv-btn verde" disabled={!valido}>Aceptar{porFecha ? ` (${totalFilas})` : ''}</button>
        </div>
      </form>
    </div>
  );
}
