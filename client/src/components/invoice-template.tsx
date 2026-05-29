import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import { openPrintWindow, spHeader, spFooter, fmtDocDate, fmtDocKES, SMARTPROP_DOC_CSS } from "@/lib/document-theme";

interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  tenant?: { name: string; unit: string; email: string; phone: string; };
  property?: { name: string; address: string; };
  items?: { description: string; amount: number; period?: string; }[];
  subtotal: number;
  tax?: number;
  total: number;
  currency: string;
  paymentMethods?: {
    mpesa: string;
    bank: { name: string; account: string; branch: string; };
  };
  notes?: string;
}

interface Props {
  invoiceData: InvoiceData;
  onPreview?: () => void;
  onDownload?: () => void;
  onPrint?: () => void;
}

export default function InvoiceTemplate({ invoiceData, onPreview, onDownload, onPrint }: Props) {
  const fmt = (n: number) => fmtDocKES(n, invoiceData.currency);

  const buildBody = () => `
    ${spHeader("Invoice", `#${invoiceData.invoiceNumber}`, invoiceData.invoiceDate, invoiceData.property?.name)}

    <div class="sp-grid-2">
      <div class="sp-section">
        <div class="sp-section-title">Bill To</div>
        <div class="sp-row"><span class="sp-label">Name</span><span class="sp-value">${invoiceData.tenant?.name ?? "N/A"}</span></div>
        <div class="sp-row"><span class="sp-label">Unit</span><span class="sp-value">${invoiceData.tenant?.unit ?? "N/A"}</span></div>
        <div class="sp-row"><span class="sp-label">Email</span><span class="sp-value">${invoiceData.tenant?.email ?? "N/A"}</span></div>
        <div class="sp-row"><span class="sp-label">Phone</span><span class="sp-value">${invoiceData.tenant?.phone ?? "N/A"}</span></div>
      </div>
      <div class="sp-section">
        <div class="sp-section-title">Invoice Details</div>
        <div class="sp-row"><span class="sp-label">Invoice Date</span><span class="sp-value">${fmtDocDate(invoiceData.invoiceDate)}</span></div>
        <div class="sp-row"><span class="sp-label">Due Date</span><span class="sp-value">${fmtDocDate(invoiceData.dueDate)}</span></div>
        <div class="sp-row"><span class="sp-label">Property</span><span class="sp-value">${invoiceData.property?.name ?? "N/A"}</span></div>
        <div class="sp-row"><span class="sp-label">Address</span><span class="sp-value">${invoiceData.property?.address ?? "N/A"}</span></div>
      </div>
    </div>

    <div class="sp-section">
      <div class="sp-section-title">Line Items</div>
      <table class="sp-table">
        <thead>
          <tr>
            <th>Description</th>
            <th>Period</th>
            <th class="r">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${(invoiceData.items ?? []).map(item => `
            <tr>
              <td>${item.description}</td>
              <td>${item.period ?? "—"}</td>
              <td class="r">${fmt(item.amount)}</td>
            </tr>
          `).join("")}
          <tr class="sp-total">
            <td colspan="2">Subtotal</td>
            <td class="r">${fmt(invoiceData.subtotal)}</td>
          </tr>
          ${invoiceData.tax ? `<tr class="sp-total"><td colspan="2">Tax</td><td class="r">${fmt(invoiceData.tax)}</td></tr>` : ""}
          <tr class="sp-net">
            <td colspan="2"><strong>Total Due</strong></td>
            <td class="r"><strong>${fmt(invoiceData.total)}</strong></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="sp-amount-box">
      <div class="sp-amount">${fmt(invoiceData.total)}</div>
      <div class="sp-amount-label">Amount Due — Invoice #${invoiceData.invoiceNumber}</div>
    </div>

    ${invoiceData.paymentMethods ? `
    <div class="sp-section">
      <div class="sp-section-title">Payment Information</div>
      <div class="sp-grid-2">
        <div class="sp-panel">
          <div class="sp-panel-title">M-Pesa Paybill</div>
          <div class="sp-row"><span class="sp-label">Paybill</span><span class="sp-value">${invoiceData.paymentMethods.mpesa}</span></div>
          <div class="sp-row"><span class="sp-label">Account Ref</span><span class="sp-value">${invoiceData.invoiceNumber}</span></div>
        </div>
        <div class="sp-panel">
          <div class="sp-panel-title">Bank Transfer</div>
          <div class="sp-row"><span class="sp-label">Bank</span><span class="sp-value">${invoiceData.paymentMethods.bank.name}</span></div>
          <div class="sp-row"><span class="sp-label">Account</span><span class="sp-value">${invoiceData.paymentMethods.bank.account}</span></div>
          <div class="sp-row"><span class="sp-label">Branch</span><span class="sp-value">${invoiceData.paymentMethods.bank.branch}</span></div>
        </div>
      </div>
    </div>
    ` : ""}

    ${invoiceData.notes ? `<div class="sp-panel"><div class="sp-panel-title">Notes</div><p style="font-size:12px;color:#374151">${invoiceData.notes}</p></div>` : ""}
    ${spFooter("For questions contact support@smartprop.co.ke")}
  `;

  const handleDownload = () => {
    openPrintWindow(buildBody(), `Invoice-${invoiceData.invoiceNumber}`);
    onDownload?.();
  };

  const handlePrint = () => {
    openPrintWindow(buildBody(), `Invoice-${invoiceData.invoiceNumber}`);
    onPrint?.();
  };

  const handlePreview = () => {
    openPrintWindow(buildBody(), `Invoice-${invoiceData.invoiceNumber}`);
    onPreview?.();
  };

  const fmt2 = (n: number) => `${invoiceData.currency} ${n.toLocaleString()}`;

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardContent className="p-8">
        {/* In-app invoice preview */}
        <div className="bg-card border rounded-lg p-8 mb-6">
          <div className="flex justify-between items-center mb-8 border-b-2 border-emerald-600 pb-4">
            <div className="text-2xl font-bold text-emerald-600">SmartProp</div>
            <div className="text-right">
              <div className="text-lg font-bold text-foreground">Invoice #{invoiceData.invoiceNumber}</div>
              <p className="text-muted-foreground text-sm">Date: {fmtDocDate(invoiceData.invoiceDate)}</p>
              <p className="text-muted-foreground text-sm">Due: {fmtDocDate(invoiceData.dueDate)}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div>
              <h3 className="font-semibold mb-2 text-foreground">Bill To</h3>
              <p className="font-medium">{invoiceData.tenant?.name}</p>
              <p className="text-muted-foreground text-sm">Unit: {invoiceData.tenant?.unit}</p>
              <p className="text-muted-foreground text-sm">{invoiceData.tenant?.email}</p>
              <p className="text-muted-foreground text-sm">{invoiceData.tenant?.phone}</p>
            </div>
            <div>
              <h3 className="font-semibold mb-2 text-foreground">Property</h3>
              <p className="font-medium">{invoiceData.property?.name}</p>
              <p className="text-muted-foreground text-sm">{invoiceData.property?.address}</p>
            </div>
          </div>
          <table className="w-full mb-6">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 text-sm font-semibold text-muted-foreground">Description</th>
                <th className="text-left py-2 text-sm font-semibold text-muted-foreground">Period</th>
                <th className="text-right py-2 text-sm font-semibold text-muted-foreground">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(invoiceData.items ?? []).map((item, i) => (
                <tr key={i} className="border-b">
                  <td className="py-3 text-sm">{item.description}</td>
                  <td className="py-3 text-sm text-muted-foreground">{item.period ?? "—"}</td>
                  <td className="py-3 text-sm text-right">{fmt2(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-end">
            <div className="w-64">
              <div className="flex justify-between py-2 text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{fmt2(invoiceData.subtotal)}</span>
              </div>
              {invoiceData.tax && (
                <div className="flex justify-between py-2 text-sm">
                  <span className="text-muted-foreground">Tax</span>
                  <span>{fmt2(invoiceData.tax)}</span>
                </div>
              )}
              <div className="flex justify-between py-2 font-bold text-lg border-t-2 border-emerald-600 mt-1">
                <span>Total</span>
                <span className="text-emerald-700">{fmt2(invoiceData.total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3 justify-end">
          <Button variant="outline" onClick={handlePreview}>
            <Download className="h-4 w-4 mr-2" />Preview
          </Button>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />Print
          </Button>
          <Button onClick={handleDownload} className="bg-emerald-600 hover:bg-emerald-700">
            <Download className="h-4 w-4 mr-2" />Download PDF
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}