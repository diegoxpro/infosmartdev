import QRCode from 'qrcode';
import { fechaHora, money, n, qty } from './format';
import { urlImagen } from './marca';
import { Caja, COMPROBANTE_LABEL, Configuracion, MEDIO_LABEL, Venta } from './types';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export const correlativo = (v: Pick<Venta, 'serie' | 'numero'>) => `${v.serie}-${String(v.numero).padStart(8, '0')}`;

const ESTILO = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; width: 72mm; padding: 3mm 2mm 6mm; font: 12px/1.35 "Courier New", monospace; color: #000; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: bold; }
  .g { font-size: 15px; } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 1px 0; }
`;

/** Imprime en la ticketera (driver de Windows). La gaveta se abre con la opción del driver al imprimir. */
function imprimir(html: string) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.appendChild(f);
  const d = f.contentDocument!;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><style>${ESTILO}</style></head><body>${html}</body></html>`);
  d.close();
  // Espera a que cargue el QR antes de imprimir.
  const imagenes = Array.from(d.images).filter((i) => !i.complete);
  Promise.all(imagenes.map((i) => new Promise((r) => (i.onload = i.onerror = r)))).then(() =>
    setTimeout(() => {
      f.contentWindow!.focus();
      f.contentWindow!.print();
      setTimeout(() => f.remove(), 1000);
    }, 50),
  );
}

function cabecera(cfg: Configuracion) {
  return `<div class="c b g">${esc(cfg.empresaNombre)}</div>
    ${cfg.empresaRazonSocial ? `<div class="c">${esc(cfg.empresaRazonSocial)}</div>` : ''}
    ${cfg.empresaRuc ? `<div class="c">RUC ${esc(cfg.empresaRuc)}</div>` : ''}
    ${cfg.empresaDireccion ? `<div class="c">${esc(cfg.empresaDireccion)}</div>` : ''}`;
}

const TIPO_DOC: Record<string, string> = { DNI: '1', RUC: '6', CE: '4' };
const fechaLocal = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Texto del QR que pide SUNAT para la representación impresa. */
export function textoQr(v: Venta, ruc: string) {
  const doc = v.cliente?.numeroDoc ? [TIPO_DOC[v.cliente.tipoDoc] ?? '0', v.cliente.numeroDoc] : ['0', '-'];
  return [ruc, '03', v.serie, v.numero, n(v.igv).toFixed(2), n(v.total).toFixed(2), fechaLocal(v.fecha), ...doc, v.hashCpe].join('|') + '|';
}

export async function imprimirVenta(v: Venta, cfg: Configuracion) {
  const electronica = v.tipoComprobante === 'BOLETA' && !!v.hashCpe && !!cfg.empresaRuc;
  // La boleta libre es un documento interno: se imprime como nota de venta.
  const titulo = v.tipoComprobante === 'BOLETA' ? (electronica ? 'BOLETA DE VENTA ELECTRÓNICA' : 'BOLETA DE VENTA') : 'NOTA DE VENTA';
  const qr = electronica ? await QRCode.toDataURL(textoQr(v, cfg.empresaRuc!), { margin: 0, width: 150, errorCorrectionLevel: 'Q' }) : null;
  const items = (v.items ?? [])
    .map(
      (i) => `<tr><td colspan="3">${esc(i.descripcion)}</td></tr>
      <tr><td>${qty(i.cantidad)} x ${n(i.precioUnitario).toFixed(2)}</td>
      <td class="r">${n(i.descuento) > 0 ? `-${n(i.descuento).toFixed(2)}` : ''}</td>
      <td class="r">${n(i.subtotal).toFixed(2)}</td></tr>`,
    )
    .join('');
  const pagos = v.pagos.map((p) => `<tr><td>${MEDIO_LABEL[p.medioPago]}${p.numeroOperacion ? ` ${esc(p.numeroOperacion)}` : ''}</td><td class="r">${n(p.monto).toFixed(2)}</td></tr>`).join('');
  const logo = urlImagen('LOGO_BOLETA');
  imprimir(`${logo ? `<div class="c"><img src="${location.origin}${logo}" style="max-width:60mm;max-height:30mm"></div>` : ''}
    ${cabecera(cfg)}
    <hr><div class="c b">${titulo}</div><div class="c b">${correlativo(v)}</div>
    <div>Fecha: ${esc(fechaHora(v.fecha))}</div>
    <div>Cliente: ${esc(v.cliente?.nombre ?? 'PÚBLICO GENERAL')}</div>
    ${v.cliente?.numeroDoc ? `<div>${esc(v.cliente.tipoDoc)}: ${esc(v.cliente.numeroDoc)}</div>` : ''}
    <div>Cajero: ${esc(v.usuario.nombre)}</div>
    <hr><table>${items}</table><hr>
    <table>
      ${n(v.descuento) > 0 ? `<tr><td>Descuento</td><td class="r">-${n(v.descuento).toFixed(2)}</td></tr>` : ''}
      ${n(v.opExonerada) > 0 ? `<tr><td>Op. exonerada</td><td class="r">${n(v.opExonerada).toFixed(2)}</td></tr>` : ''}
      ${n(v.opGravada) > 0 ? `<tr><td>Op. gravada</td><td class="r">${n(v.opGravada).toFixed(2)}</td></tr><tr><td>IGV 18%</td><td class="r">${n(v.igv).toFixed(2)}</td></tr>` : ''}
      <tr class="b g"><td>TOTAL</td><td class="r">${money(v.total)}</td></tr>
    </table><hr>
    <table>${pagos}
      ${v.efectivoRecibido ? `<tr><td>Efectivo recibido</td><td class="r">${n(v.efectivoRecibido).toFixed(2)}</td></tr><tr class="b"><td>Vuelto</td><td class="r">${n(v.vuelto).toFixed(2)}</td></tr>` : ''}
    </table>
    ${n(v.opExonerada) > 0 ? '<hr><div class="c">Bienes transferidos en la Amazonía Región Selva para ser consumidos en la misma</div>' : ''}
    ${qr ? `<hr><div class="c"><img src="${qr}" style="width:30mm;height:30mm"></div>
      <div class="c" style="font-size:10px">Hash: ${esc(v.hashCpe)}</div>
      <div class="c" style="font-size:10px">Representación impresa de la Boleta de Venta Electrónica. Consulte su documento en www.sunat.gob.pe</div>` : ''}
    ${cfg.mensajeTicket ? `<hr><div class="c">${esc(cfg.mensajeTicket)}</div>` : ''}`);
}

