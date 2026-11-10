import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { ApiError } from './api';
import { Campo, Modal } from './components/ui';

export interface Autorizacion {
  usuario: string;
  password: string;
}

type Ejecutar = <T>(accion: (aut?: Autorizacion) => Promise<T>, motivo?: string) => Promise<T>;
const Ctx = createContext<Ejecutar>((a) => a());

/**
 * Envuelve operaciones que un cajero solo puede hacer con la clave de un
 * administrador (descuentos, anulaciones). Si el servidor la pide, muestra
 * el diálogo y reintenta con la autorización.
 */
export function AutorizacionProvider({ children }: { children: ReactNode }) {
  const [pedido, setPedido] = useState<{ motivo: string; resolver: (a: Autorizacion | null) => void } | null>(null);
  const [error, setError] = useState('');
  const [usuario, setUsuario] = useState('admin');
  const [password, setPassword] = useState('');
  const pedirRef = useRef<(motivo: string, err?: string) => Promise<Autorizacion | null>>(null!);

  pedirRef.current = (motivo, err = '') =>
    new Promise((resolver) => {
      setError(err);
      setPassword('');
      setPedido({ motivo, resolver });
    });

  const ejecutar = useCallback<Ejecutar>(async (accion, motivo = 'Esta operación necesita la clave de un administrador') => {
    try {
      return await accion();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 403) throw e;
      let msg = '';
      for (;;) {
        const aut = await pedirRef.current(motivo, msg);
        if (!aut) throw new Error('Operación cancelada');
        try {
          return await accion(aut);
        } catch (e2) {
          if (!(e2 instanceof ApiError) || e2.status !== 403) throw e2;
          msg = e2.message;
        }
      }
    }
  }, []);

  const cerrar = (a: Autorizacion | null) => {
    pedido?.resolver(a);
    setPedido(null);
  };

  return (
    <Ctx.Provider value={ejecutar}>
      {children}
      {pedido && (
        <Modal
          titulo="Autorización del administrador"
          onClose={() => cerrar(null)}
          pie={
            <>
              <button className="btn" onClick={() => cerrar(null)}>Cancelar</button>
              <button className="btn btn-primary" form="form-autorizacion" disabled={!usuario || !password}>Autorizar</button>
            </>
          }
        >
          <form id="form-autorizacion" className="stack" onSubmit={(e) => (e.preventDefault(), cerrar({ usuario, password }))}>
            <p className="muted" style={{ margin: 0 }}>{pedido.motivo}</p>
            {error && <div className="alert danger">{error}</div>}
            <div className="grid-2">
              <Campo label="Usuario administrador"><input value={usuario} onChange={(e) => setUsuario(e.target.value)} /></Campo>
              <Campo label="Clave"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="off" /></Campo>
            </div>
          </form>
        </Modal>
      )}
    </Ctx.Provider>
  );
}

export const useAutorizacion = () => useContext(Ctx);
