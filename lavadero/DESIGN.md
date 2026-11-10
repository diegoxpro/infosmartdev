# El Firme — Sistema de diseño

## Idea
**Letrero de patio y comprobante bien impreso.** Se aleja del azul de agua y las burbujas típicas de los autolavados. La referencia es la señalética vial: tinta casi negra, amarillo señal y papel cálido. Sólido, directo, firme.

## Color
| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `papel` (fondo) | `#F5F3EC` | `#121315` | Fondo de pantalla |
| `lamina` (superficie) | `#FFFFFF` | `#1D1E21` | Tarjetas, listas |
| `tinta` | `#16181B` | `#F3F1EA` | Texto principal, botón primario |
| `tintaSuave` | `#5A5D60` | `#A9A9A4` | Texto secundario (mín. 4.5:1) |
| `linea` | `#DDD9CD` | `#34363A` | Divisores |
| `senal` | `#FFC400` | `#FFC400` | Acción de emitir, selección activa. Siempre con texto `#16181B` |

Estados, siempre con palabra además de color:
| Estado | Claro | Oscuro |
|---|---|---|
| Aceptado | `#0B6B3A` | `#5FD28F` |
| Observado | `#8A5A00` | `#F2B84B` |
| Por enviar / en proceso | `#1F4E9E` | `#8DB4F5` |
| Rechazado / error | `#B3261E` | `#FF8F86` |
| Anulado | `#5A5D60` | `#A9A9A4` |

Ingresos usan el verde de Aceptado y gastos el rojo de Rechazado, siempre con signo.

## Tipografía
**Archivo** (variable, OFL): grotesca de carácter rotulado. Números con cifras tabulares (`tnum`).
| Rol | Tamaño / peso |
|---|---|
| Monto principal | 40 sp / 700 |
| Título de pantalla | 26 sp / 700 |
| Título de sección | 18 sp / 650 |
| Cuerpo | 16 sp / 450 |
| Secundario | 14 sp / 450 |
| Etiqueta | 13 sp / 600 |

## Espaciado y forma
- Base 4 dp: 4, 8, 12, 16, 24, 32. Margen lateral 16 dp.
- Radios: 8 dp en controles y 12 dp en tarjetas. Sin sombras: las superficies se separan con `linea`.
- Objetivos táctiles: mínimo 48 dp; acciones principales 56 dp.

## Patrones
- Barra inferior: **Caja · Clientes · Comprobantes · Ajustes**. Indicador activo amarillo. Control SUNAT vive en Ajustes.
- **Emitir** es el único botón amarillo de cada pantalla.
- Listas planas con divisores, sin tarjetas anidadas.
- El comprobante se muestra como ticket real, tal como lo recibe el cliente.
- Errores: dicen qué pasó y qué hacer, junto al lugar del problema.

## Movimiento
Solo transiciones funcionales, de 150 a 200 ms. Nada decorativo.
