import { montoEnLetras } from './numero-letras';

/** Datos del emisor (Configuración → SUNAT). */
export interface Emisor {
  ruc: string;
  razonSocial: string;
  nombreComercial: string;
  direccion: string;
  ubigeo: string;
  departamento: string;
  provincia: string;
  distrito: string;
  codigoEstablecimiento: string;
}

export type Afectacion = 'GRAVADO' | 'EXONERADO' | 'INAFECTO';

export interface ClienteXml {
  tipoDoc: 'DNI' | 'RUC' | 'CE' | 'SIN_DOCUMENTO';
  numeroDoc: string | null;
  nombre: string;
}

export interface BoletaXml {
  serie: string;
  numero: number;
  fecha: Date;
  cliente: ClienteXml | null;
  descuento: number;
  items: { codigo: string; descripcion: string; cantidad: number; precioUnitario: number; descuento: number; afectacion: Afectacion }[];
}

export const LEYENDA_AMAZONIA = 'BIENES TRANSFERIDOS EN LA AMAZONÍA REGIÓN SELVA PARA SER CONSUMIDOS EN LA MISMA';
const IGV = 0.18;
const NS = [
  'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"',
  'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"',
  'xmlns:ds="http://www.w3.org/2000/09/xmldsig#"',
  'xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"',
].join(' ');

const r2 = (n: number) => Math.round(n * 100) / 100;
const m = (n: number) => r2(n).toFixed(2);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const PEN = 'currencyID="PEN"';

/** Catálogo 05 (tributos) y 07 (afectación IGV). */
const TRIBUTO: Record<Afectacion, { id: string; nombre: string; tipo: string; afectacion: string; porcentaje: number }> = {
  GRAVADO: { id: '1000', nombre: 'IGV', tipo: 'VAT', afectacion: '10', porcentaje: 18 },
  EXONERADO: { id: '9997', nombre: 'EXO', tipo: 'VAT', afectacion: '20', porcentaje: 0 },
  INAFECTO: { id: '9998', nombre: 'INA', tipo: 'FRE', afectacion: '30', porcentaje: 0 },
};

/** Catálogo 06: tipo de documento de identidad. */
export function docCliente(c: ClienteXml | null): { tipo: string; numero: string; nombre: string } {
  if (!c || c.tipoDoc === 'SIN_DOCUMENTO' || !c.numeroDoc) return { tipo: '0', numero: '-', nombre: c?.nombre ?? 'CLIENTES VARIOS' };
  return { tipo: { DNI: '1', RUC: '6', CE: '4' }[c.tipoDoc], numero: c.numeroDoc, nombre: c.nombre };
}

export const fechaLima = (d: Date) => {
  // Fecha y hora de Perú (UTC-5, sin horario de verano).
  const p = new Date(d.getTime() - 5 * 3_600_000).toISOString();
  return { fecha: p.slice(0, 10), hora: p.slice(11, 19) };
};

/** Calcula las líneas con valores sin IGV, repartiendo el descuento global. */
export function calcularLineas(b: BoletaXml) {
  const importes = b.items.map((i) => r2(i.cantidad * i.precioUnitario - i.descuento));
  const subtotal = importes.reduce((s, x) => s + x, 0);
  let restante = r2(b.descuento);
  const lineas = b.items.map((i, k) => {
    const global = k === b.items.length - 1 ? restante : r2(subtotal ? (b.descuento * importes[k]) / subtotal : 0);
    restante = r2(restante - global);
    const factor = i.afectacion === 'GRAVADO' ? 1 + IGV : 1;
    const valorUnitario = i.precioUnitario / factor;
    const base = r2(i.cantidad * valorUnitario);
    const descuento = r2((i.descuento + global) / factor);
    const valorVenta = r2(base - descuento);
    const igv = i.afectacion === 'GRAVADO' ? r2(valorVenta * IGV) : 0;
    return { ...i, valorUnitario, base, descuento, valorVenta, igv };
  });
  const suma = (a: Afectacion) => r2(lineas.filter((l) => l.afectacion === a).reduce((s, l) => s + l.valorVenta, 0));
  const op = { GRAVADO: suma('GRAVADO'), EXONERADO: suma('EXONERADO'), INAFECTO: suma('INAFECTO') };
  const igv = r2(lineas.reduce((s, l) => s + l.igv, 0));
  const valorVenta = r2(op.GRAVADO + op.EXONERADO + op.INAFECTO);
  return { lineas, op, igv, valorVenta, total: r2(valorVenta + igv) };
}

