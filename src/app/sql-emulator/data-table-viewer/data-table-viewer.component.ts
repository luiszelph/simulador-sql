import { Component, inject } from '@angular/core';

import { SqlEmulatorService } from '../sql-emulator.service';

@Component({
  selector: 'app-data-table-viewer',
  standalone: true,
  templateUrl: './data-table-viewer.component.html',
  styleUrl: './data-table-viewer.component.css',
})
export class DataTableViewerComponent {
  protected readonly emulator = inject(SqlEmulatorService);

  protected onTableChange(event: Event): void {
    const el = event.target as HTMLSelectElement;
    const v = el.value;
    this.emulator.setViewTable(v.length > 0 ? v : null);
  }

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
