import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import type { WorkBook, WorkSheet } from 'xlsx';

import {
  EQUIPOS_COLUMNAS,
  EQUIPOS_TABLA_BASE,
  type EquipoFila,
  type EquiposColumna,
} from './equipos-excel.models';

const FORMATO_MONEDA = '$#,##0.00';
const FORMATO_TEXTO = '@';
const FORMATO_ID_ENTERO = '0';

const ULTIMA_COL = EQUIPOS_COLUMNAS.length - 1;

@Injectable()
export class EquiposExcelService {
  private readonly platformId = inject(PLATFORM_ID);

  readonly filas = signal<EquipoFila[]>([]);
  readonly mensaje = signal<string | null>(null);

  /** Nombre de la tabla emulada (fijo; al importar se ignora fecha/hora y sufijos del nombre de archivo). */
  readonly nombreTablaEmulada = EQUIPOS_TABLA_BASE;

  readonly tieneDatos = computed(() => this.filas().length > 0);

  /**
   * Nombre de archivo sugerido: Equipos_dd_mm_yyyy_hh_mm_ss_mmm (mmm = milisegundos, 3 dígitos).
   */
  generarNombreArchivoPlantilla(fecha: Date = new Date()): string {
    const dd = String(fecha.getDate()).padStart(2, '0');
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const yyyy = String(fecha.getFullYear());
    const hh = String(fecha.getHours()).padStart(2, '0');
    const min = String(fecha.getMinutes()).padStart(2, '0');
    const ss = String(fecha.getSeconds()).padStart(2, '0');
    const mmm = String(fecha.getMilliseconds()).padStart(3, '0');
    return `${EQUIPOS_TABLA_BASE}_${dd}_${mm}_${yyyy}_${hh}_${min}_${ss}_${mmm}`;
  }

  agregarFila(parcial: Omit<EquipoFila, 'id'>): void {
    const fila: EquipoFila = {
      id: this.siguienteId(),
      ...parcial,
    };
    this.filas.update((actual) => [...actual, fila]);
    this.mensaje.set('Fila agregada a la tabla emulada.');
  }

