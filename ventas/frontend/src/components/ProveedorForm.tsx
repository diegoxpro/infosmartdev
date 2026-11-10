import { RefObject, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Proveedor } from '../types';
import { Icono } from './icons';
import { Kbd, Modal, useAtajos, useToast } from './ui';

export type TipoDocProveedor = 'RUC' | 'DNI' | 'SIN';
export type FormProveedor = {
  tipoDoc: TipoDocProveedor;
  numero: string;
  razonSocial: string;
  nombreComercial: string;
  contacto: string;
  telefono: string;
  email: string;
  direccion: string;
  diasCredito: string;
  notas: string;
  activo: boolean;
};
type Nota = { texto: string; tipo: 'ok' | 'warn' | 'info' };
type Consulta =
  | { fuente: 'local'; proveedor: Proveedor }
  | { fuente: 'externa'; datos: { nombre: string; direccion?: string | null; estado?: string | null; condicion?: string | null } }
  | { fuente: null; motivo: string; mensaje: string };

export const LARGO_DOC: Record<TipoDocProveedor, number | undefined> = { RUC: 11, DNI: 8, SIN: undefined };
export const PROVEEDOR_VACIO: FormProveedor = {
  tipoDoc: 'RUC',
  numero: '',
  razonSocial: '',
  nombreComercial: '',
  contacto: '',
  telefono: '',
  email: '',
  direccion: '',
  diasCredito: '',
  notas: '',
  activo: true,
};

export const tipoDeRuc = (ruc?: string | null): TipoDocProveedor => (!ruc ? 'SIN' : ruc.length === 8 ? 'DNI' : 'RUC');

export const aFormProveedor = (p: Proveedor): FormProveedor => ({
  tipoDoc: tipoDeRuc(p.ruc),
  numero: p.ruc ?? '',
  razonSocial: p.razonSocial,
  nombreComercial: p.nombreComercial ?? '',
  contacto: p.contacto ?? '',
  telefono: p.telefono ?? '',
  email: p.email ?? '',
  direccion: p.direccion ?? '',
  diasCredito: p.diasCredito ? String(p.diasCredito) : '',
  notas: p.notas ?? '',
  activo: p.activo,
});

/** Lo escrito en la compra pasa al formulario: 11 dígitos es RUC, 8 es DNI, lo demás es la razón social. */
export function formDesdeTexto(texto: string): FormProveedor {
  const t = texto.trim();
  if (/^\d{11}$/.test(t)) return { ...PROVEEDOR_VACIO, tipoDoc: 'RUC', numero: t };
  if (/^\d{8}$/.test(t)) return { ...PROVEEDOR_VACIO, tipoDoc: 'DNI', numero: t };
  return { ...PROVEEDOR_VACIO, razonSocial: t.toUpperCase() };
}

export function proveedorValido(f: FormProveedor) {
  const largo = LARGO_DOC[f.tipoDoc];
  return f.razonSocial.trim().length >= 2 && (!largo || f.numero.length === largo);
}

export function guardarProveedor(f: FormProveedor, id?: number) {
  return api<Proveedor>(id ? `/proveedores/${id}` : '/proveedores', {
    method: id ? 'PATCH' : 'POST',
    body: {
      ruc: f.tipoDoc === 'SIN' ? null : f.numero,
      razonSocial: f.razonSocial,
      nombreComercial: f.nombreComercial,
      contacto: f.contacto,
      telefono: f.telefono,
      email: f.email,
      direccion: f.direccion,
      diasCredito: f.diasCredito ? Number(f.diasCredito) : null,
      notas: f.notas,
      activo: f.activo,
    },
  });
}

/**
 * Campos del proveedor con consulta de RUC/DNI (primero los guardados, luego el servicio en línea
 * si hay token en Configuración). Sin internet o sin token deja escribir los datos a mano.
 */
