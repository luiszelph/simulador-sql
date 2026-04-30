import { computed, Injectable, signal } from '@angular/core';

import type {
  EmulatorDatabaseState,
  SqlExecutionResult,
  TableState,
} from './models/sql-emulator.models';
import { runSqlScript } from './simple-sql.engine';

const INITIAL_STATE: EmulatorDatabaseState = { tables: {} };

@Injectable({ providedIn: 'root' })
export class SqlEmulatorService {
  private readonly databaseState = signal<EmulatorDatabaseState>(INITIAL_STATE);
  private readonly viewTableName = signal<string | null>(null);

  readonly database = this.databaseState.asReadonly();
  readonly lastResult = signal<SqlExecutionResult | null>(null);
  readonly activeTableName = this.viewTableName.asReadonly();

  readonly activeTable = computed<TableState | null>(() => {
    const name = this.viewTableName();
    if (!name) {
      return null;
    }
    return this.databaseState().tables[name] ?? null;
  });

  readonly catalogTableNames = computed(() =>
    Object.keys(this.databaseState().tables).sort(),
  );

  execute(sql: string): void {
    const { state, result } = runSqlScript(sql, this.databaseState());
    this.lastResult.set(result);
    if (result.kind === 'error') {
      return;
    }
    this.databaseState.set(state);
    if (result.relatedTable && state.tables[result.relatedTable]) {
      this.viewTableName.set(result.relatedTable);
    }
  }

  setViewTable(name: string | null): void {
    if (name === null) {
      this.viewTableName.set(null);
      return;
    }
    if (this.databaseState().tables[name]) {
      this.viewTableName.set(name);
    }
  }

  reset(): void {
    this.databaseState.set(INITIAL_STATE);
    this.viewTableName.set(null);
    this.lastResult.set(null);
  }
}
