export type SqlColumnTypeName =
  | 'INTEGER'
  | 'REAL'
  | 'TEXT'
  | 'BOOLEAN'
  | 'JSON';

export interface ColumnDefinition {
  readonly name: string;
  readonly sqlType: SqlColumnTypeName;
}

export interface TableDefinition {
  readonly name: string;
  readonly columns: readonly ColumnDefinition[];
}

export interface TableState {
  readonly definition: TableDefinition;
  readonly rows: readonly Record<string, unknown>[];
}

export type SqlResultKind = 'success' | 'error' | 'select';

export interface SqlExecutionResult {
  readonly kind: SqlResultKind;
  readonly message: string;
  /** Filas devueltas por SELECT (objetos planos serializables). */
  readonly rows?: readonly Record<string, unknown>[];
  readonly columns?: readonly string[];
  readonly affectedRows?: number;
  /** Tabla asociada a la última operación (para la vista de datos). */
  readonly relatedTable?: string;
}

export interface EmulatorDatabaseState {
  readonly tables: Record<string, TableState>;
}
