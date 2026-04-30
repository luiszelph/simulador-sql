export const EQUIPOS_TABLA_BASE = 'Equipos';

export const EQUIPOS_COLUMNAS = [
  'Id',
  'NombreEquipo',
  'Marca',
  'Precio',
  'HospitalAsignado',
] as const;

export type EquiposColumna = (typeof EQUIPOS_COLUMNAS)[number];

export interface EquipoFila {
  id: number;
  nombreEquipo: string;
  marca: string;
  precio: number;
  hospitalAsignado: string;
}
