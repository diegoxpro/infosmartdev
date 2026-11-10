import { useState } from 'react';
import { api, qs } from '../api';
import { useAuth } from '../auth';
import GastoModal from '../components/GastoModal';
import { Icono } from '../components/icons';
import { Campo, Modal, useCarga, useToast, Vacio } from '../components/ui';
import { fecha, fechaHora, hoyISO, money, n } from '../format';
import { AvisoGastoFijo, CategoriaGasto, EstadoGastoFijo, Gasto, GastoFijo, MEDIO_LABEL, ORIGEN_LABEL } from '../types';

type Pestana = 'gastos' | 'fijos' | 'categorias';

const primeroDelMes = () => `${hoyISO().slice(0, 8)}01`;

export default function Gastos() {
  const { puede } = useAuth();
  const pestanas: { id: Pestana; titulo: string; ver: boolean }[] = [
    { id: 'gastos', titulo: 'Gastos', ver: true },
    { id: 'fijos', titulo: 'Gastos fijos', ver: true },
    { id: 'categorias', titulo: 'Categorías', ver: puede('gastos.configurar') },
  ];
  const [tab, setTab] = useState<Pestana>('gastos');
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Gastos</h1>
          <p>Gastos del negocio: salen del acumulado de cajas anteriores, o de la caja del día si ahí no alcanza.</p>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {pestanas.filter((p) => p.ver).map((p) => (
          <button key={p.id} role="tab" aria-selected={tab === p.id} className={tab === p.id ? 'active' : ''} onClick={() => setTab(p.id)}>
            {p.titulo}
          </button>
        ))}
      </div>
      {tab === 'gastos' && <ListaGastos />}
      {tab === 'fijos' && <GastosFijos />}
      {tab === 'categorias' && <Categorias />}
    </div>
  );
}

// ------------------------------------------------------------ Lista de gastos