  async descargarPlantilla(): Promise<void> {
    if (!this.esNavegador()) {
      return;
    }
    const nombreArchivo = this.generarNombreArchivoPlantilla();
    const XLSX = await import('xlsx');
    const hoja = this.crearHojaBase(XLSX, nombreArchivo, true);
    const libro: WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, EQUIPOS_TABLA_BASE);
    XLSX.writeFile(libro, `${nombreArchivo}.xlsx`);
    this.mensaje.set('Plantilla descargada.');
  }

  async descargarDatosExcel(): Promise<void> {
    if (!this.esNavegador()) {
      return;
    }
    const nombreArchivo = this.generarNombreArchivoPlantilla();
    const XLSX = await import('xlsx');
    const hoja = this.crearHojaBase(XLSX, nombreArchivo, false);
    const filas = this.filas();
    let r = 2;
    const indiceMoneda = EQUIPOS_COLUMNAS.indexOf('Precio');
    const indiceId = EQUIPOS_COLUMNAS.indexOf('Id');
    for (const f of filas) {
      const valores: (string | number)[] = [
        f.id,
        f.nombreEquipo,
        f.marca,
        f.precio,
        f.hospitalAsignado,
      ];
      for (let c = 0; c < valores.length; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const valor = valores[c];
        if (c === indiceMoneda) {
          hoja[addr] = { t: 'n', v: Number(valor), z: FORMATO_MONEDA };
        } else if (c === indiceId) {
          hoja[addr] = { t: 'n', v: Number(valor), z: FORMATO_ID_ENTERO };
        } else {
          hoja[addr] = { t: 's', v: String(valor ?? ''), z: FORMATO_TEXTO };
        }
      }
      r++;
    }
    hoja['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(r - 1, 1), c: ULTIMA_COL },
    });
    const libro: WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, EQUIPOS_TABLA_BASE);
    XLSX.writeFile(libro, `${nombreArchivo}.xlsx`);
    this.mensaje.set('Excel con datos descargado.');
  }

  async importarArchivo(archivo: File): Promise<void> {
    if (!this.esNavegador()) {
      return;
    }
    this.mensaje.set(null);

    const XLSX = await import('xlsx');
    const buffer = await archivo.arrayBuffer();
    const libro = XLSX.read(buffer, { type: 'array' });
    const primeraHoja = libro.SheetNames[0];
    if (!primeraHoja) {
      this.mensaje.set('El archivo no contiene hojas.');
      return;
    }
    const hoja = libro.Sheets[primeraHoja];
    if (!hoja) {
      this.mensaje.set('No se pudo leer la hoja de cálculo.');
      return;
    }
    const matriz = XLSX.utils.sheet_to_json<(string | number | null)[]>(hoja, {
      header: 1,
      defval: '',
      raw: true,
    }) as (string | number | null | undefined)[][];

    const indiceEncabezado = this.buscarIndiceEncabezado(matriz);
    if (indiceEncabezado < 0) {
      this.mensaje.set('No se encontró la fila de encabezados esperada (debe incluir Id al inicio).');
      return;
    }

    const indices = this.mapearColumnas(matriz[indiceEncabezado] ?? []);
    if (!indices) {
      this.mensaje.set('Las columnas no coinciden con la plantilla.');
      return;
    }

    const idInicio = this.filas().length === 0 ? 1 : this.maxId() + 1;
    const nuevasFilas = this.extraerFilas(matriz, indiceEncabezado + 1, indices, idInicio);
    if (nuevasFilas.length === 0) {
      this.mensaje.set('No hay filas de datos debajo del encabezado.');
      return;
    }

    if (this.filas().length === 0) {
      this.filas.set(nuevasFilas);
      this.mensaje.set(
        `Tabla "${this.nombreTablaEmulada}" creada con ${nuevasFilas.length} fila(s). Archivo: ${archivo.name}.`,
      );
    } else {
      this.filas.update((actual) => [...actual, ...nuevasFilas]);
      this.mensaje.set(
        `Se insertaron ${nuevasFilas.length} fila(s) en la tabla "${this.nombreTablaEmulada}".`,
      );
    }
  }

  trackPorId(_: number, fila: EquipoFila): number {
    return fila.id;
  }

  private esNavegador(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  private maxId(): number {
    const actuales = this.filas();
    if (actuales.length === 0) {
      return 0;
    }
    return Math.max(...actuales.map((f) => f.id));
  }

  /** Siguiente id entero (1, 2, 3, …) según las filas ya presentes. */
  private siguienteId(): number {
    return this.maxId() + 1;
  }

  private crearHojaBase(
    XLSX: typeof import('xlsx'),
    textoPrimeraFila: string,
    incluirFilasVaciasFormateadas: boolean,
  ): WorkSheet {
    const datos: (string | number)[][] = [[textoPrimeraFila], [...EQUIPOS_COLUMNAS]];
    if (incluirFilasVaciasFormateadas) {
      for (let i = 0; i < 5; i++) {
        datos.push(Array(EQUIPOS_COLUMNAS.length).fill(''));
      }
    }
    const hoja = XLSX.utils.aoa_to_sheet(datos);
    hoja['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: ULTIMA_COL } }];
    const celdasTitulo = XLSX.utils.encode_cell({ r: 0, c: 0 });
    hoja[celdasTitulo] = {
      t: 's',
      v: textoPrimeraFila,
      z: FORMATO_TEXTO,
    };
    for (let c = 0; c < EQUIPOS_COLUMNAS.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: 1, c });
      const celda = hoja[addr];
      if (celda && typeof celda === 'object') {
        (celda as { z?: string }).z = FORMATO_TEXTO;
      }
    }
    const indiceMoneda = EQUIPOS_COLUMNAS.indexOf('Precio');
    const indiceId = EQUIPOS_COLUMNAS.indexOf('Id');
    if (incluirFilasVaciasFormateadas) {
      for (let r = 2; r < 7; r++) {
        for (let c = 0; c < EQUIPOS_COLUMNAS.length; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          if (c === indiceMoneda) {
            hoja[addr] = { t: 'n', v: 0, z: FORMATO_MONEDA };
          } else if (c === indiceId) {
            hoja[addr] = { t: 's', v: '', z: FORMATO_TEXTO };
          } else {
            hoja[addr] = { t: 's', v: '', z: FORMATO_TEXTO };
          }
        }
      }
    }
    return hoja;
  }

  private buscarIndiceEncabezado(matriz: (string | number | null | undefined)[][]): number {
    for (let i = 0; i < matriz.length; i++) {
      const fila = matriz[i] ?? [];
      const texto = fila.map((c) => String(c ?? '').trim());
      if (
        texto.includes('Id') &&
        texto.includes('NombreEquipo') &&
        texto.includes('Marca') &&
        texto.includes('Precio') &&
        texto.includes('HospitalAsignado')
      ) {
        const idxId = texto.indexOf('Id');
        const idxNombre = texto.indexOf('NombreEquipo');
        if (idxId >= 0 && idxNombre >= 0 && idxId < idxNombre) {
          return i;
        }
      }
    }
    return -1;
  }

  private mapearColumnas(
    encabezado: (string | number | null | undefined)[],
  ): Record<EquiposColumna, number> | null {
    const normalizado = encabezado.map((c) => String(c ?? '').trim());
    const mapa: Partial<Record<EquiposColumna, number>> = {};
    for (const col of EQUIPOS_COLUMNAS) {
      const idx = normalizado.indexOf(col);
      if (idx < 0) {
        return null;
      }
      mapa[col] = idx;
    }
    return mapa as Record<EquiposColumna, number>;
  }

  private extraerFilas(
    matriz: (string | number | null | undefined)[][],
    inicio: number,
    indices: Record<EquiposColumna, number>,
    idInicio: number,
  ): EquipoFila[] {
    const resultado: EquipoFila[] = [];
    let siguiente = idInicio;
    for (let r = inicio; r < matriz.length; r++) {
      const fila = matriz[r] ?? [];
      const nombre = String(fila[indices.NombreEquipo] ?? '').trim();
      const marca = String(fila[indices.Marca] ?? '').trim();
      const hospital = String(fila[indices.HospitalAsignado] ?? '').trim();
      const precioBruto = fila[indices.Precio];
      const precio = this.normalizarPrecio(precioBruto);
      if (!nombre && !marca && !hospital && (precioBruto === '' || precioBruto === null || precioBruto === undefined)) {
        continue;
      }
      if (!nombre) {
        continue;
      }
      resultado.push({
        id: siguiente++,
        nombreEquipo: nombre,
        marca,
        precio: Number.isFinite(precio) ? precio : 0,
        hospitalAsignado: hospital,
      });
    }
    return resultado;
  }

  private normalizarPrecio(valor: string | number | null | undefined): number {
    if (typeof valor === 'number' && Number.isFinite(valor)) {
      return valor;
    }
    const texto = String(valor ?? '').trim();
    if (!texto) {
      return 0;
    }
    const sinSimbolos = texto.replace(/[^\d.,-]/g, '');
    const tieneComa = sinSimbolos.includes(',');
    const tienePunto = sinSimbolos.includes('.');
    let normalizado = sinSimbolos;
    if (tieneComa && tienePunto) {
      const ultimaComa = sinSimbolos.lastIndexOf(',');
      const ultimoPunto = sinSimbolos.lastIndexOf('.');
      if (ultimaComa > ultimoPunto) {
        normalizado = sinSimbolos.replace(/\./g, '').replace(',', '.');
      } else {
        normalizado = sinSimbolos.replace(/,/g, '');
      }
    } else if (tieneComa && !tienePunto) {
      normalizado = sinSimbolos.replace(',', '.');
    }
    const numero = Number(normalizado);
    return Number.isFinite(numero) ? numero : 0;
  }
}
