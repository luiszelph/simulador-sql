import { Component, inject } from '@angular/core';

import { SqlEmulatorService } from '../sql-emulator.service';

@Component({
  selector: 'app-sql-result-panel',
  standalone: true,
  templateUrl: './sql-result-panel.component.html',
  styleUrl: './sql-result-panel.component.css',
})
export class SqlResultPanelComponent {
  protected readonly emulator = inject(SqlEmulatorService);

  protected formatCell(value: unknown): string {
    if (value === null || value === undefined) {
      return '—';
    }
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }
}