function ListaGastos() {
  const { puede } = useAuth();
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [categoriaId, setCategoria] = useState('');
  const [anulados, setAnulados] = useState(false);
  const { data: categorias } = useCarga(() => api<CategoriaGasto[]>('/gastos/categorias'), []);
  const { data: gastos, recargar } = useCarga(
    () => api<Gasto[]>(`/gastos${qs({ desde, hasta, categoriaId: categoriaId || undefined, anulados: anulados ? 1 : undefined })}`),
    [desde, hasta, categoriaId, anulados],
  );
  const [nuevo, setNuevo] = useState(false);
  const [viendo, setViendo] = useState<Gasto | null>(null);
  const total = gastos?.filter((g) => g.estado === 'REGISTRADO').reduce((s, g) => s + n(g.monto), 0) ?? 0;

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <Campo label="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} /></Campo>
        <Campo label="Hasta"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} /></Campo>
        <Campo label="Categoría">
          <select value={categoriaId} onChange={(e) => setCategoria(e.target.value)}>
            <option value="">Todas</option>
            {categorias?.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
        <label className="check" style={{ height: 36 }}>
          <input type="checkbox" checked={anulados} onChange={(e) => setAnulados(e.target.checked)} /> Ver anulados
        </label>
        <span className="grow" />
        <div className="num"><div className="small muted">Total del período</div><b style={{ fontSize: 20 }}>{money(total)}</b></div>
        {puede('gastos.registrar') && (
          <button className="btn btn-primary" onClick={() => setNuevo(true)}><Icono nombre="mas" /> Registrar gasto</button>
        )}
      </div>
      <div className="card">
        {gastos?.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Salió de</th><th>Registró</th><th className="num">Monto</th></tr>
              </thead>
              <tbody>
                {gastos.map((g) => (
                  <tr key={g.id} className={`clickable${g.estado === 'ANULADO' ? ' muted' : ''}`} onClick={() => setViendo(g)}>
                    <td className="small">{fechaHora(g.fecha)}</td>
                    <td>{g.categoria.nombre}</td>
                    <td>
                      {g.concepto}
                      {g.trabajador && <span className="muted"> · {g.trabajador}</span>}
                      {g.estado === 'ANULADO' && <> <span className="badge danger">Anulado</span></>}
                    </td>
                    <td>
                      {ORIGEN_LABEL[g.origen]}
                      <span className="muted small"> · {MEDIO_LABEL[g.medioPago]}</span>
                    </td>
                    <td className="small">{g.usuario.nombre}</td>
                    <td className="num">{money(g.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Vacio>No hay gastos en este período.</Vacio>
        )}
      </div>
      {nuevo && <GastoModal onClose={() => setNuevo(false)} onListo={() => (setNuevo(false), recargar())} />}
      {viendo && <DetalleGasto gasto={viendo} onClose={() => setViendo(null)} onListo={() => (setViendo(null), recargar())} />}
    </div>
  );
}

function DetalleGasto({ gasto: g, onClose, onListo }: { gasto: Gasto; onClose: () => void; onListo: () => void }) {
  const { puede } = useAuth();
  const avisar = useToast();
  const { data: categorias } = useCarga(() => api<CategoriaGasto[]>('/gastos/categorias'), []);
  const [modo, setModo] = useState<'ver' | 'editar' | 'anular'>('ver');
  const [categoriaId, setCategoria] = useState(g.categoriaId);
  const [concepto, setConcepto] = useState(g.concepto);
  const [trabajador, setTrabajador] = useState(g.trabajador ?? '');
  const [nota, setNota] = useState(g.nota ?? '');
  const [motivo, setMotivo] = useState('');
  const editable = g.estado === 'REGISTRADO' && puede('gastos.anular');
  const cat = categorias?.find((c) => c.id === categoriaId);

  const guardar = async () => {
    try {
      if (modo === 'editar') {
        await api(`/gastos/${g.id}`, { method: 'PATCH', body: { categoriaId, concepto, trabajador: trabajador.trim() || null, nota: nota.trim() || null } });
        avisar('Gasto corregido');
      } else {
        await api(`/gastos/${g.id}/anular`, { body: { motivo } });
        avisar(g.origen === 'CAJA' ? 'Gasto anulado; el dinero volvió a la caja' : 'Gasto anulado; el dinero volvió al acumulado');
      }
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  return (
    <Modal
      titulo={`Gasto #${g.id}`}
      onClose={onClose}
      pie={
        modo === 'ver' ? (
          <>
            {editable && <button className="btn" onClick={() => setModo('anular')}>Anular</button>}
            {editable && <button className="btn" onClick={() => setModo('editar')}><Icono nombre="editar" /> Corregir</button>}
            <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setModo('ver')}>Volver</button>
            <button
              className={`btn ${modo === 'anular' ? 'btn-danger' : 'btn-primary'}`}
              onClick={guardar}
              disabled={modo === 'anular' ? motivo.trim().length < 3 : concepto.trim().length < 3 || (!!cat?.pideTrabajador && !trabajador.trim())}
            >
              {modo === 'anular' ? 'Anular gasto' : 'Guardar'}
            </button>
          </>
        )
      }
    >
      {modo === 'editar' ? (
        <div className="grid-2">
          <p className="muted small span-2" style={{ margin: 0 }}>El monto y de dónde salió no se cambian: para eso anula el gasto y regístralo de nuevo.</p>
          <Campo label="Categoría">
            <select value={categoriaId} onChange={(e) => setCategoria(Number(e.target.value))}>
              {categorias?.filter((c) => c.activo || c.id === g.categoriaId).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Trabajador"><input value={trabajador} onChange={(e) => setTrabajador(e.target.value)} /></Campo>
          <Campo label="Concepto" className="span-2"><input value={concepto} onChange={(e) => setConcepto(e.target.value)} /></Campo>
          <Campo label="Nota" className="span-2"><input value={nota} onChange={(e) => setNota(e.target.value)} /></Campo>
        </div>
      ) : (
        <div className="stack">
          <table className="balance">
            <tbody>
              <tr><td>Fecha</td><td>{fechaHora(g.fecha)}</td></tr>
              <tr><td>Categoría</td><td>{g.categoria.nombre}{g.gastoFijo && <span className="muted"> · gasto fijo {g.gastoFijo.nombre} ({g.periodo})</span>}</td></tr>
              <tr><td>Concepto</td><td>{g.concepto}</td></tr>
              {g.trabajador && <tr><td>Trabajador</td><td>{g.trabajador}</td></tr>}
              <tr><td>Salió de</td><td>{ORIGEN_LABEL[g.origen]} · {MEDIO_LABEL[g.medioPago]}{g.numeroOperacion && <span className="mono"> · op. {g.numeroOperacion}</span>}</td></tr>
              {g.nota && <tr><td>Nota</td><td>{g.nota}</td></tr>}
              <tr><td>Registró</td><td>{g.usuario.nombre}</td></tr>
              <tr className="balance-total"><td>Monto</td><td className="num">{money(g.monto)}</td></tr>
              {g.estado === 'ANULADO' && (
                <tr><td>Anulado</td><td><span className="badge danger">Anulado</span> {fechaHora(g.fechaAnulacion)} por {g.anuladoPor?.nombre}: {g.motivoAnulacion}</td></tr>
              )}
            </tbody>
          </table>
          {modo === 'anular' && (
            <Campo label="Motivo de la anulación" ayuda={g.origen === 'CAJA' ? 'El dinero vuelve a la caja del día (solo si sigue abierta).' : 'El dinero vuelve al acumulado.'}>
              <input value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus />
            </Campo>
          )}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------ Gastos fijos

const ESTADO_FIJO: Record<EstadoGastoFijo, { texto: (d: number) => string; badge: string }> = {
  PAGADO: { texto: () => 'Pagado', badge: 'ok' },
  VENCIDO: { texto: (d) => `Vencido hace ${-d} d`, badge: 'danger' },
  HOY: { texto: () => 'Toca hoy', badge: 'danger' },
  PROXIMO: { texto: (d) => `En ${d} d`, badge: 'warn' },
  PENDIENTE: { texto: (d) => `En ${d} d`, badge: '' },
};

function GastosFijos() {
  const { puede } = useAuth();
  const avisar = useToast();
  const { data: fijos, recargar } = useCarga(() => api<GastoFijo[]>('/gastos/fijos'), []);
  const [editando, setEditando] = useState<GastoFijo | 'nuevo' | null>(null);
  const [pagando, setPagando] = useState<AvisoGastoFijo | null>(null);
  const configura = puede('gastos.configurar');

  const eliminar = async (f: GastoFijo) => {
    if (!confirm(`¿Eliminar el gasto fijo «${f.nombre}»?`)) return;
    try {
      const r = await api<{ desactivado: boolean }>(`/gastos/fijos/${f.id}`, { method: 'DELETE' });
      avisar(r.desactivado ? 'Ya tenía pagos: quedó desactivado' : 'Gasto fijo eliminado');
      recargar();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <p className="muted grow" style={{ margin: 0 }}>Alquiler, internet, sueldos… El sistema avisa en Inicio 3 días antes del día de pago y cuando ya venció.</p>
        {configura && <button className="btn btn-primary" onClick={() => setEditando('nuevo')}><Icono nombre="mas" /> Nuevo gasto fijo</button>}
      </div>
      <div className="card">
        {fijos?.length ? (
          <table>
            <thead><tr><th>Gasto</th><th>Categoría</th><th>Día de pago</th><th className="num">Monto ref.</th><th>Este mes</th><th /></tr></thead>
            <tbody>
              {fijos.map((f) => (
                <tr key={f.id} className={f.activo ? '' : 'muted'}>
                  <td>{f.nombre}{f.trabajador && <span className="muted"> · {f.trabajador}</span>}{!f.activo && <> <span className="badge">Inactivo</span></>}</td>
                  <td>{f.categoria.nombre}</td>
                  <td>Día {f.diaPago}</td>
                  <td className="num">{f.monto != null ? money(f.monto) : <span className="muted">Varía</span>}</td>
                  <td>
                    {f.activo && !f.meses.length && <span className="small muted">El primer aviso es el próximo mes</span>}
                    {f.meses.map((m) => (
                      <div key={m.periodo} className="row" style={{ gap: 6 }}>
                        <span className={`badge ${ESTADO_FIJO[m.estado].badge}`}>{ESTADO_FIJO[m.estado].texto(m.dias)}</span>
                        <span className="small muted">{fecha(m.fecha)}</span>
                        {m.estado !== 'PAGADO' && puede('gastos.registrar') && (
                          <button className="btn btn-sm" onClick={() => setPagando({ ...m, gastoFijoId: f.id, nombre: f.nombre, categoria: f.categoria, monto: f.monto, trabajador: f.trabajador })}>Pagar</button>
                        )}
                      </div>
                    ))}
                  </td>
                  <td className="actions">
                    {configura && (
                      <>
                        <button className="btn btn-sm" onClick={() => setEditando(f)} aria-label={`Editar ${f.nombre}`}><Icono nombre="editar" tam={16} /></button>
                        <button className="btn btn-sm" onClick={() => eliminar(f)} aria-label={`Eliminar ${f.nombre}`}><Icono nombre="borrar" tam={16} /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Vacio>No hay gastos fijos. {configura ? 'Crea uno para que el sistema te avise cuando toca pagarlo.' : ''}</Vacio>
        )}
      </div>
      {editando && <GastoFijoModal fijo={editando === 'nuevo' ? null : editando} onClose={() => setEditando(null)} onListo={() => (setEditando(null), recargar())} />}
      {pagando && <GastoModal fijo={pagando} onClose={() => setPagando(null)} onListo={() => (setPagando(null), recargar())} />}
    </div>
  );
}

function GastoFijoModal({ fijo, onClose, onListo }: { fijo: GastoFijo | null; onClose: () => void; onListo: () => void }) {
  const avisar = useToast();
  const { data: categorias } = useCarga(() => api<CategoriaGasto[]>('/gastos/categorias'), []);
  const [nombre, setNombre] = useState(fijo?.nombre ?? '');
  const [categoriaId, setCategoria] = useState<number | ''>(fijo?.categoriaId ?? '');
  const [diaPago, setDia] = useState(String(fijo?.diaPago ?? ''));
  const [monto, setMonto] = useState(fijo?.monto != null ? String(n(fijo.monto)) : '');
  const [trabajador, setTrabajador] = useState(fijo?.trabajador ?? '');
  const [activo, setActivo] = useState(fijo?.activo ?? true);
  const cat = categorias?.find((c) => c.id === categoriaId);
  const dia = Number(diaPago);
  const listo = nombre.trim().length >= 2 && categoriaId !== '' && Number.isInteger(dia) && dia >= 1 && dia <= 31;

  const guardar = async () => {
    try {
      await api(fijo ? `/gastos/fijos/${fijo.id}` : '/gastos/fijos', {
        method: fijo ? 'PUT' : 'POST',
        body: { nombre, categoriaId, diaPago: dia, monto: monto === '' ? null : n(monto), trabajador: trabajador.trim() || null, activo },
      });
      avisar('Gasto fijo guardado');
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  return (
    <Modal
      titulo={fijo ? 'Editar gasto fijo' : 'Nuevo gasto fijo'}
      onClose={onClose}
      pie={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={!listo}>Guardar</button>
        </>
      }
    >
      <div className="grid-2">
        <Campo label="Nombre" className="span-2"><input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Alquiler del local" autoFocus /></Campo>
        <Campo label="Categoría">
          <select value={categoriaId} onChange={(e) => setCategoria(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Elige…</option>
            {categorias?.filter((c) => c.activo || c.id === fijo?.categoriaId).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </Campo>
        <Campo label="Día de pago" ayuda="Del 1 al 31; en meses cortos, el último día">
          <input className="num" type="number" min="1" max="31" value={diaPago} onChange={(e) => setDia(e.target.value)} />
        </Campo>
        <Campo label="Monto de referencia" ayuda="Déjalo vacío si cambia cada mes (luz, agua)">
          <input className="num" type="number" min="0" step="0.1" value={monto} onChange={(e) => setMonto(e.target.value)} />
        </Campo>
        {cat?.pideTrabajador && <Campo label="Trabajador"><input value={trabajador} onChange={(e) => setTrabajador(e.target.value)} /></Campo>}
        {fijo && (
          <label className="check span-2"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo (avisar cada mes)</label>
        )}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------ Categorías

function Categorias() {
  const avisar = useToast();
  const { data: categorias, recargar } = useCarga(() => api<CategoriaGasto[]>('/gastos/categorias'), []);
  const [editando, setEditando] = useState<CategoriaGasto | 'nueva' | null>(null);

  const eliminar = async (c: CategoriaGasto) => {
    if (!confirm(`¿Eliminar la categoría «${c.nombre}»?`)) return;
    try {
      await api(`/gastos/categorias/${c.id}`, { method: 'DELETE' });
      avisar('Categoría eliminada');
      recargar();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <p className="muted grow" style={{ margin: 0 }}>Las categorías con gastos no se eliminan: se desactivan para no perder el historial.</p>
        <button className="btn btn-primary" onClick={() => setEditando('nueva')}><Icono nombre="mas" /> Nueva categoría</button>
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Categoría</th><th>Pide trabajador</th><th className="num">Gastos</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {categorias?.map((c) => (
              <tr key={c.id} className={c.activo ? '' : 'muted'}>
                <td>{c.nombre}</td>
                <td>{c.pideTrabajador ? 'Sí' : 'No'}</td>
                <td className="num">{c._count?.gastos ?? 0}</td>
                <td>{c.activo ? <span className="badge ok">Activa</span> : <span className="badge">Inactiva</span>}</td>
                <td className="actions">
                  <button className="btn btn-sm" onClick={() => setEditando(c)} aria-label={`Editar ${c.nombre}`}><Icono nombre="editar" tam={16} /></button>
                  {!c._count?.gastos && !c._count?.gastosFijos && (
                    <button className="btn btn-sm" onClick={() => eliminar(c)} aria-label={`Eliminar ${c.nombre}`}><Icono nombre="borrar" tam={16} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editando && <CategoriaModal cat={editando === 'nueva' ? null : editando} onClose={() => setEditando(null)} onListo={() => (setEditando(null), recargar())} />}
    </div>
  );
}

function CategoriaModal({ cat, onClose, onListo }: { cat: CategoriaGasto | null; onClose: () => void; onListo: () => void }) {
  const avisar = useToast();
  const [nombre, setNombre] = useState(cat?.nombre ?? '');
  const [pideTrabajador, setPide] = useState(cat?.pideTrabajador ?? false);
  const [activo, setActivo] = useState(cat?.activo ?? true);
  const guardar = async () => {
    try {
      await api(cat ? `/gastos/categorias/${cat.id}` : '/gastos/categorias', { method: cat ? 'PUT' : 'POST', body: { nombre, pideTrabajador, activo } });
      avisar('Categoría guardada');
      onListo();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  };
  return (
    <Modal
      titulo={cat ? 'Editar categoría' : 'Nueva categoría'}
      onClose={onClose}
      pie={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={guardar} disabled={nombre.trim().length < 2}>Guardar</button>
        </>
      }
    >
      <form className="stack" onSubmit={(e) => (e.preventDefault(), nombre.trim().length >= 2 && guardar())}>
        <Campo label="Nombre"><input value={nombre} onChange={(e) => setNombre(e.target.value)} autoFocus /></Campo>
        <label className="check"><input type="checkbox" checked={pideTrabajador} onChange={(e) => setPide(e.target.checked)} /> Pide el nombre del trabajador (sueldos y adelantos)</label>
        {cat && <label className="check"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activa (aparece al registrar gastos)</label>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
