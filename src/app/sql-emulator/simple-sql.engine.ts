import type {
  ColumnDefinition,
  EmulatorDatabaseState,
  SqlColumnTypeName,
  SqlExecutionResult,
  TableState,
} from './models/sql-emulator.models';

export class SqlEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlEngineError';
  }
}

type ParsedStatement =
  | { kind: 'create'; table: string; columns: ColumnDefinition[] }
  | {
      kind: 'insert';
      table: string;
      columns: string[] | null;
      values: unknown[];
    }
  | {
      kind: 'update';
      table: string;
      assignments: Record<string, unknown>;
      where: WhereClause | null;
    }
  | { kind: 'delete'; table: string; where: WhereClause | null }
  | {
      kind: 'select';
      table: string;
      columns: string[] | '*';
      where: WhereClause | null;
    };

interface WhereClause {
  readonly column: string;
  readonly operator: '=' | '!=' | '<' | '>' | '<=' | '>=';
  readonly value: unknown;
}

function normalizeSql(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => normalizeSql(s))
    .filter((s) => s.length > 0);
}

function mapSqlType(raw: string): SqlColumnTypeName {
  const t = raw.toUpperCase();
  if (t === 'INT' || t === 'INTEGER') {
    return 'INTEGER';
  }
  if (t === 'FLOAT' || t === 'DOUBLE' || t === 'REAL') {
    return 'REAL';
  }
  if (t === 'TEXT' || t === 'STRING' || t === 'VARCHAR') {
    return 'TEXT';
  }
  if (t === 'BOOL' || t === 'BOOLEAN') {
    return 'BOOLEAN';
  }
  if (t === 'JSON') {
    return 'JSON';
  }
  throw new SqlEngineError(`Tipo de columna no soportado: ${raw}`);
}

function parseCreateTable(sql: string): ParsedStatement {
  const m = /^CREATE\s+TABLE\s+(\w+)\s*\((.+)\)\s*$/i.exec(sql);
  if (!m) {
    throw new SqlEngineError('CREATE TABLE: sintaxis inválida.');
  }
  const table = m[1];
  const body = m[2];
  const parts = splitColumnList(body);
  const columns: ColumnDefinition[] = parts.map((part) => {
    const tokens = part.trim().split(/\s+/);
    if (tokens.length < 2) {
      throw new SqlEngineError(`Definición de columna inválida: ${part}`);
    }
    const name = tokens[0];
    const sqlType = mapSqlType(tokens[1]);
    return { name, sqlType };
  });
  if (columns.length === 0) {
    throw new SqlEngineError('La tabla debe tener al menos una columna.');
  }
  return { kind: 'create', table, columns };
}

function splitColumnList(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '(') {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      buf += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) {
    out.push(buf.trim());
  }
  return out;
}

function parseInsert(sql: string): ParsedStatement {
  const m = /^INSERT\s+INTO\s+(\w+)\s*(?:\(([^)]*)\))?\s*VALUES\s*\((.+)\)\s*$/i.exec(
    sql,
  );
  if (!m) {
    throw new SqlEngineError('INSERT: sintaxis inválida.');
  }
  const table = m[1];
  const colListRaw = m[2]?.trim();
  const columns =
    colListRaw && colListRaw.length > 0
      ? colListRaw.split(',').map((c) => c.trim())
      : null;
  const values = parseValuesList(m[3]);
  return { kind: 'insert', table, columns, values };
}

function parseValuesList(inner: string): unknown[] {
  const tokens = tokenizeValues(inner);
  return tokens.map(parseLiteral);
}

function tokenizeValues(inner: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  let inString: "'" | '"' | null = null;
  let depth = 0;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (inString) {
      buf += ch;
      if (ch === inString && inner[i - 1] !== '\\') {
        inString = null;
      }
      continue;
    }
    if ((ch === "'" || ch === '"') && depth === 0) {
      inString = ch;
      buf += ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth -= 1;
      buf += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      tokens.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) {
    tokens.push(buf.trim());
  }
  return tokens;
}

