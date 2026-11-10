import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Compras from './pages/Compras';
import CompraDetalle from './pages/CompraDetalle';
import Acumulado from './pages/Acumulado';
import Caja from './pages/Caja';
import Clientes from './pages/Clientes';
import Configuracion from './pages/Configuracion';
import CuentasPorPagar from './pages/CuentasPorPagar';
import Gastos from './pages/Gastos';
import Inicio from './pages/Inicio';
import Inventario from './pages/Inventario';
import Login from './pages/Login';
import NuevaCompra from './pages/NuevaCompra';
import Productos from './pages/Productos';
import Proveedores from './pages/Proveedores';
import RealizarInventario from './pages/RealizarInventario';
import Reportes from './pages/Reportes';
import Venta from './pages/Venta';
import Ventas from './pages/Ventas';

// Solo la cargan los celulares (trae el lector de códigos de barras).
const MovilInventario = lazy(() => import('./pages/MovilInventario'));

export default function App() {
  const { usuario, listo, puede } = useAuth();
  const { pathname } = useLocation();
  // Celular del inventario: entra con el QR, sin usuario del sistema.
  if (pathname.startsWith('/m/')) return <Suspense fallback={null}><MovilInventario /></Suspense>;
  if (!listo) return null;
  if (!usuario) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Inicio />} />
        {puede('ventas.vender') && <Route path="venta" element={<Venta />} />}
        <Route path="caja" element={<Caja />} />
        {puede('ventas.ver') && <Route path="ventas" element={<Ventas />} />}
        <Route path="clientes" element={<Clientes />} />
        {(['ventas', 'compras', 'kardex', 'sunat', 'gastos'] as const).map(
          (c) => puede(`reportes.${c}`) && <Route key={c} path={`reportes/${c}`} element={<Reportes key={c} categoria={c} />} />,
        )}
        <Route path="productos" element={<Productos />} />
        <Route path="inventario" element={<Inventario />} />
        {puede('inventario.realizar') && <Route path="inventario/realizar" element={<RealizarInventario />} />}
        {puede('compras.ver') && <Route path="compras" element={<Compras />} />}
        {puede('compras.registrar') && <Route path="compras/nueva" element={<NuevaCompra />} />}
        {puede('compras.ver') && <Route path="compras/:id" element={<CompraDetalle />} />}
        {puede('compras.ver') && <Route path="cuentas-por-pagar" element={<CuentasPorPagar />} />}
        <Route path="proveedores" element={<Proveedores />} />
        {(puede('gastos.registrar') || puede('gastos.configurar')) && <Route path="gastos" element={<Gastos />} />}
        {(puede('gastos.registrar') || puede('acumulado.contar') || puede('acumulado.retirar')) && <Route path="acumulado" element={<Acumulado />} />}
        <Route path="configuracion" element={<Configuracion />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
