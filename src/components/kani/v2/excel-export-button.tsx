import { FileSpreadsheet, Loader2 } from 'lucide-react';

export function ExcelExportButton({
  onClick,
  exporting,
  disabled,
  label,
  testId,
}: {
  onClick: () => void;
  exporting: boolean;
  disabled: boolean;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={exporting || disabled}
      aria-busy={exporting}
      aria-label={label}
      title={label}
      data-testid={testId}
      className="kani-excel-icon-btn inline-flex items-center justify-center w-10 h-10 shrink-0 rounded-xl transition-all"
    >
      {exporting ? (
        <Loader2 size={18} className="animate-spin" aria-hidden="true" />
      ) : (
        <FileSpreadsheet size={18} aria-hidden="true" />
      )}
    </button>
  );
}
