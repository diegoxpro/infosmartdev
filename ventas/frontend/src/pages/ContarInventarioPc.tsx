import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Contador } from './MovilInventario';

interface Respuesta {
  inventario: { id: number; estado: 'EN_CURSO' | 'REVISION' } | null;
  operador: { token: string; nombre: string } | null;
}

/**
 * Conteo de inventario desde la PC: la cajera (o el administrador) cuenta como
 * un operador más, con el lector de códigos de la caja, sin escanear el QR.
 */
export function ContarDesdePc() {
  const { usuario } = useAuth();
  const [r, setR] = useState<Respuesta | null>(null);
  const [error, setError] = useState('');

  const obtener = useCallback(async () => {
    try {
      setR(await api<Respuesta>('/toma-inventario/contar-pc', { method: 'POST' }));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    obtener();
    // Si el administrador inicia o cierra un inventario, esta pantalla se entera sola.
    const t = setInterval(obtener, 10000);
    return () => clearInterval(t);
  }, [obtener]);

  const token = r?.operador?.token;
  const nombre = r?.operador?.nombre;
  const op = useMemo(() => (token && nombre ? { token, nombre } : null), [token, nombre]);

  if (!r) return error ? <div className="alert danger">{error}</div> : null;
  if (!op) {
    return (
      <div className="card card-pad">
        <p style={{ margin: 0 }}>
          {r.inventario
            ? 'El administrador ya cerró el conteo de este inventario.'
            : 'No hay un inventario en curso. Cuando el administrador lo inicie, aquí podrás ir contando productos.'}
        </p>
      </div>
    );
  }
  return <Contador key={op.token} op={op} claveCola={`candys.inv.cola.pc.${usuario?.id ?? 0}`} alSalir={obtener} enPc />;
}

/** Página "Realizar inventario" para la cajera: solo contar. */
export default function ContarInventarioPc() {
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Realizar inventario</h1>
          <p>Cuenta productos con el lector de códigos de la caja. Puedes ir a vender y volver: lo contado no se pierde.</p>
        </div>
      </div>
      <ContarDesdePc />
    </div>
  );
}
