import { CurrencyPipe } from '@angular/common';
import {
  Component,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { EquiposExcelService } from './equipos-excel.service';

@Component({
  selector: 'app-equipos-excel',
  standalone: true,
  imports: [ReactiveFormsModule, CurrencyPipe],
  providers: [EquiposExcelService],
  templateUrl: './equipos-excel.component.html',
  styleUrl: './equipos-excel.component.css',
})
export class EquiposExcelComponent {
  private readonly fb = inject(FormBuilder);
  protected readonly excel = inject(EquiposExcelService);

  private readonly archivoInput = viewChild<ElementRef<HTMLInputElement>>('archivoExcel');

  protected readonly formulario = this.fb.nonNullable.group({
    nombreEquipo: ['', [Validators.required, Validators.maxLength(200)]],
    marca: ['', [Validators.maxLength(200)]],
    precio: [0, [Validators.required, Validators.min(0)]],
    hospitalAsignado: ['', [Validators.maxLength(200)]],
  });

  protected onAgregar(): void {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    const v = this.formulario.getRawValue();
    this.excel.agregarFila({
      nombreEquipo: v.nombreEquipo.trim(),
      marca: v.marca.trim(),
      precio: v.precio,
      hospitalAsignado: v.hospitalAsignado.trim(),
    });
    this.formulario.reset({ nombreEquipo: '', marca: '', precio: 0, hospitalAsignado: '' });
  }

  protected onDispararLectura(): void {
    this.archivoInput()?.nativeElement.click();
  }

  protected async onArchivoSeleccionado(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) {
      return;
    }
    await this.excel.importarArchivo(archivo);
  }

  protected async onDescargarPlantilla(): Promise<void> {
    await this.excel.descargarPlantilla();
  }

  protected async onDescargarDatos(): Promise<void> {
    await this.excel.descargarDatosExcel();
  }
}
