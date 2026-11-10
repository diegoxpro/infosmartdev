import { createContext, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useContext } from 'react';
import { api, sesion } from './api';
import { ClavePermiso, Usuario } from './types';

interface AuthCtx {
  usuario: Usuario | null;
  listo: boolean;
  esAdmin: boolean;
  /** ¿El usuario tiene este permiso ahora? (rol + permisos propios vigentes) */
  puede: (permiso: ClavePermiso) => boolean;
  entrar: (usuario: string, password: string) => Promise<void>;
  salir: () => void;
  /** Vuelve a pedir los permisos al servidor. */
  refrescar: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null!);

/** Cada cuánto se revisan los permisos (por si el admin los cambió). */
const REVISAR_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [listo, setListo] = useState(false);

  const refrescar = useCallback(async () => {
    if (!sesion.token()) return;
    try {
      setUsuario(await api<Usuario>('/auth/yo'));
    } catch (e) {
      // Sin conexión con el servidor no cerramos la sesión; sí si fue rechazada.
      if ((e as { status?: number }).status === 401) {
        sesion.borrar();
        setUsuario(null);
      }
    }
  }, []);

  useEffect(() => {
    if (!sesion.token()) return setListo(true);
    api<Usuario>('/auth/yo')
      .then(setUsuario)
      .catch(() => sesion.borrar())
      .finally(() => setListo(true));
  }, []);

  // Revisa cada minuto y al volver a la ventana; y justo cuando vence un permiso temporal.
  useEffect(() => {
    if (!usuario) return;
    const t = setInterval(refrescar, REVISAR_MS);
    const alVolver = () => document.visibilityState === 'visible' && refrescar();
    document.addEventListener('visibilitychange', alVolver);
    const vencimientos = usuario.permisos.map((p) => (p.hasta ? new Date(p.hasta).getTime() - Date.now() : Infinity)).filter((ms) => ms > 0);
    const proximo = Math.min(...vencimientos);
    const v = proximo < REVISAR_MS ? setTimeout(refrescar, proximo + 500) : undefined;
    return () => {
      clearInterval(t);
      clearTimeout(v);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [usuario, refrescar]);

  const entrar = async (u: string, password: string) => {
    const r = await api<{ token: string; usuario: Usuario }>('/auth/login', { body: { usuario: u, password } });
    sesion.guardar(r.token);
    setUsuario(r.usuario);
  };

  const salir = () => {
    sesion.borrar();
    setUsuario(null);
  };

  const valor = useMemo<AuthCtx>(() => {
    const ahora = Date.now();
    const mios = new Set(
      (usuario?.permisos ?? []).filter((p) => !p.hasta || new Date(p.hasta).getTime() > ahora).map((p) => p.permiso),
    );
    return { usuario, listo, esAdmin: usuario?.rol === 'ADMIN', puede: (p) => mios.has(p), entrar, salir, refrescar };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario, listo, refrescar]);

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