function parseLiteral(token: string): unknown {
  const t = token.trim();
  if (t.length === 0) {
    throw new SqlEngineError('Valor vacío en lista VALUES.');
  }
  const lower = t.toLowerCase();
  if (lower === 'null') {
    return null;
  }
  if (lower === 'true') {
    return true;
  }
  if (lower === 'false') {
    return false;
  }
  if (/^-?\d+$/.test(t)) {
    return Number.parseInt(t, 10);
  }
  if (/^-?\d+\.\d+$/.test(t)) {
    return Number.parseFloat(t);
  }
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"'))
  ) {
    return t.slice(1, -1).replaceAll("\\'", "'").replaceAll('\\"', '"');
  }
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t) as unknown;
    } catch {
      throw new SqlEngineError('JSON inválido en VALUES.');
    }
  }
  throw new SqlEngineError(`Literal no reconocido: ${t}`);
}

function parseWhere(sql: string): { rest: string; where: WhereClause | null } {
  const idx = sql.toUpperCase().lastIndexOf(' WHERE ');
  if (idx === -1) {
    return { rest: sql, where: null };
  }
  const rest = sql.slice(0, idx).trim();
  const clause = sql.slice(idx + ' WHERE '.length).trim();
  const wm = /^(\w+)\s*(=|!=|<=|>=|<|>)\s*(.+)$/i.exec(clause);
  if (!wm) {
    throw new SqlEngineError('WHERE: condición no soportada.');
  }
  const column = wm[1];
  const operator = wm[2] as WhereClause['operator'];
  const value = parseLiteral(wm[3].trim());
  return { rest, where: { column, operator, value } };
}

function parseUpdate(sql: string): ParsedStatement {
  const upper = sql.toUpperCase();
  if (!upper.startsWith('UPDATE ')) {
    throw new SqlEngineError('UPDATE: sintaxis inválida.');
  }
  const { rest: beforeWhere, where } = parseWhere(sql);
  const m = /^UPDATE\s+(\w+)\s+SET\s+(.+)$/i.exec(beforeWhere);
  if (!m) {
    throw new SqlEngineError('UPDATE: sintaxis inválida.');
  }
  const table = m[1];
  const assignments = parseAssignments(m[2]);
  return { kind: 'update', table, assignments, where };
}

function parseAssignments(body: string): Record<string, unknown> {
  const parts = splitAssignments(body);
  const out: Record<string, unknown> = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      throw new SqlEngineError(`Asignación inválida: ${part}`);
    }
    const col = part.slice(0, eq).trim();
    const rawVal = part.slice(eq + 1).trim();
    out[col] = parseLiteral(rawVal);
  }
  return out;
}

function splitAssignments(body: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inString: "'" | '"' | null = null;
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      buf += ch;
      if (ch === inString && body[i - 1] !== '\\') {
        inString = null;
      }
      continue;
    }
    if ((ch === "'" || ch === '"') && depth === 0) {
      inString = ch;
      buf += ch;
      continue;
    }
    if (ch === '{' || ch === '[') {
      depth += 1;
      buf += ch;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth -= 1;
      buf += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim().length > 0) {
    out.push(buf.trim());
  }
  return out;
}

function parseDelete(sql: string): ParsedStatement {
  const { rest, where } = parseWhere(sql);
  const m = /^DELETE\s+FROM\s+(\w+)\s*$/i.exec(rest);
  if (!m) {
    throw new SqlEngineError('DELETE: sintaxis inválida.');
  }
  return { kind: 'delete', table: m[1], where };
}

function parseSelect(sql: string): ParsedStatement {
  const { rest, where } = parseWhere(sql);
  const m = /^SELECT\s+(.+?)\s+FROM\s+(\w+)\s*$/i.exec(rest);
  if (!m) {
    throw new SqlEngineError('SELECT: sintaxis inválida.');
  }
  const colsRaw = m[1].trim();
  const table = m[2];
  const columns: string[] | '*' =
    colsRaw === '*' ? '*' : colsRaw.split(',').map((c) => c.trim());
  return { kind: 'select', table, columns, where };
}

