import { Component, signal } from '@angular/core';

import { DataTableViewerComponent } from '../sql-emulator/data-table-viewer/data-table-viewer.component';
import { SqlEditorComponent } from '../sql-emulator/sql-editor/sql-editor.component';
import { SqlResultPanelComponent } from '../sql-emulator/sql-result-panel/sql-result-panel.component';

@Component({
  selector: 'app-sql-simulator',
  standalone: true,
  imports: [SqlEditorComponent, DataTableViewerComponent, SqlResultPanelComponent],
  templateUrl: './sql-simulator.component.html',
  styleUrl: './sql-simulator.component.css',
})
export class SqlSimulatorComponent {
  protected readonly title = signal('Simulador SQL en memoria');
}
