import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ReactNode, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { urlImagen, useMarca } from '../marca';
import { veConfiguracion } from '../pages/Configuracion';
import { venceTexto } from '../format';
import { Alertas } from '../types';
import { Icono, NombreIcono } from './icons';
import { useCarga } from './ui';

function Enlace({ to, icono, children, end }: { to: string; icono: NombreIcono; children: ReactNode; end?: boolean }) {
  return (
    <NavLink to={to} end={end}>
      <Icono nombre={icono} />
      <span className="grow">{children}</span>
    </NavLink>
  );
}

/** Secciones del menú que el usuario dejó abiertas o cerradas (solo en esta PC). */
const CLAVE_MENU = 'candys.menu';
const ABIERTAS_INICIO: Record<string, boolean> = { ventas: true, compras: true, gastos: true, almacen: true, reportes: false };
function leerMenu(): Record<string, boolean> {
  try {
    return { ...ABIERTAS_INICIO, ...JSON.parse(localStorage.getItem(CLAVE_MENU) ?? '{}') };
  } catch {
    return ABIERTAS_INICIO;
  }
}

function Seccion({ id, titulo, icono, rutas, abiertas, alternar, children }: {
  id: string;
  titulo: string;
  icono: NombreIcono;
  rutas: string[];
  abiertas: Record<string, boolean>;
  alternar: (id: string, valor?: boolean) => void;
  children: ReactNode;
}) {
  const { pathname } = useLocation();
  const activa = rutas.some((r) => pathname === r || pathname.startsWith(`${r}/`));
  // Al entrar a una pantalla de la sección, se abre sola.
  useEffect(() => {
    if (activa && !abiertas[id]) alternar(id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activa]);
  const abierta = !!abiertas[id];
  return (
    <div className="nav-seccion">
      <button
        type="button"
        className={`nav-titulo${activa ? ' activa' : ''}`}
        aria-expanded={abierta}
        aria-controls={`menu-${id}`}
        onClick={() => alternar(id)}
      >
        <Icono nombre={icono} />
        <span className="grow">{titulo}</span>
        <Icono nombre="flecha" tam={14} className={`nav-flecha${abierta ? ' abierta' : ''}`} />
      </button>
      {abierta && <div className="nav-sub" id={`menu-${id}`}>{children}</div>}
    </div>
  );
}

export default function Layout() {
  const { usuario, salir, puede } = useAuth();
  const rolNombre = usuario?.rol === 'ADMIN' ? 'Administrador' : (usuario?.perfil?.nombre ?? 'Personal');
  // Permisos dados solo por un tiempo: se avisa hasta cuándo valen.
  const temporales = (usuario?.permisos ?? []).filter((p) => p.origen === 'USUARIO' && p.hasta);
  const hayReportes = (['reportes.ventas', 'reportes.compras', 'reportes.kardex', 'reportes.sunat', 'reportes.gastos'] as const).some(puede);
  const veGastos = puede('gastos.registrar') || puede('gastos.configurar');
  const veAcumulado = puede('gastos.registrar') || puede('acumulado.contar') || puede('acumulado.retirar');
  const { data: alertas } = useCarga(() => api<Alertas>('/inventario/alertas'), []);
  const { marca } = useMarca();
  const logo = urlImagen('LOGO', marca);
  const nAlertas = alertas ? alertas.stockBajo.length + alertas.vencidos.length + alertas.porVencer.length : 0;
  const [abiertas, setAbiertas] = useState(leerMenu);
  const alternar = (id: string, valor?: boolean) =>
    setAbiertas((a) => {
      const n = { ...a, [id]: valor ?? !a[id] };
      try {
        localStorage.setItem(CLAVE_MENU, JSON.stringify(n));
      } catch {
        /* sin almacenamiento: el menú igual funciona */
      }
      return n;
    });
  const sec = { abiertas, alternar };

  return (
    <div className="app">
      <aside className="sidebar">
        {logo ? (
          <div className="brand brand-logo">
            <img src={logo} alt={marca.nombre} />
          </div>
        ) : (
          <div className="brand">
            <div className="brand-mark">C</div>
            <div>
              <b>Candy's Market</b>
              <span>Sistema de ventas</span>
            </div>
          </div>
        )}
        <nav className="nav">
          <NavLink to="/" end>
            <Icono nombre="inicio" />
            <span className="grow">Inicio</span>
            {nAlertas > 0 && <span className="pill" aria-label={`${nAlertas} alertas`}>{nAlertas}</span>}
          </NavLink>
          <Seccion id="ventas" titulo="Ventas" icono="venta" rutas={['/venta', '/caja', '/ventas', '/clientes']} {...sec}>
            {puede('ventas.vender') && <Enlace to="/venta" icono="venta">Venta</Enlace>}
            <Enlace to="/caja" icono="caja">Caja</Enlace>
            {puede('ventas.ver') && <Enlace to="/ventas" icono="lista">Ventas realizadas</Enlace>}
            <Enlace to="/clientes" icono="clientes">Clientes</Enlace>
          </Seccion>
          <Seccion id="compras" titulo="Compras" icono="compras" rutas={['/compras', '/cuentas-por-pagar', '/proveedores']} {...sec}>
            {puede('compras.ver') && <Enlace to="/compras" icono="compras">Compras</Enlace>}
            {puede('compras.ver') && <Enlace to="/cuentas-por-pagar" icono="pagar">Cuentas por pagar</Enlace>}
            <Enlace to="/proveedores" icono="proveedores">Proveedores</Enlace>
          </Seccion>
          {(veGastos || veAcumulado) && (
            <Seccion id="gastos" titulo="Gastos" icono="gasto" rutas={['/gastos', '/acumulado']} {...sec}>
              {veGastos && <Enlace to="/gastos" icono="gasto">Gastos</Enlace>}
              {veAcumulado && <Enlace to="/acumulado" icono="acumulado">Acumulado</Enlace>}
            </Seccion>
          )}
          <Seccion id="almacen" titulo="Almacén" icono="inventario" rutas={['/productos', '/inventario']} {...sec}>
            <Enlace to="/productos" icono="productos">Productos</Enlace>
            <Enlace to="/inventario" icono="inventario" end>Inventario y mermas</Enlace>
            {puede('inventario.realizar') && <Enlace to="/inventario/realizar" icono="kardex">Realizar inventario</Enlace>}
          </Seccion>
          {hayReportes && (
            <Seccion id="reportes" titulo="Reportes" icono="reportes" rutas={['/reportes']} {...sec}>
              {puede('reportes.ventas') && <Enlace to="/reportes/ventas" icono="venta">Reporte de venta</Enlace>}
              {puede('reportes.compras') && <Enlace to="/reportes/compras" icono="compras">Reporte de compra</Enlace>}
              {puede('reportes.kardex') && <Enlace to="/reportes/kardex" icono="kardex">Reporte de kardex</Enlace>}
              {puede('reportes.gastos') && <Enlace to="/reportes/gastos" icono="gasto">Reporte de gastos</Enlace>}
              {puede('reportes.sunat') && <Enlace to="/reportes/sunat" icono="lista">Boletas SUNAT</Enlace>}
            </Seccion>
          )}
          <Enlace to="/configuracion" icono="config">{veConfiguracion(puede) ? 'Configuración' : 'Mi cuenta'}</Enlace>
        </nav>
        <div className="sidebar-foot">
          <div className="avatar" aria-hidden="true">{usuario?.nombre.charAt(0).toUpperCase()}</div>
          <div className="grow quien">
            <b>{usuario?.nombre}</b>
            {/* El rol solo se muestra si no repite el nombre (p. ej. el usuario "Administrador"). */}
            {usuario && usuario.nombre.toLowerCase() !== rolNombre.toLowerCase() && <span>{rolNombre}</span>}
          </div>
          <button className="salir" onClick={salir} title="Cerrar sesión" aria-label="Cerrar sesión">
            <Icono nombre="salir" />
          </button>
        </div>
      </aside>
      <main className="main">
        {temporales.length > 0 && (
          <div className="aviso aviso-info aviso-temporal" role="status">
            {temporales.map((p) => (
              <div key={p.permiso}>Tienes permiso para <b>{(p.nombre ?? p.permiso).toLowerCase()}</b> {venceTexto(p.hasta!)}</div>
            ))}
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