const firmaCab = (e: Emisor) => `
  <cac:Signature>
    <cbc:ID>${e.ruc}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification><cbc:ID>${e.ruc}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name><![CDATA[${e.razonSocial}]]></cbc:Name></cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#SignatureSP</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment>
  </cac:Signature>`;

/** Boleta de venta electrónica (tipo 03) en UBL 2.1, sin firmar. */
export function boletaUbl(b: BoletaXml, e: Emisor): string {
  const { lineas, op, igv, valorVenta, total } = calcularLineas(b);
  const { fecha, hora } = fechaLima(b.fecha);
  const cli = docCliente(b.cliente);
  const subtotalesDoc = (Object.keys(op) as Afectacion[])
    .filter((a) => op[a] > 0 || (a === 'EXONERADO' && valorVenta === 0))
    .map((a) => {
      const t = TRIBUTO[a];
      return `
      <cac:TaxSubtotal>
        <cbc:TaxableAmount ${PEN}>${m(op[a])}</cbc:TaxableAmount>
        <cbc:TaxAmount ${PEN}>${m(a === 'GRAVADO' ? igv : 0)}</cbc:TaxAmount>
        <cac:TaxCategory><cac:TaxScheme><cbc:ID>${t.id}</cbc:ID><cbc:Name>${t.nombre}</cbc:Name><cbc:TaxTypeCode>${t.tipo}</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
      </cac:TaxSubtotal>`;
    })
    .join('');

  const lineasXml = lineas
    .map((l, k) => {
      const t = TRIBUTO[l.afectacion];
      const descuento = l.descuento > 0
        ? `
      <cac:AllowanceCharge>
        <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
        <cbc:AllowanceChargeReasonCode>00</cbc:AllowanceChargeReasonCode>
        <cbc:MultiplierFactorNumeric>${(l.descuento / l.base).toFixed(5)}</cbc:MultiplierFactorNumeric>
        <cbc:Amount ${PEN}>${m(l.descuento)}</cbc:Amount>
        <cbc:BaseAmount ${PEN}>${m(l.base)}</cbc:BaseAmount>
      </cac:AllowanceCharge>`
        : '';
      return `
  <cac:InvoiceLine>
    <cbc:ID>${k + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="NIU">${l.cantidad}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount ${PEN}>${m(l.valorVenta)}</cbc:LineExtensionAmount>
    <cac:PricingReference>
      <cac:AlternativeConditionPrice><cbc:PriceAmount ${PEN}>${m(l.precioUnitario)}</cbc:PriceAmount><cbc:PriceTypeCode>01</cbc:PriceTypeCode></cac:AlternativeConditionPrice>
    </cac:PricingReference>${descuento}
    <cac:TaxTotal>
      <cbc:TaxAmount ${PEN}>${m(l.igv)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount ${PEN}>${m(l.valorVenta)}</cbc:TaxableAmount>
        <cbc:TaxAmount ${PEN}>${m(l.igv)}</cbc:TaxAmount>
        <cac:TaxCategory>
          <cbc:Percent>${t.porcentaje}</cbc:Percent>
          <cbc:TaxExemptionReasonCode>${t.afectacion}</cbc:TaxExemptionReasonCode>
          <cac:TaxScheme><cbc:ID>${t.id}</cbc:ID><cbc:Name>${t.nombre}</cbc:Name><cbc:TaxTypeCode>${t.tipo}</cbc:TaxTypeCode></cac:TaxScheme>
        </cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Description><![CDATA[${l.descripcion}]]></cbc:Description>
      <cac:SellersItemIdentification><cbc:ID>${esc(l.codigo)}</cbc:ID></cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price><cbc:PriceAmount ${PEN}>${Number(l.valorUnitario.toFixed(10))}</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ${NS}>
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>2.0</cbc:CustomizationID>
  <cbc:ID>${b.serie}-${b.numero}</cbc:ID>
  <cbc:IssueDate>${fecha}</cbc:IssueDate>
  <cbc:IssueTime>${hora}</cbc:IssueTime>
  <cbc:InvoiceTypeCode listID="0101">03</cbc:InvoiceTypeCode>
  <cbc:Note languageLocaleID="1000"><![CDATA[${montoEnLetras(total)}]]></cbc:Note>${op.EXONERADO > 0 ? `
  <cbc:Note languageLocaleID="2001"><![CDATA[${LEYENDA_AMAZONIA}]]></cbc:Note>` : ''}
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>${firmaCab(e)}
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="6">${e.ruc}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name><![CDATA[${e.nombreComercial || e.razonSocial}]]></cbc:Name></cac:PartyName>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName><![CDATA[${e.razonSocial}]]></cbc:RegistrationName>
        <cac:RegistrationAddress>
          <cbc:ID>${e.ubigeo}</cbc:ID>
          <cbc:AddressTypeCode>${e.codigoEstablecimiento}</cbc:AddressTypeCode>
          <cbc:CityName>${esc(e.provincia)}</cbc:CityName>
          <cbc:CountrySubentity>${esc(e.departamento)}</cbc:CountrySubentity>
          <cbc:District>${esc(e.distrito)}</cbc:District>
          <cac:AddressLine><cbc:Line><![CDATA[${e.direccion}]]></cbc:Line></cac:AddressLine>
          <cac:Country><cbc:IdentificationCode>PE</cbc:IdentificationCode></cac:Country>
        </cac:RegistrationAddress>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="${cli.tipo}">${esc(cli.numero)}</cbc:ID></cac:PartyIdentification>
      <cac:PartyLegalEntity><cbc:RegistrationName><![CDATA[${cli.nombre}]]></cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount ${PEN}>${m(igv)}</cbc:TaxAmount>${subtotalesDoc}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount ${PEN}>${m(valorVenta)}</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount ${PEN}>${m(total)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount ${PEN}>${m(total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>${lineasXml}
</Invoice>`;
}

export interface BajaXml {
  serie: string;
  numero: number;
  cliente: ClienteXml | null;
  total: number;
  opGravada: number;
  opExonerada: number;
  opInafecta: number;
  igv: number;
}

/** Resumen diario (RC) que informa boletas anuladas (estado 3). */
export function resumenBajaUbl(identificador: string, fechaReferencia: string, fechaGeneracion: string, bajas: BajaXml[], e: Emisor): string {
  const lineas = bajas
    .map((b, k) => {
      const cli = docCliente(b.cliente);
      const pagos = [
        ['01', b.opGravada],
        ['02', b.opExonerada],
        ['03', b.opInafecta],
      ]
        .filter(([, v]) => Number(v) > 0)
        .map(([c, v]) => `
      <sac:BillingPayment><cbc:PaidAmount ${PEN}>${m(Number(v))}</cbc:PaidAmount><cbc:InstructionID>${c}</cbc:InstructionID></sac:BillingPayment>`)
        .join('');
      return `
  <sac:SummaryDocumentsLine>
    <cbc:LineID>${k + 1}</cbc:LineID>
    <cbc:DocumentTypeCode>03</cbc:DocumentTypeCode>
    <cbc:ID>${b.serie}-${b.numero}</cbc:ID>
    <cac:AccountingCustomerParty><cbc:CustomerAssignedAccountID>${esc(cli.numero)}</cbc:CustomerAssignedAccountID><cbc:AdditionalAccountID>${cli.tipo}</cbc:AdditionalAccountID></cac:AccountingCustomerParty>
    <cac:Status><cbc:ConditionCode>3</cbc:ConditionCode></cac:Status>
    <sac:TotalAmount ${PEN}>${m(b.total)}</sac:TotalAmount>${pagos}
    <cac:TaxTotal>
      <cbc:TaxAmount ${PEN}>${m(b.igv)}</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxAmount ${PEN}>${m(b.igv)}</cbc:TaxAmount>
        <cac:TaxCategory><cac:TaxScheme><cbc:ID>1000</cbc:ID><cbc:Name>IGV</cbc:Name><cbc:TaxTypeCode>VAT</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
  </sac:SummaryDocumentsLine>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<SummaryDocuments xmlns="urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1" ${NS} xmlns:sac="urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.0</cbc:UBLVersionID>
  <cbc:CustomizationID>1.1</cbc:CustomizationID>
  <cbc:ID>${identificador}</cbc:ID>
  <cbc:ReferenceDate>${fechaReferencia}</cbc:ReferenceDate>
  <cbc:IssueDate>${fechaGeneracion}</cbc:IssueDate>${firmaCab(e)}
  <cac:AccountingSupplierParty>
    <cbc:CustomerAssignedAccountID>${e.ruc}</cbc:CustomerAssignedAccountID>
    <cbc:AdditionalAccountID>6</cbc:AdditionalAccountID>
    <cac:Party><cac:PartyLegalEntity><cbc:RegistrationName><![CDATA[${e.razonSocial}]]></cbc:RegistrationName></cac:PartyLegalEntity></cac:Party>
  </cac:AccountingSupplierParty>${lineas}
</SummaryDocuments>`;
}