export function imprimirCierre(c: Caja, cfg: Configuracion) {
  const r = c.resumen!;
  const fila = (a: string, b: string) => `<tr><td>${a}</td><td class="r">${b}</td></tr>`;
  imprimir(`${cabecera(cfg)}
    <hr><div class="c b">CIERRE DE CAJA #${c.id}</div>
    ${c.sinCuadrar ? '<div class="c b">** CERRADA SIN CUADRAR **</div>' : ''}
    <div>Apertura: ${esc(fechaHora(c.fechaApertura))} (${esc(c.usuarioApertura.nombre)})</div>
    <div>Cierre: ${esc(fechaHora(c.fechaCierre))} (${esc(c.usuarioCierre?.nombre)})</div><hr>
    <table>
      ${r.porComprobante.map((p) => fila(`${COMPROBANTE_LABEL[p.tipo]} (${p.cantidad})`, p.total.toFixed(2))).join('')}
      ${fila('<b>Total ventas</b>', `<b>${r.totalVentas.toFixed(2)}</b>`)}
      ${r.anuladas.cantidad ? fila(`Anuladas (${r.anuladas.cantidad})`, r.anuladas.total.toFixed(2)) : ''}
      ${r.sinComprobante?.total ? fila('Ventas sin comprobante', r.sinComprobante.total.toFixed(2)) : ''}
    </table><hr><div class="b">EFECTIVO</div><table>
      ${fila('Efectivo inicial', n(r.montoInicial).toFixed(2))}
      ${fila('Ventas en efectivo', n(r.porMedio.EFECTIVO).toFixed(2))}
      ${r.sinComprobante ? fila('Ventas sin comprob.', n(r.sinComprobante.porMedio.EFECTIVO).toFixed(2)) : ''}
      ${fila('Otros ingresos', r.ingresos.toFixed(2))}
      ${r.retiros == null
        ? fila('Gastos y retiros', `-${n(r.gastos ?? r.egresos).toFixed(2)}`)
        : fila('Gastos', `-${n(r.gastos).toFixed(2)}`) + fila('Retiros', `-${n(r.retiros).toFixed(2)}`)}
      ${r.pagosProveedor != null ? fila('Pagos a proveedores', `-${r.pagosProveedor.toFixed(2)}`) : ''}
      ${fila('<b>Total efectivo en caja</b>', `<b>${r.efectivoEsperado.toFixed(2)}</b>`)}
      ${fila('<b>Efectivo contado</b>', `<b>${n(r.efectivoContado).toFixed(2)}</b>`)}
      ${fila('<b>Diferencia</b>', `<b>${n(r.diferencia).toFixed(2)}</b>`)}
    </table><hr><div class="b">DIGITAL</div><table>
      ${c.sinCuadrar && r.digital?.some((d) => d.sistema > 0)
        ? r.digital.filter((d) => d.sistema > 0).map((d) => fila(
            `${MEDIO_LABEL[d.medio]} (sist. ${d.sistema.toFixed(2)})`,
            d.confirmado == null ? 'sin confirmar' : `${d.confirmado.toFixed(2)} (dif ${(d.confirmado - d.sistema).toFixed(2)})`,
          )).join('')
        : Object.entries(r.totalPorMedio ?? r.porMedio).filter(([m, v]) => m !== 'EFECTIVO' && v > 0).map(([m, v]) => fila(MEDIO_LABEL[m as keyof typeof MEDIO_LABEL], v.toFixed(2))).join('') || fila('Sin ventas digitales', '0.00')}
    </table><hr><table>
      ${(r.conteo ?? []).filter((x) => x.cantidad > 0).map((x) => fila(`${x.cantidad} x S/ ${x.denominacion.toFixed(2)}`, (x.cantidad * x.denominacion).toFixed(2))).join('')}
    </table>
    ${r.alAcumulado ? `<hr><div class="b">PASA AL ACUMULADO</div><table>${fila('Efectivo', r.alAcumulado.efectivo.toFixed(2))}${fila('Yape', r.alAcumulado.yape.toFixed(2))}${fila('Queda en caja', r.alAcumulado.quedaEnCaja.toFixed(2))}</table>` : ''}
    ${c.observacion ? `<hr><div>Obs: ${esc(c.observacion)}</div>` : ''}
    <br><br><div class="c">______________________</div><div class="c">Firma</div>`);
}
