import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api';

export type TipoImagen = 'LOGO' | 'FAVICON' | 'LOGO_BOLETA';
export interface Marca {
  nombre: string;
  versiones: Record<TipoImagen, number | null>;
}

const VACIA: Marca = { nombre: "Candy's Market", versiones: { LOGO: null, FAVICON: null, LOGO_BOLETA: null } };

/** Última marca cargada, para el ticket (que se arma fuera de React). */
let actual: Marca = VACIA;
export const marcaActual = () => actual;

/** URL de la imagen, o null si no hay. La versión en la URL evita que el navegador muestre la anterior. */
export function urlImagen(tipo: TipoImagen, m: Marca = actual) {
  const v = m.versiones[tipo];
  return v ? `/api/configuracion/imagenes/${tipo}?v=${v}` : null;
}

const Ctx = createContext<{ marca: Marca; setMarca: (m: Marca) => void }>({ marca: VACIA, setMarca: () => {} });

export function MarcaProvider({ children }: { children: ReactNode }) {
  const [marca, setEstado] = useState<Marca>(VACIA);
  const setMarca = useCallback((m: Marca) => {
    actual = m;
    setEstado(m);
  }, []);
  useEffect(() => {
    api<Marca>('/configuracion/imagenes').then(setMarca, () => {});
  }, [setMarca]);
  // Favicon de la pestaña.
  useEffect(() => {
    const url = urlImagen('FAVICON', marca);
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!url) {
      link?.remove();
      return;
    }
    if (!link) {
      link = Object.assign(document.createElement('link'), { rel: 'icon' });
      document.head.appendChild(link);
    }
    link.type = 'image/png';
    link.href = url;
  }, [marca]);
  return <Ctx.Provider value={{ marca, setMarca }}>{children}</Ctx.Provider>;
}

export const useMarca = () => useContext(Ctx);

/** Medidas a las que se reduce cada imagen antes de subirla. */
const MEDIDAS: Record<TipoImagen, { ancho: number; alto: number; cuadrado?: boolean; ticket?: boolean }> = {
  LOGO: { ancho: 512, alto: 512 },
  FAVICON: { ancho: 64, alto: 64, cuadrado: true },
  // 72 mm de ancho útil en una ticketera de 203 ppp son unos 576 puntos.
  LOGO_BOLETA: { ancho: 576, alto: 320, ticket: true },
};

/**
 * Reduce la imagen al tamaño que se usa y la convierte a PNG (base64, sin el prefijo data:).
 * El logo de la boleta queda en escala de grises sobre fondo blanco, como lo imprime la ticketera.
 */
export async function prepararImagen(archivo: File, tipo: TipoImagen): Promise<string> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error('No se pudo leer la imagen. Usa PNG, JPG, WEBP o ICO.'));
      i.src = url;
    });
    const m = MEDIDAS[tipo];
    const escala = Math.min(1, m.ancho / img.naturalWidth, m.alto / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * escala));
    const h = Math.max(1, Math.round(img.naturalHeight * escala));
    const lienzo = document.createElement('canvas');
    lienzo.width = m.cuadrado ? m.ancho : w;
    lienzo.height = m.cuadrado ? m.alto : h;
    const ctx = lienzo.getContext('2d')!;
    if (m.ticket) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, lienzo.width, lienzo.height);
    }
    // El favicon se centra en un cuadrado sin deformarse.
    const fw = m.cuadrado ? Math.min(m.ancho, Math.round(img.naturalWidth * Math.min(m.ancho / img.naturalWidth, m.alto / img.naturalHeight))) : w;
    const fh = m.cuadrado ? Math.min(m.alto, Math.round(img.naturalHeight * Math.min(m.ancho / img.naturalWidth, m.alto / img.naturalHeight))) : h;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (lienzo.width - fw) / 2, (lienzo.height - fh) / 2, fw, fh);
    if (m.ticket) {
      const px = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
      const d = px.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        d[i] = d[i + 1] = d[i + 2] = g;
      }
      ctx.putImageData(px, 0, 0);
    }
    return lienzo.toDataURL('image/png').split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}