function parseStatement(sql: string): ParsedStatement {
  const normalized = normalizeSql(sql);
  const head = normalized.split(/\s+/)[0]?.toUpperCase() ?? '';
  switch (head) {
    case 'CREATE':
      return parseCreateTable(normalized);
    case 'INSERT':
      return parseInsert(normalized);
    case 'UPDATE':
      return parseUpdate(normalized);
    case 'DELETE':
      return parseDelete(normalized);
    case 'SELECT':
      return parseSelect(normalized);
    default:
      throw new SqlEngineError(
        'Solo se admiten CREATE TABLE, INSERT, UPDATE, DELETE y SELECT.',
      );
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function rowMatches(row: Record<string, unknown>, w: WhereClause | null): boolean {
  if (!w) {
    return true;
  }
  const left = row[w.column];
  const right = w.value;
  switch (w.operator) {
    case '=':
      return deepEqual(left, right);
    case '!=':
      return !deepEqual(left, right);
    case '<':
      return Number(left) < Number(right);
    case '>':
      return Number(left) > Number(right);
    case '<=':
      return Number(left) <= Number(right);
    case '>=':
      return Number(left) >= Number(right);
    default:
      return false;
  }
}

function coerceForColumn(type: SqlColumnTypeName, value: unknown): unknown {
  if (value === null) {
    return null;
  }
  switch (type) {
    case 'INTEGER':
      return Math.trunc(Number(value));
    case 'REAL':
      return Number(value);
    case 'TEXT':
      return String(value);
    case 'BOOLEAN': {
      if (typeof value === 'boolean') {
        return value;
      }
      const s = String(value).toLowerCase();
      if (s === 'true' || s === '1') {
        return true;
      }
      if (s === 'false' || s === '0') {
        return false;
      }
      return Boolean(value);
    }
    case 'JSON':
      if (typeof value === 'string') {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return value;
        }
      }
      return value;
    default:
      return value;
  }
}

function getColumnType(
  table: TableState,
  columnName: string,
): SqlColumnTypeName {
  const col = table.definition.columns.find((c) => c.name === columnName);
  if (!col) {
    throw new SqlEngineError(`Columna desconocida: ${columnName}`);
  }
  return col.sqlType;
}

function assertTable(
  state: EmulatorDatabaseState,
  name: string,
): TableState {
  const t = state.tables[name];
  if (!t) {
    throw new SqlEngineError(`La tabla "${name}" no existe.`);
  }
  return t;
}

function cloneState(state: EmulatorDatabaseState): EmulatorDatabaseState {
  const tables: Record<string, TableState> = {};
  for (const key of Object.keys(state.tables)) {
    const t = state.tables[key];
    tables[key] = {
      definition: t.definition,
      rows: t.rows.map((r) => ({ ...r })),
    };
  }
  return { tables };
}

function projectRow(
  row: Record<string, unknown>,
  columns: string[] | '*',
  definition: TableState['definition'],
): Record<string, unknown> {
  if (columns === '*') {
    const out: Record<string, unknown> = {};
    for (const c of definition.columns) {
      out[c.name] = row[c.name];
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const name of columns) {
    if (!definition.columns.some((c) => c.name === name)) {
      throw new SqlEngineError(`Columna desconocida en SELECT: ${name}`);
    }
    out[name] = row[name];
  }
  return out;
}

function executeStatement(
  state: EmulatorDatabaseState,
  stmt: ParsedStatement,
): { state: EmulatorDatabaseState; result: SqlExecutionResult } {
  const next = cloneState(state);
  switch (stmt.kind) {
    case 'create': {
      if (next.tables[stmt.table]) {
        throw new SqlEngineError(`La tabla "${stmt.table}" ya existe.`);
      }
      next.tables[stmt.table] = {
        definition: { name: stmt.table, columns: stmt.columns },
        rows: [],
      };
      return {
        state: next,
        result: {
          kind: 'success',
          message: `Tabla "${stmt.table}" creada.`,
          affectedRows: 0,
          relatedTable: stmt.table,
        },
      };
    }
    case 'insert': {
      const table = assertTable(next, stmt.table);
      const def = table.definition;
      const targetCols =
        stmt.columns ??
        def.columns.map((c) => c.name);
      if (targetCols.length !== stmt.values.length) {
        throw new SqlEngineError(
          'INSERT: el número de columnas y valores no coincide.',
        );
      }
      for (const colName of targetCols) {
        getColumnType(table, colName);
      }
      const row: Record<string, unknown> = {};
      for (const c of def.columns) {
        row[c.name] = null;
      }
      for (let i = 0; i < targetCols.length; i += 1) {
        const colName = targetCols[i];
        const type = getColumnType(table, colName);
        row[colName] = coerceForColumn(type, stmt.values[i]);
      }
      const newRows = [...table.rows, row];
      next.tables[stmt.table] = { definition: def, rows: newRows };
      return {
        state: next,
        result: {
          kind: 'success',
          message: `Se insertó 1 fila en "${stmt.table}".`,
          affectedRows: 1,
          relatedTable: stmt.table,
        },
      };
    }
    case 'update': {
      const table = assertTable(next, stmt.table);
      let affected = 0;
      const newRows = table.rows.map((r) => {
        if (!rowMatches(r, stmt.where)) {
          return r;
        }
        const updated: Record<string, unknown> = { ...r };
        for (const [col, val] of Object.entries(stmt.assignments)) {
          const type = getColumnType(table, col);
          updated[col] = coerceForColumn(type, val);
        }
        affected += 1;
        return updated;
      });
      next.tables[stmt.table] = {
        definition: table.definition,
        rows: newRows,
      };
      return {
        state: next,
        result: {
          kind: 'success',
          message: `Se actualizaron ${affected} fila(s) en "${stmt.table}".`,
          affectedRows: affected,
          relatedTable: stmt.table,
        },
      };
    }
    case 'delete': {
      const table = assertTable(next, stmt.table);
      const kept = table.rows.filter((r) => !rowMatches(r, stmt.where));
      const affected = table.rows.length - kept.length;
      next.tables[stmt.table] = {
        definition: table.definition,
        rows: kept,
      };
      return {
        state: next,
        result: {
          kind: 'success',
          message: `Se eliminaron ${affected} fila(s) de "${stmt.table}".`,
          affectedRows: affected,
          relatedTable: stmt.table,
        },
      };
    }
    case 'select': {
      const table = assertTable(next, stmt.table);
      const filtered = table.rows.filter((r) => rowMatches(r, stmt.where));
      const projected = filtered.map((r) =>
        projectRow(r, stmt.columns, table.definition),
      );
      const cols =
        stmt.columns === '*'
          ? table.definition.columns.map((c) => c.name)
          : stmt.columns;
      return {
        state: next,
        result: {
          kind: 'select',
          message: `${projected.length} fila(s).`,
          rows: projected,
          columns: cols,
          affectedRows: projected.length,
          relatedTable: stmt.table,
        },
      };
    }
    default: {
      const _exhaustive: never = stmt;
      return _exhaustive;
    }
  }
}

export function runSqlScript(
  sql: string,
  state: EmulatorDatabaseState,
): { state: EmulatorDatabaseState; result: SqlExecutionResult } {
  const parts = splitStatements(sql);
  if (parts.length === 0) {
    return {
      state,
      result: { kind: 'error', message: 'Escribe al menos una sentencia SQL.' },
    };
  }
  try {
    let current = cloneState(state);
    let last: SqlExecutionResult = {
      kind: 'success',
      message: '',
      affectedRows: 0,
    };
    for (const part of parts) {
      const stmt = parseStatement(part);
      const { state: after, result } = executeStatement(current, stmt);
      current = after;
      last = result;
    }
    return { state: current, result: last };
  } catch (e) {
    const message =
      e instanceof SqlEngineError
        ? e.message
        : e instanceof Error
          ? e.message
          : 'Error inesperado al ejecutar SQL.';
    return {
      state,
      result: { kind: 'error', message },
    };
  }
}
