import { Routes } from '@angular/router';

import { EquiposExcelComponent } from './equipos-excel/equipos-excel.component';
import { SqlSimulatorComponent } from './sql-simulator/sql-simulator.component';

export const routes: Routes = [
  { path: '', component: SqlSimulatorComponent },
  { path: 'equipos', component: EquiposExcelComponent },
  { path: '**', redirectTo: '' },
];