export function ProveedorCampos({
  f,
  setF,
  editandoId,
  onExiste,
  numeroRef,
  consultarAlAbrir,
  conActivo,
  extraAbierto,
}: {
  f: FormProveedor;
  setF: (fn: (x: FormProveedor) => FormProveedor) => void;
  editandoId?: number;
  /** El documento ya está registrado como proveedor. */
  onExiste: (p: Proveedor) => void;
  numeroRef?: RefObject<HTMLInputElement>;
  consultarAlAbrir?: boolean;
  conActivo?: boolean;
  extraAbierto?: boolean;
}) {
  const [nota, setNota] = useState<Nota | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [masInfo, setMasInfo] = useState(!!extraAbierto);
  const razonRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof FormProveedor>(k: K, v: FormProveedor[K]) => setF((x) => ({ ...x, [k]: v }));
  const largo = LARGO_DOC[f.tipoDoc];
  const docCompleto = !!largo && f.numero.length === largo;

  useEffect(() => setMasInfo(!!extraAbierto), [extraAbierto]);
  // Al cambiar de proveedor (o limpiar) se borra el aviso anterior.
  useEffect(() => setNota(null), [editandoId]);

  const consultar = async () => {
    if (!docCompleto) return;
    setBuscando(true);
    setNota(null);
    try {
      const r = await api<Consulta>(`/proveedores/consulta/${f.tipoDoc}/${f.numero}`);
      if (r.fuente === 'local') {
        if (r.proveedor.id !== editandoId) onExiste(r.proveedor);
      } else if (r.fuente === 'externa') {
        const d = r.datos;
        setF((x) => ({ ...x, razonSocial: d.nombre, direccion: d.direccion ?? x.direccion }));
        const alerta = [d.estado && d.estado !== 'ACTIVO' && d.estado, d.condicion && d.condicion !== 'HABIDO' && d.condicion].filter(Boolean).join(' · ');
        setNota(alerta ? { texto: `Datos encontrados, pero el RUC figura: ${alerta}.`, tipo: 'warn' } : { texto: 'Datos encontrados. Revisa y guarda con F2.', tipo: 'ok' });
      } else {
        setNota({ texto: r.mensaje.replace('el nombre', 'la razón social'), tipo: r.motivo === 'no_encontrado' ? 'warn' : 'info' });
        razonRef.current?.focus();
      }
    } catch (e) {
      // Sin conexión con el propio sistema o un error inesperado: se sigue a mano.
      setNota({ texto: `${(e as Error).message}. Escribe la razón social a mano.`, tipo: 'warn' });
    } finally {
      setBuscando(false);
    }
  };

  // Desde la compra, un RUC/DNI completo se consulta apenas se abre el registro.
  useEffect(() => {
    if (consultarAlAbrir && docCompleto) consultar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cambiarTipo = (t: TipoDocProveedor) => {
    setF((x) => ({ ...x, tipoDoc: t, numero: t === 'SIN' ? '' : x.numero.slice(0, LARGO_DOC[t]) }));
    setNota(null);
  };

  return (
    <>
      <div className="grid-2 cliente-doc proveedor-doc">
        <div className="field">
          <span>Tipo de documento *</span>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            {(['RUC', 'DNI'] as const).map((t) => (
              <label key={t} className={`opcion-doc${f.tipoDoc === t ? ' on' : ''}`}>
                <input type="radio" name={`tipoDocProveedor${editandoId ?? ''}`} checked={f.tipoDoc === t} onChange={() => cambiarTipo(t)} />
                <Icono nombre={t === 'RUC' ? 'empresa' : 'persona'} tam={16} /> {t}
              </label>
            ))}
            <label className={`opcion-doc${f.tipoDoc === 'SIN' ? ' on' : ''}`} title="Proveedor sin RUC ni DNI">
              <input type="radio" name={`tipoDocProveedor${editandoId ?? ''}`} checked={f.tipoDoc === 'SIN'} onChange={() => cambiarTipo('SIN')} /> Sin doc.
            </label>
          </div>
        </div>
        <div className="field">
          <span>N.º de {f.tipoDoc === 'SIN' ? 'documento' : f.tipoDoc} {f.tipoDoc !== 'SIN' && '*'}</span>
          <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
            <input
              ref={numeroRef}
              className="mono grow"
              inputMode="numeric"
              value={f.numero}
              maxLength={largo ?? 11}
              disabled={f.tipoDoc === 'SIN'}
              onChange={(e) => (set('numero', e.target.value.replace(/\D/g, '')), setNota(null))}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), consultar())}
              placeholder={largo ? `${largo} dígitos` : ''}
              aria-label="Número de documento"
              autoFocus={!f.razonSocial || !f.numero}
            />
            {largo && (
              <button type="button" className="btn" onClick={consultar} disabled={!docCompleto || buscando} title="Buscar datos del documento (Enter)" aria-label="Buscar documento">
                {buscando ? '…' : <Icono nombre="buscar" />}
              </button>
            )}
          </div>
        </div>
      </div>

      {nota && <div className={`aviso aviso-${nota.tipo}`} role="status">{nota.texto}</div>}

      <label className="field">
        <span>{f.tipoDoc === 'DNI' ? 'Nombres y apellidos' : 'Razón social'} *</span>
        <input ref={razonRef} value={f.razonSocial} onChange={(e) => set('razonSocial', e.target.value)} />
      </label>

      <div className="grid-2">
        <label className="field">
          <span>Nombre comercial</span>
          <input value={f.nombreComercial} onChange={(e) => set('nombreComercial', e.target.value)} placeholder="Ej. Backus" />
        </label>
        <label className="field">
          <span>Contacto / vendedor</span>
          <div className="input-icono"><Icono nombre="persona" tam={16} /><input value={f.contacto} onChange={(e) => set('contacto', e.target.value)} /></div>
        </label>
        <label className="field">
          <span>Teléfono / celular</span>
          <div className="input-icono"><Icono nombre="telefono" tam={16} /><input inputMode="tel" value={f.telefono} onChange={(e) => set('telefono', e.target.value)} /></div>
        </label>
        <label className="field">
          <span>Días de crédito</span>
          <input
            className="num"
            inputMode="numeric"
            value={f.diasCredito}
            maxLength={3}
            onChange={(e) => set('diasCredito', e.target.value.replace(/\D/g, ''))}
            placeholder="Vacío si paga al contado"
            title="Si el proveedor da crédito (ej. 15 días), la compra propone Crédito y la fecha de pago"
          />
        </label>
      </div>

      <label className="field">
        <span>Dirección</span>
        <div className="input-icono"><Icono nombre="ubicacion" tam={16} /><input value={f.direccion} onChange={(e) => set('direccion', e.target.value)} /></div>
      </label>

      <div className="cliente-extra">
        <button type="button" className="cliente-extra-head" onClick={() => setMasInfo((v) => !v)} aria-expanded={masInfo}>
          <span className="grow">Información adicional</span>
          <Icono nombre="flecha" className={masInfo ? 'girar-90' : ''} />
        </button>
        {masInfo && (
          <div className="stack" style={{ padding: '10px 12px' }}>
            <label className="field">
              <span>Correo electrónico</span>
              <div className="input-icono"><Icono nombre="correo" tam={16} /><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></div>
            </label>
            <label className="field">
              <span>Notas</span>
              <textarea rows={2} value={f.notas} onChange={(e) => set('notas', e.target.value)} placeholder="Ej. día de visita, pedido mínimo, cuenta para depósitos" />
            </label>
            {conActivo && (
              <label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => set('activo', e.target.checked)} /> Activo (aparece al registrar compras)</label>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Registro de proveedor como ventana, para usarlo sin salir de Registrar compra.
 * `inicial` trae lo que se escribió en la compra; F2 guarda y deja el proveedor elegido.
 */
export default function ProveedorForm({
  proveedor,
  inicial,
  onClose,
  onGuardado,
}: {
  proveedor?: Proveedor;
  inicial?: string;
  onClose: () => void;
  onGuardado: (p: Proveedor) => void;
}) {
  const avisar = useToast();
  const [f, setF] = useState<FormProveedor>(() => (proveedor ? aFormProveedor(proveedor) : formDesdeTexto(inicial ?? '')));
  const [guardando, setGuardando] = useState(false);
  const puede = proveedorValido(f) && !guardando;

  const guardar = async () => {
    if (!puede) return;
    setGuardando(true);
    try {
      const p = await guardarProveedor(f, proveedor?.id);
      avisar(proveedor ? 'Proveedor actualizado' : 'Proveedor registrado');
      onGuardado(p);
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setGuardando(false);
    }
  };

  useAtajos({ F2: guardar }, { enModal: true });

  return (
    <Modal
      className="cobro proveedor-modal"
      onClose={onClose}
      titulo={
        <span className="cobro-titulo">
          <Icono nombre="proveedores" tam={30} />
          <span>
            {proveedor ? 'Editar proveedor' : 'Nuevo proveedor'}
            <small>{inicial ? `«${inicial}» no está registrado: regístralo y quedará elegido en la compra` : inicial !== undefined ? 'Regístralo y quedará elegido en la compra' : 'Datos del proveedor'}</small>
          </span>
        </span>
      }
      pie={
        <>
          <span className="grow" />
          <button className="btn btn-lg" onClick={onClose}>Cancelar</button>
          <button className="btn btn-lg btn-confirmar" onClick={guardar} disabled={!puede}>
            <Icono nombre="guardar" /> {inicial !== undefined ? 'Guardar y usar' : 'Guardar'} <Kbd>F2</Kbd>
          </button>
        </>
      }
    >
      <section className="card card-pad stack">
        <ProveedorCampos
          f={f}
          setF={setF}
          editandoId={proveedor?.id}
          consultarAlAbrir={!proveedor}
          conActivo={!!proveedor}
          onExiste={async (p) => {
            try {
              // Un proveedor inactivo se reactiva para poder usarlo en la compra.
              const listo = p.activo ? p : await api<Proveedor>(`/proveedores/${p.id}`, { method: 'PATCH', body: { activo: true } });
              avisar(`${listo.nombreComercial || listo.razonSocial} ya estaba registrado${p.activo ? '' : ' (se reactivó)'}`);
              onGuardado(listo);
            } catch (e) {
              avisar((e as Error).message, true);
            }
          }}
        />
      </section>
    </Modal>
  );
}
