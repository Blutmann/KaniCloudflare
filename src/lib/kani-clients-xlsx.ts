import ExcelJS from 'exceljs';
import type { ClientExportRow } from './kani-clients-export.server';

export function sanitizeFormulaText(value: string): string {
  if (!value) return '';
  // Guard against spreadsheet formula injection without altering phone numbers starting with '+'
  if (/^[=@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

export function buildClientExportFilename(todayYmd: string): string {
  const clean = /^\d{4}-\d{2}-\d{2}$/.test(todayYmd)
    ? todayYmd
    : new Date().toISOString().slice(0, 10);
  return `KANI_Clientes_${clean}.xlsx`;
}

export async function generateClientsWorkbookBuffer(
  rows: ClientExportRow[],
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'KANI Barber Studio';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Clientes', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const columns: Array<{ header: string; key: keyof ClientExportRow; width: number }> = [
    { header: 'Cliente desde', key: 'clienteDesde', width: 15 },
    { header: 'Nombre', key: 'nombre', width: 28 },
    { header: 'Mail', key: 'mail', width: 32 },
    { header: 'Celular', key: 'celular', width: 20 },
    { header: 'Barbero', key: 'barbero', width: 28 },
    { header: 'Última atención', key: 'ultimaAtencion', width: 17 },
    { header: 'Servicios realizados', key: 'serviciosRealizados', width: 20 },
    { header: 'Próxima reserva', key: 'proximaReserva', width: 17 },
    { header: 'Observaciones', key: 'observaciones', width: 34 },
    { header: 'ID interno', key: 'idInterno', width: 38 },
  ];

  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sheet.autoFilter = 'A1:J1';

  const headerRow = sheet.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFF6F2EA' }, size: 11 };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1C1A18' },
    };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FFC8A253' } },
      right: { style: 'thin', color: { argb: 'FF3A3530' } },
    };
  });

  rows.forEach((row, index) => {
    const added = sheet.addRow({
      clienteDesde: row.clienteDesde,
      nombre: sanitizeFormulaText(row.nombre),
      mail: sanitizeFormulaText(row.mail),
      celular: row.celular,
      barbero: sanitizeFormulaText(row.barbero),
      ultimaAtencion: row.ultimaAtencion,
      serviciosRealizados: row.serviciosRealizados,
      proximaReserva: row.proximaReserva,
      observaciones: sanitizeFormulaText(row.observaciones),
      idInterno: row.idInterno,
    });

    added.height = 21;
    const isEven = index % 2 === 1;
    added.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (isEven) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFAF8F4' },
        };
      }
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE5DFD3' } },
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber === 7 ? 'right' : 'left',
      };
      // Force text format for dates (A, F, H), Mail (C), and Celular (D) so Excel preserves + and leading zeros
      if ([1, 3, 4, 6, 8].includes(colNumber)) {
        cell.numFmt = '@';
      }
    });
  });

  // Auto-adjust column widths slightly based on content length
  columns.forEach((col, idx) => {
    let maxLen = col.header.length + 4;
    for (const r of rows) {
      const val = String(r[col.key] ?? '');
      if (val.length + 3 > maxLen) maxLen = val.length + 3;
    }
    sheet.getColumn(idx + 1).width = Math.min(Math.max(col.width, maxLen), 48);
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

export async function downloadClientsXlsx(
  rows: ClientExportRow[],
  todayYmd: string,
): Promise<string> {
  const bytes = await generateClientsWorkbookBuffer(rows);
  const filename = buildClientExportFilename(todayYmd);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
