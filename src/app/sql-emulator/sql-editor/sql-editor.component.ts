import { Component, inject, signal } from '@angular/core';

import { SqlEmulatorService } from '../sql-emulator.service';

const DEFAULT_SQL = `CREATE TABLE productos (
  id INTEGER,
  nombre TEXT,
  precio REAL,
  activo BOOLEAN,
  metadatos JSON
);
INSERT INTO productos (id, nombre, precio, activo, metadatos) VALUES (1, 'Teclado', 49.9, true, {"sku":"K1","tags":["input"]});
INSERT INTO productos VALUES (2, 'Monitor', 199.5, false, {"sku":"M2"});
SELECT * FROM productos WHERE id = 1;`;

@Component({
  selector: 'app-sql-editor',
  standalone: true,
  templateUrl: './sql-editor.component.html',
  styleUrl: './sql-editor.component.css',
})
export class SqlEditorComponent {
  private readonly emulator = inject(SqlEmulatorService);
  protected readonly draft = signal(DEFAULT_SQL);

  protected onInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.draft.set(el.value);
  }

  protected run(): void {
    this.emulator.execute(this.draft());
  }

  protected resetDatabase(): void {
    this.emulator.reset();
  }
}
