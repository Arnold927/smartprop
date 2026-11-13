import { useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";

interface ExportMenuProps {
  /** Build + download the Excel file. Omit to hide the option. */
  onExcel?: () => void | Promise<void>;
  /** Build + download the branded PDF. Omit to hide the option. */
  onPdf?: () => void | Promise<void>;
  disabled?: boolean;
  label?: string;
  size?: "sm" | "default";
  className?: string;
}

/**
 * One "Export" button for every list: Excel for working with the data,
 * PDF for a branded, shareable document. If only one format is supplied
 * it behaves as a plain button for that format.
 */
export function ExportMenu({ onExcel, onPdf, disabled, label = "Export", size = "sm", className }: ExportMenuProps) {
  const [busy, setBusy] = useState<"excel" | "pdf" | null>(null);
  const { toast } = useToast();

  const run = async (kind: "excel" | "pdf", fn?: () => void | Promise<void>) => {
    if (!fn || busy) return;
    setBusy(kind);
    try {
      await fn();
      toast({ title: kind === "pdf" ? "PDF downloaded" : "Excel file downloaded" });
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message || "Please try again", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const icon = busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />;

  if (onExcel && !onPdf) {
    return <Button variant="outline" size={size} className={className} disabled={disabled || !!busy} onClick={() => run("excel", onExcel)}>{icon}<span className="ml-1.5 hidden sm:inline">{label}</span></Button>;
  }
  if (onPdf && !onExcel) {
    return <Button variant="outline" size={size} className={className} disabled={disabled || !!busy} onClick={() => run("pdf", onPdf)}>{icon}<span className="ml-1.5 hidden sm:inline">{label} PDF</span></Button>;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} className={className} disabled={disabled || !!busy} aria-label={label}>
          {icon}<span className="ml-1.5 hidden sm:inline">{label}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => run("pdf", onPdf)}>
          <FileText className="w-4 h-4 mr-2" />PDF document
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => run("excel", onExcel)}>
          <FileSpreadsheet className="w-4 h-4 mr-2" />Excel spreadsheet
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
