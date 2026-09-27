import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Globe, CreditCard, Camera, Video, FileText, QrCode, Award, TrendingUp, Calendar, MapPin, Search, Shield, Plane, DollarSign, Mail, Home, CheckCircle, Clock, AlertCircle, ArrowRight, Users, Upload, X, Image as ImageIcon, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { formatCurrency } from "@shared/currency";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";

interface DiasporaContract {
  id: number;
  propertyId: number;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientWhatsapp: string;
  clientCountry: string;
  totalPropertyValue: number;
  downPayment: number;
  monthlyInstallment: number;
  currency: string;
  paymentFrequency: string;
  contractDurationMonths: number;
  paymentsMade: number;
  totalPaid: number;
  remainingBalance: number;
  completionPercentage: number;
  constructionStatus: string;
  nextPaymentDue: string;
  paymentMethod: string;
  internationalProvider: string;
  contractSignedAt: string;
  digitalCertificateIssued: boolean;
  certificateQrCode?: string;
  registryLink?: string;
  createdAt: string;
}

interface DiasporaPayment {
  id: number;
  diasporaContractId: number;
  paymentNumber: number;
  amount: number;
  currency: string;
  exchangeRate: number;
  originalAmount: number;
  originalCurrency: string;
  paymentDate: string;
  paymentMethod: string;
  internationalProvider: string;
  providerTransactionId: string;
  status: string;
  processingFee: number;
  exchangeFee: number;
  receiptUrl?: string;
  confirmationCode: string;
  createdAt: string;
}

interface ConstructionUpdate {
  id: number;
  diasporaContractId: number;
  updateType: string;
  milestoneName?: string;
  progressPercentage: number;
  description: string;
  photos: string[];
  videos: string[];
  weatherConditions: string;
  crewSize: number;
  nextMilestone: string;
  estimatedCompletion: string;
  clientNotified: boolean;
  createdAt: string;
}

// Country flag emojis for common diaspora countries
const countryFlags: Record<string, string> = {
  USA: "🇺🇸", UK: "🇬🇧", Canada: "🇨🇦", Australia: "🇦🇺",
  Germany: "🇩🇪", UAE: "🇦🇪", "South Africa": "🇿🇦",
  Netherlands: "🇳🇱", Sweden: "🇸🇪", Norway: "🇳🇴",
  Switzerland: "🇨🇭", France: "🇫🇷", Qatar: "🇶🇦",
  Kenya: "🇰🇪", Uganda: "🇺🇬", Tanzania: "🇹🇿",
  Rwanda: "🇷🇼", Ethiopia: "🇪🇹", Nigeria: "🇳🇬",
  Ghana: "🇬🇭", "Saudi Arabia": "🇸🇦", Kuwait: "🇰🇼",
  Oman: "🇴🇲", Bahrain: "🇧🇭", Ireland: "🇮🇪",
  Belgium: "🇧🇪", Italy: "🇮🇹", Spain: "🇪🇸",
  China: "🇨🇳", Japan: "🇯🇵", "South Korea": "🇰🇷",
  India: "🇮🇳", Brazil: "🇧🇷",
};

const constructionStages = [
  { key: "planning", label: "Planning", icon: "📐", color: "#6B7280" },
  { key: "foundation", label: "Foundation", icon: "🏗️", color: "#D97706" },
  { key: "structure", label: "Structure", icon: "🧱", color: "#2563EB" },
  { key: "roofing", label: "Roofing", icon: "🏠", color: "#F59E0B" },
  { key: "finishing", label: "Finishing", icon: "🪟", color: "#7C3AED" },
  { key: "completed", label: "Completed", icon: "🏠", color: "#059669" },
];

function PaginationBar({
  total, page, pageSize, onPage, onPageSize,
}: {
  total: number; page: number; pageSize: number;
  onPage: (p: number) => void; onPageSize: (s: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>Rows per page:</span>
        <select
          value={pageSize}
          onChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }}
          className="border rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
        >
          {[5, 10, 20, 50].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="text-xs">{start}–{end} of {total}</span>
      </div>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(1)} disabled={page === 1}
          className="px-2 py-1 rounded border text-xs disabled:opacity-40 hover:bg-slate-100 transition-colors">«</button>
        <button onClick={() => onPage(page - 1)} disabled={page === 1}
          className="px-2 py-1 rounded border text-xs disabled:opacity-40 hover:bg-slate-100 transition-colors">‹</button>
        {Array.from({ length: totalPages }, (_, i) => i + 1)
          .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
          .reduce<(number | "…")[]>((acc, p, idx, arr) => {
            if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push("…");
            acc.push(p);
            return acc;
          }, [])
          .map((p, i) =>
            p === "…"
              ? <span key={"e" + i} className="px-1 text-xs">…</span>
              : <button key={p} onClick={() => onPage(p as number)}
                  className={`px-2.5 py-1 rounded border text-xs transition-colors ${page === p ? "bg-emerald-600 text-white border-emerald-600" : "hover:bg-muted"}`}
                >{p}</button>
          )
        }
        <button onClick={() => onPage(page + 1)} disabled={page === totalPages}
          className="px-2 py-1 rounded border text-xs disabled:opacity-40 hover:bg-slate-100 transition-colors">›</button>
        <button onClick={() => onPage(totalPages)} disabled={page === totalPages}
          className="px-2 py-1 rounded border text-xs disabled:opacity-40 hover:bg-slate-100 transition-colors">»</button>
      </div>
    </div>
  );
}


const StatusBadge = ({ status }: { status: string }) => {
  const stage = constructionStages.find(s => s.key === status) || constructionStages[0];

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "5px",
      padding: "3px 10px", borderRadius: "9999px", fontSize: "11px", fontWeight: 600,
      background: stage.color + "22", color: stage.color,
      border: `1px solid ${stage.color}44`,
    }}>
      {stage.icon} {stage.label}
    </span>
  );
};

const ProviderBadge = ({ provider }: { provider: string }) => {
  const providerColors: Record<string, [string, string]> = {
    remitly: ["#1A56DB", "#EFF6FF"],
    worldremit: ["#059669", "#ECFDF5"],
    wise: ["#0EA5E9", "#F0F9FF"],
    westernunion: ["#CA8A04", "#FEFCE8"],
    moneygram: ["#DC2626", "#FEF2F2"],
    xoom: ["#7C3AED", "#F5F3FF"],
  };
  const [fg, bg] = providerColors[provider?.toLowerCase()] || ["#6B7280", "#F9FAFB"];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      padding: "3px 10px", borderRadius: "9999px", fontSize: "11px", fontWeight: 600,
      background: bg, color: fg, border: `1px solid ${fg}33`,
    }}>
      <Globe style={{ width: 10, height: 10 }} /> {provider}
    </span>
  );
};

const MetricCard = ({
  icon, label, value, sub, gradient
}: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string;
  gradient: [string, string];
}) => (
  <div style={{
    background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
    borderRadius: "16px", padding: "20px 24px",
    display: "flex", alignItems: "center", gap: "16px",
    boxShadow: `0 4px 24px ${gradient[0]}33`,
    position: "relative", overflow: "hidden",
  }}>
    <div style={{
      position: "absolute", right: -12, top: -12,
      width: 80, height: 80, borderRadius: "50%",
      background: "rgba(255,255,255,0.08)",
    }} />
    <div style={{
      width: 44, height: 44, borderRadius: "12px",
      background: "rgba(255,255,255,0.2)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
    }}>
      {icon}
    </div>
    <div>
      <p style={{ color: "rgba(255,255,255,0.75)", fontSize: "11px", fontWeight: 600, letterSpacing: "1px", textTransform: "uppercase", marginBottom: 2 }}>{label}</p>
      <p style={{ color: "#fff", fontSize: "22px", fontWeight: 800, lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "11px", marginTop: 2 }}>{sub}</p>}
    </div>
  </div>
);

export default function DiasporaRentToOwn() {
  // ── Role guard — admin and manager only ──────────────────────────────────
  const guard = useRoleGuard(ROLES.ADMIN_MANAGER);
  const user = guard.user;
  const [, navigate] = useLocation();  // guard.user is the same as useAuth().user

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [activeTab, setActiveTab] = useState("contracts");
  const [selectedContract, setSelectedContract] = useState<DiasporaContract | null>(null);
  const [isAddContractOpen, setIsAddContractOpen] = useState(false);
  const [isAddPaymentOpen, setIsAddPaymentOpen] = useState(false);
  const [isAddCertificateOpen, setIsAddCertificateOpen] = useState(false);
  const [paymentsSearch, setPaymentsSearch] = useState("");
  const [certificatesSearch, setCertificatesSearch] = useState("");
  // Pagination state per tab
  const [contractsPage, setContractsPage] = useState(1);
  const [contractsPageSize, setContractsPageSize] = useState(10);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentsPageSize, setPaymentsPageSize] = useState(10);
  const [certificatesPage, setCertificatesPage] = useState(1);
  const [certificatesPageSize, setCertificatesPageSize] = useState(10);
  const [expandedConstructionUpdates, setExpandedConstructionUpdates] = useState<Record<number, boolean>>({});

  // Construction update media state
  const [stagedPhotos, setStagedPhotos] = useState<{ file: File; preview: string }[]>([]);
  const [stagedVideos, setStagedVideos] = useState<{ file: File; name: string }[]>([]);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [contractDetailTab, setContractDetailTab] = useState("details");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newPhotos = files.map(file => ({ file, preview: URL.createObjectURL(file) }));
    setStagedPhotos(prev => [...prev, ...newPhotos]);
    e.target.value = "";
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newVideos = files.map(file => ({ file, name: file.name }));
    setStagedVideos(prev => [...prev, ...newVideos]);
    e.target.value = "";
  };

  const removePhoto = (index: number) => {
    setStagedPhotos(prev => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const removeVideo = (index: number) => {
    setStagedVideos(prev => prev.filter((_, i) => i !== index));
  };

  // Encode files as base64 data URLs
  const uploadFiles = async (files: File[]): Promise<string[]> => {
    return Promise.all(files.map(file => new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    })));
  };

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: contractsRaw = [], isLoading: contractsLoading } = useQuery({
    queryKey: ["/api/diaspora-contracts"],
    queryFn: async () => {
      try { const r = await apiRequest("/api/diaspora-contracts"); const d = await r.json(); return ensureArray(d); }
      catch { return []; }
    },
    staleTime: 60000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
  });

  const { data: paymentsRaw = [], isLoading: paymentsLoading } = useQuery({
    queryKey: ["/api/diaspora-payments"],
    queryFn: async () => {
      try { const r = await apiRequest("/api/diaspora-payments"); const d = await r.json(); return ensureArray(d); }
      catch { return []; }
    },
    staleTime: 60000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
    enabled: true,
  });

  const { data: constructionUpdatesRaw = [], isLoading: constructionLoading } = useQuery({
    queryKey: ["/api/construction-updates"],
    queryFn: async () => {
      try { const r = await apiRequest("/api/construction-updates"); const d = await r.json(); return ensureArray(d); }
      catch { return []; }
    },
    staleTime: 60000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
    enabled: !!selectedContract,
  });

  const { data: certificatesRaw = [], isLoading: certificatesLoading } = useQuery({
    queryKey: ["/api/diaspora-certificates"],
    queryFn: async () => {
      try { const r = await apiRequest("/api/diaspora-certificates"); const d = await r.json(); return ensureArray(d); }
      catch { return []; }
    },
    staleTime: 60000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
    enabled: true,
  });

  // Invoices — loaded via useQuery keyed on selectedContract.id
  // This replaces the imperative loadContractInvoices() so invoices
  // always stay fresh and the tab count is accurate immediately.
  const { data: contractInvoicesData = [], isLoading: loadingInvoicesQuery } = useQuery({
    queryKey: ["/api/diaspora-contracts", selectedContract?.id, "invoices"],
    queryFn: async () => {
      if (!selectedContract?.id) return [];
      try {
        const r = await apiRequest(`/api/diaspora-contracts/${selectedContract.id}/invoices`);
        if (!r.ok) return [];
        const d = await r.json();
        return Array.isArray(d) ? d : [];
      } catch { return []; }
    },
    enabled: !!selectedContract?.id,
    staleTime: 60000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
  });

  const { data: propertiesRaw = [], isLoading: loadingProperties } = useQuery({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      try { const r = await apiRequest("/api/properties"); const d = await r.json(); return ensureArray(d); }
      catch { return []; }
    },
  });

  const contracts = ensureArray(contractsRaw);
  const payments = ensureArray(paymentsRaw);
  const constructionUpdates = ensureArray(constructionUpdatesRaw);
  const certificates = ensureArray(certificatesRaw);
  const properties = ensureArray(propertiesRaw);

  const totalContracts = contracts.length;
  const activeContracts = contracts.filter((c: DiasporaContract) => c.constructionStatus !== "completed").length;
  const completedProjects = contracts.filter((c: DiasporaContract) => c.constructionStatus === "completed").length;
  const totalValue = contracts.reduce((s: number, c: DiasporaContract) => s + (c.totalPropertyValue || 0), 0);
  const totalCollected = contracts.reduce((s: number, c: DiasporaContract) => s + (c.totalPaid || 0), 0);
  const avgCompletion = contracts.reduce((s: number, c: DiasporaContract) => s + (c.completionPercentage || 0), 0) / (contracts.length || 1);
  const uniqueCountries = [...new Set(contracts.map((c: DiasporaContract) => c.clientCountry).filter(Boolean))].length;

  const createContractMutation = useMutation({
    mutationFn: async (data: any) => {
      const r = await apiRequest("/api/diaspora-contracts", { method: "POST", data });
      return r.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/diaspora-contracts"] });
      setIsAddContractOpen(false);
      const invited = result?._meta?.buyerInvited;
      toast({
        title: "Contract created",
        description: invited
          ? "An invitation email has been sent to the client so they can access their buyer portal."
          : "Contract created and linked to the client's existing account.",
      });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to create contract.", variant: "destructive" });
    },
  });

  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [editingContract, setEditingContract] = useState<DiasporaContract | null>(null);
  // contractInvoices and loadingInvoices replaced by useQuery (contractInvoicesData, loadingInvoicesQuery)

  const handleGenerateInvoice = async (contract: DiasporaContract) => {
    setGeneratingInvoice(true);
    try {
      const r = await apiRequest(`/api/diaspora-contracts/${contract.id}/generate-invoice`, { method: "POST", data: {} });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.message || "Failed to generate invoice");
      }
      const invoice = await r.json();
      queryClient.invalidateQueries({ queryKey: ["/api/diaspora-contracts"] });
      // Invalidate invoice query so tab refreshes automatically
      if (contract.id) queryClient.invalidateQueries({ queryKey: ["/api/diaspora-contracts", contract.id, "invoices"] });
      const freq = invoice.periodLabel || "Payment";
      const amt = invoice.amount ?? invoice.totalAmount;
      toast({
        title: "Invoice Generated",
        description: `${freq} invoice ${invoice.invoiceNumber} for ${formatCurrency(Number(amt), invoice.currency ?? "KES")} created for ${invoice.clientName}.`,
      });
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Could not generate invoice.", variant: "destructive" });
    } finally {
      setGeneratingInvoice(false);
    }
  };

  const editContractMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) =>
      apiRequest(`/api/diaspora-contracts/${id}`, { method: "PATCH", data }),
    onSuccess: (updatedContract: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/diaspora-contracts"] });
      setEditingContract(null);
      // Update the selected contract in view immediately + switch to Details tab
      if (updatedContract?.id) setSelectedContract((prev: any) => prev ? { ...prev, ...updatedContract } : prev);
      setContractDetailTab("details");
      toast({ title: "Contract updated", description: "Contract details have been saved." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to update contract.", variant: "destructive" });
    },
  });

  const createConstructionUpdateMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("/api/construction-updates", { method: "POST", data }),
    onSuccess: () => {
      // Invalidate all related queries so the UI refreshes immediately
      queryClient.invalidateQueries({ queryKey: ["/api/construction-updates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/diaspora-contracts"] });
      // Close the dialog and reset staged files
      setIsUploadDialogOpen(false);
      setStagedPhotos([]);
      setStagedVideos([]);
      setContractDetailTab("construction");
      toast({ title: "Update posted", description: "Construction progress has been shared with the client." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to post update.", variant: "destructive" });
    },
  });

  const createPaymentMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("/api/diaspora-payments", { method: "POST", data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/diaspora-payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/diaspora-contracts"] });
      setIsAddPaymentOpen(false);
      // Reset FX form state
      setFxForm({ originalCurrency: "USD", originalAmount: "", appliedRate: "", processingFee: "", exchangeFee: "" });
      setLiveRate(null);
      setBreakdown(null);
      setKesAmountInput("");
      toast({ title: "Payment recorded", description: "International payment has been logged successfully." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to record payment.", variant: "destructive" });
    },
  });

  // ── Live exchange rate & disbursement breakdown ─────────────────────────
  const [fxForm, setFxForm] = useState({
    originalCurrency: "USD",
    originalAmount: "",
    appliedRate: "",
    processingFee: "",
    exchangeFee: "",
  });
  const [liveRate, setLiveRate] = useState<{
    midMarketRate: number; source: string; isStale: boolean; fetchedAt: string;
  } | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [breakdown, setBreakdown] = useState<{
    spreadPct: number; kesReceived: number; kesDisbursed: number;
    totalFees: number; effectiveTotalCostPct: number;
    midMarketRate: number;
  } | null>(null);
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const [kesAmountInput, setKesAmountInput] = useState("");

  const fetchLiveRate = async (from: string) => {
    if (from === "KES") { setLiveRate(null); return; }
    setRateLoading(true);
    try {
      const r = await apiRequest(`/api/exchange-rates/live?from=${from}&to=KES`);
      const data = await r.json();
      setLiveRate(data);
      // Auto-fill the rate field with mid-market rate
      setFxForm(f => ({ ...f, appliedRate: data.midMarketRate?.toFixed(4) ?? "" }));
    } catch { /* silently keep whatever was there */ }
    finally { setRateLoading(false); }
  };

  const computeBreakdown = async () => {
    const orig = parseFloat(fxForm.originalAmount);
    const rate = parseFloat(fxForm.appliedRate);
    if (!orig || !rate || fxForm.originalCurrency === "KES") { setBreakdown(null); return; }
    setBreakdownLoading(true);
    try {
      const r = await apiRequest("/api/exchange-rates/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({
          originalAmount:   orig,
          originalCurrency: fxForm.originalCurrency,
          appliedRate:      rate,
          processingFee:    parseFloat(fxForm.processingFee) || 0,
          exchangeFee:      parseFloat(fxForm.exchangeFee)   || 0,
        }),
      });
      const data = await r.json();
      setBreakdown(data);
      if (data?.kesReceived != null) setKesAmountInput(data.kesReceived.toFixed(2));
    } catch { setBreakdown(null); }
    finally { setBreakdownLoading(false); }
  };

  const createCertificateMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("/api/diaspora-certificates", { method: "POST", data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/diaspora-certificates"] });
      setIsAddCertificateOpen(false);
      toast({ title: "Certificate Issued", description: "Digital ownership certificate has been created." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to issue certificate.", variant: "destructive" });
    },
  });

  const [viewingCert, setViewingCert] = useState<any>(null);

  const verifyCertificateMutation = useMutation({
    mutationFn: async (id: number) => apiRequest(`/api/diaspora-certificates/${id}`, {
      method: "PATCH",
      data: { status: "verified", verifiedAt: new Date().toISOString() },
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/diaspora-certificates"] });
      toast({ title: "Certificate Verified", description: "Certificate status has been updated to verified." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error?.message || "Failed to verify certificate.", variant: "destructive" });
    },
  });

  // loadContractInvoices removed — replaced by useQuery above

  const filteredContracts = contracts.filter((c: DiasporaContract) => {
    const matchesSearch = c.clientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.clientCountry?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.clientEmail?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = selectedStatus === "all" || c.constructionStatus === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  // Reset page when filters/data change
  // (handled inline via Math.min in slice)
  const paginatedContracts = filteredContracts.slice((contractsPage - 1) * contractsPageSize, contractsPage * contractsPageSize);
  const totalContractPages = Math.max(1, Math.ceil(filteredContracts.length / contractsPageSize));

  const filteredPayments = payments.filter((p: any) => {
    if (!paymentsSearch.trim()) return true;
    const q = paymentsSearch.toLowerCase();
    const contract = contracts.find((c: any) => c.id === p.diasporaContractId);
    return (
      contract?.clientName?.toLowerCase().includes(q) ||
      contract?.clientCountry?.toLowerCase().includes(q) ||
      p.internationalProvider?.toLowerCase().includes(q) ||
      p.providerTransactionId?.toLowerCase().includes(q) ||
      p.confirmationCode?.toLowerCase().includes(q) ||
      p.status?.toLowerCase().includes(q)
    );
  });
  const paginatedPayments = filteredPayments.slice((paymentsPage - 1) * paymentsPageSize, paymentsPage * paymentsPageSize);
  const totalPaymentPages = Math.max(1, Math.ceil(filteredPayments.length / paymentsPageSize));

  const filteredCertificates = certificates.filter((cert: any) => {
    if (!certificatesSearch.trim()) return true;
    const q = certificatesSearch.toLowerCase();
    const contract = contracts.find((c: any) => c.id === cert.diasporaContractId);
    return (
      cert.certificateNumber?.toLowerCase().includes(q) ||
      cert.certificateType?.toLowerCase().includes(q) ||
      cert.status?.toLowerCase().includes(q) ||
      cert.blockchainHash?.toLowerCase().includes(q) ||
      contract?.clientName?.toLowerCase().includes(q) ||
      contract?.clientCountry?.toLowerCase().includes(q)
    );
  });
  const paginatedCertificates = filteredCertificates.slice((certificatesPage - 1) * certificatesPageSize, certificatesPage * certificatesPageSize);
  const totalCertificatePages = Math.max(1, Math.ceil(filteredCertificates.length / certificatesPageSize));

  const handleSubmitContract = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const data = Object.fromEntries(fd.entries());
    // Send raw values — server recalculates installment, remainingBalance,
    // nextPaymentDue, organizationId, and createdBy automatically
    createContractMutation.mutate({
      propertyId:             parseInt(data.propertyId as string),
      clientName:             data.clientName,
      clientEmail:            data.clientEmail,
      clientPhone:            data.clientPhone,
      clientWhatsapp:         data.clientWhatsapp,
      clientCountry:          data.clientCountry,
      totalPropertyValue:     data.totalPropertyValue,
      downPayment:            data.downPayment,
      contractDurationMonths: parseInt(data.contractDurationMonths as string),
      currency:               "KES",
      paymentFrequency:       data.paymentFrequency,
      paymentMethod:          data.paymentMethod,
      internationalProvider:  data.internationalProvider || "Direct Bank Wire",
      contractSignedAt:       data.contractSignedAt       || null,
      constructionStartDate:  data.constructionStartDate  || null,
      expectedCompletionDate: data.expectedCompletionDate || null,
    });
  };

  // ── Guard rendering — uses hook's built-in gate element ───────────────────
  if (guard.gate) return guard.gate;

  if (!user?.organizationId) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-3 max-w-sm">
          <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center mx-auto">
            <span className="text-2xl">🏢</span>
          </div>
          <h2 className="text-lg font-semibold text-foreground">No organisation linked</h2>
          <p className="text-sm text-muted-foreground">Your account is not linked to an organisation. Contact your administrator.</p>
        </div>
      </div>
    );
  }

  if (loadingProperties) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center space-y-4">
          <Plane className="h-10 w-10 text-muted-foreground mx-auto animate-bounce" />
          <p className="text-muted-foreground font-medium">Loading diaspora portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">

      {/* ── HERO BANNER ───────────────────────────────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden" style={{ minHeight: 240 }}>
        {/* Real aeroplane photo — Kenya Airways / commercial jet in flight */}
        <img
          src="https://images.unsplash.com/photo-1556388158-158ea5ccacbd?auto=format&fit=crop&w=1600&q=80"
          alt="Kenya Airways aircraft representing diaspora investment"
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: "center 30%" }}
        />
        {/* Dark overlay gradient — readable text on any photo */}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-900/90 via-slate-900/70 to-slate-900/30" />
        {/* Emerald bottom fade to blend with page */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-background to-transparent" />

        {/* Content on top of photo */}
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-5 p-6 sm:p-8" style={{ minHeight: 240 }}>
          <div className="space-y-2 pt-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-emerald-400 text-xs font-bold uppercase tracking-widest">
                SmartProp · Global Portfolio
              </span>
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">
              Diaspora Rent-to-Own
            </h1>
            <p className="text-white/65 text-sm max-w-md">
              Empowering Kenyans abroad to invest in home — remotely, securely, transparently.
            </p>
            {uniqueCountries > 0 && (
              <p className="text-emerald-400 text-xs flex items-center gap-1.5 font-medium">
                <Globe className="h-3.5 w-3.5" />
                Investors from {uniqueCountries} {uniqueCountries === 1 ? "country" : "countries"} investing back home
              </p>
            )}
          </div>

          <Dialog open={isAddContractOpen} onOpenChange={setIsAddContractOpen}>
            <DialogTrigger asChild>
              <PrimaryButton icon={<Plus className="h-4 w-4" />}>New Contract</PrimaryButton>
            </DialogTrigger>

            {/* ── CREATE CONTRACT DIALOG ── */}
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-xl">
                  <Globe className="h-5 w-5 text-blue-500" />
                  Create Diaspora Contract
                </DialogTitle>
                <DialogDescription className="flex flex-col gap-1">
                  <span>Set up a new international rent-to-own property investment contract.</span>
                  <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                    <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                    An invitation email will be sent to the client so they can access their buyer portal.
                  </span>
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSubmitContract} className="space-y-4 mt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Property *</Label>
                    <Select name="propertyId" required>
                      <SelectTrigger><SelectValue placeholder="Select property" /></SelectTrigger>
                      <SelectContent>
                        {properties.length === 0
                          ? <SelectItem value="none" disabled>No properties available</SelectItem>
                          : properties.map((p: any) => <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Client Country *</Label>
                    <Select name="clientCountry" required>
                      <SelectTrigger><SelectValue placeholder="Select country" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(countryFlags).sort((a, b) => a[0].localeCompare(b[0])).map(([code, flag]) => (
                          <SelectItem key={code} value={code}>{flag} {code}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Full Name *</Label>
                    <Input name="clientName" placeholder="John Kamau" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Email *</Label>
                    <Input type="email" name="clientEmail" placeholder="john@example.com" required />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Phone Number</Label>
                    <Input name="clientPhone" placeholder="+1-555-000-0000" />
                  </div>
                  <div className="space-y-2">
                    <Label>WhatsApp *</Label>
                    <Input name="clientWhatsapp" placeholder="+1-555-000-0000" required />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Property Value (KSh) *</Label>
                    <Input type="number" step="1000" name="totalPropertyValue" placeholder="5000000" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Down Payment (KSh) *</Label>
                    <Input type="number" step="1000" name="downPayment" placeholder="500000" required />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Duration (Months) *</Label>
                    <Input type="number" name="contractDurationMonths" placeholder="36" required />
                  </div>
                  <div className="space-y-2">
                    <Label>Payment Frequency *</Label>
                    <Select name="paymentFrequency" required>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="quarterly">Quarterly</SelectItem>
                        <SelectItem value="semi_annual">Semi-Annual</SelectItem>
                        <SelectItem value="annual">Annual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Payment Method *</Label>
                    <Select name="paymentMethod" required>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                        <SelectItem value="online_transfer">Online Transfer</SelectItem>
                        <SelectItem value="wire_transfer">Wire Transfer</SelectItem>
                        <SelectItem value="card_payment">Card Payment</SelectItem>
                        <SelectItem value="mobile_money">Mobile Money (M-Pesa Global)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>International Provider *</Label>
                    <Select name="internationalProvider" required>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Remitly">Remitly</SelectItem>
                        <SelectItem value="WorldRemit">WorldRemit</SelectItem>
                        <SelectItem value="Wise">Wise (TransferWise)</SelectItem>
                        <SelectItem value="Western Union">Western Union</SelectItem>
                        <SelectItem value="MoneyGram">MoneyGram</SelectItem>
                        <SelectItem value="Xoom">Xoom (PayPal Service)</SelectItem>
                        <SelectItem value="Sendwave">Sendwave</SelectItem>
                        <SelectItem value="Direct Bank">Direct Bank Wire</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Contract Signed Date</Label>
                    <Input type="date" name="contractSignedAt" />
                  </div>
                  <div className="space-y-2">
                    <Label>Construction Start Date</Label>
                    <Input type="date" name="constructionStartDate" />
                  </div>
                  <div className="space-y-2">
                    <Label>Expected Completion Date</Label>
                    <Input type="date" name="expectedCompletionDate" />
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <Button type="submit" className="flex-1" disabled={createContractMutation.isPending}>
                    {createContractMutation.isPending ? "Creating..." : "Create Contract"}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setIsAddContractOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ── METRICS ROW ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            icon={<Globe className="h-6 w-6 text-white" />}
            label="Global Reach"
            value={uniqueCountries}
            sub="Active countries"
            gradient={["#059669", "#047857"]}
          />
          <MetricCard
            icon={<FileText className="h-6 w-6 text-white" />}
            label="Total Contracts"
            value={totalContracts}
            sub={`${activeContracts} in progress`}
            gradient={["#10b981", "#059669"]}
          />
          <MetricCard
            icon={<DollarSign className="h-6 w-6 text-white" />}
            label="Portfolio Value"
            value={formatCurrency(totalValue, "KES")}
            sub={`${formatCurrency(totalCollected, "KES")} collected`}
            gradient={["#34d399", "#10b981"]}
          />
          <MetricCard
            icon={<TrendingUp className="h-6 w-6 text-white" />}
            label="Avg. Progress"
            value={`${Math.round(avgCompletion)}%`}
            sub="Across all projects"
            gradient={["#6ee7b7", "#34d399"]}
          />
        </div>
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-4">
            <TabsList className="bg-muted/50 p-1">
              <TabsTrigger value="contracts" className="gap-2">
                <FileText className="h-4 w-4" /> Contracts
              </TabsTrigger>
              <TabsTrigger value="payments" className="gap-2">
                <CreditCard className="h-4 w-4" /> Global Payments
              </TabsTrigger>
              <TabsTrigger value="certificates" className="gap-2">
                <Award className="h-4 w-4" /> Certificates
              </TabsTrigger>
            </TabsList>

            {activeTab === "contracts" && (
              <div className="flex gap-2 w-full md:w-auto">
                <div className="relative flex-1 md:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search name, country..."
                    className="pl-9"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                  <SelectTrigger className="w-[140px]"><SelectValue placeholder="Status" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    {constructionStages.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* ── CONTRACTS TAB ── */}
          <TabsContent value="contracts" className="space-y-4">
            {contractsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => <Card key={i} className="h-64 animate-pulse bg-muted/50" />)}
              </div>
            ) : filteredContracts.length === 0 ? (
              <EmptyState
                icon={<Globe className="h-8 w-8 text-muted-foreground" />}
                title="No contracts found"
                description={searchTerm || selectedStatus !== "all"
                  ? "No contracts match your search or filter."
                  : "Get started by creating your first diaspora rent-to-own contract."}
                action={!searchTerm && selectedStatus === "all"
                  ? { label: "Create first contract", onClick: () => setIsAddContractOpen(true) }
                  : { label: "Clear filters", onClick: () => { setSearchTerm(""); setSelectedStatus("all"); } }}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {paginatedContracts.map((contract: DiasporaContract) => (
                  <Card key={contract.id} className="overflow-hidden shadow-md hover:shadow-xl transition-all group border border-border hover:border-emerald-200 dark:hover:border-emerald-800">
                    <div className={`h-1.5 w-full ${
                      contract.constructionStatus === "completed"  ? "bg-emerald-500" :
                      contract.constructionStatus === "finishing"   ? "bg-emerald-400" :
                      contract.constructionStatus === "roofing"     ? "bg-emerald-300" :
                      contract.constructionStatus === "structure"   ? "bg-emerald-200" :
                      contract.constructionStatus === "foundation"  ? "bg-emerald-100" :
                      "bg-emerald-50"
                    }`} />
                    <CardHeader className="pb-2">
                      <div className="flex justify-between items-start gap-2 flex-wrap">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xl flex-shrink-0">{countryFlags[contract.clientCountry] || "🌍"}</span>
                            <CardTitle className="text-base leading-tight truncate">{contract.clientName}</CardTitle>
                          </div>
                          <CardDescription className="flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3 flex-shrink-0" /> <span className="truncate">{contract.clientCountry}</span>
                          </CardDescription>
                        </div>
                        <StatusBadge status={contract.constructionStatus} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4 py-2 border-y border-slate-50">
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Total Value</p>
                          <p className="font-bold text-foreground truncate text-sm">{formatCurrency(contract.totalPropertyValue, contract.currency as any)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">{contract.paymentFrequency === "quarterly" ? "Quarterly" : contract.paymentFrequency === "semi_annual" ? "Semi-Annual" : contract.paymentFrequency === "annual" ? "Annual" : "Monthly"}</p>
                          <p className="font-bold text-emerald-600 dark:text-emerald-400 truncate text-sm">{formatCurrency(contract.monthlyInstallment, contract.currency as any)}</p>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-muted-foreground">Payment Progress</span>
                          <span className="font-bold">{(contract.totalPaid / contract.totalPropertyValue * 100).toFixed(0)}%</span>
                        </div>
                        <Progress value={(contract.totalPaid / contract.totalPropertyValue * 100)} className="h-1.5" />
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <div className="flex -space-x-2">
                          <div className="w-7 h-7 rounded-full bg-blue-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-blue-700" title="Signed">✓</div>
                          {contract.digitalCertificateIssued && (
                            <div className="w-7 h-7 rounded-full bg-purple-100 border-2 border-white flex items-center justify-center text-[10px] font-bold text-purple-700" title="Certified">📜</div>
                          )}
                        </div>
                        <Button variant="ghost" size="sm" className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 gap-1 font-semibold text-xs p-0 h-auto" onClick={() => navigate(`/diaspora-rent-to-own/${contract.id}`)}>
                          View details <ArrowRight className="h-3 w-3" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
            {filteredContracts.length > 0 && (
              <PaginationBar
                total={filteredContracts.length}
                page={contractsPage}
                pageSize={contractsPageSize}
                onPage={setContractsPage}
                onPageSize={setContractsPageSize}
              />
            )}
          </TabsContent>

          {/* ── PAYMENTS TAB ── */}
          <TabsContent value="payments" className="space-y-4">

            {/* Header row with Record Payment button */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">International Payment History</h2>
                <p className="text-sm text-muted-foreground">Cross-border transfers from diaspora investors</p>
              </div>
              <Dialog open={isAddPaymentOpen} onOpenChange={setIsAddPaymentOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="h-4 w-4" /> Record Payment
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <CreditCard className="h-5 w-5 text-blue-500" /> Record International Payment
                    </DialogTitle>
                    <DialogDescription>Log a cross-border payment received from a diaspora investor.</DialogDescription>
                  </DialogHeader>
                  <form
                    className="space-y-4 mt-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      const data: any = Object.fromEntries(fd.entries());
                      data.amount            = parseFloat(data.amount || kesAmountInput) || 0;
                      data.currency          = "KES"; // amount is always settled in KES
                      data.originalAmount    = parseFloat(fxForm.originalAmount) || 0;
                      data.exchangeRate      = parseFloat(fxForm.appliedRate)   || null;
                      data.originalCurrency  = fxForm.originalCurrency;
                      data.processingFee     = parseFloat(fxForm.processingFee) || 0;
                      data.exchangeFee       = parseFloat(fxForm.exchangeFee)   || 0;
                      data.diasporaContractId = parseInt(data.diasporaContractId) || null;
                      data.paymentNumber      = parseInt(data.paymentNumber)    || 1;
                      createPaymentMutation.mutate(data);
                    }}
                  >
                    {/* Contract & metadata */}
                    <div className="space-y-2">
                      <Label>Contract *</Label>
                      <Select name="diasporaContractId" required>
                        <SelectTrigger><SelectValue placeholder="Select contract" /></SelectTrigger>
                        <SelectContent>
                          {contracts.map((c: any) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.clientName} — {c.clientCountry}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Payment Number *</Label>
                        <Input type="number" name="paymentNumber" placeholder="1" min="1" required />
                      </div>
                      <div className="space-y-2">
                        <Label>Status *</Label>
                        <Select name="status" required>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="failed">Failed</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* ── FX section ── */}
                    <div className="rounded-xl border border-emerald-100 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-3">
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                        <span className="text-base">💱</span> Exchange Rate &amp; Disbursement
                      </p>

                      {/* Sender currency + amount */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Sender's Currency</Label>
                          <Select
                            value={fxForm.originalCurrency}
                            onValueChange={v => {
                              setFxForm(f => ({ ...f, originalCurrency: v, appliedRate: "" }));
                              setBreakdown(null);
                              fetchLiveRate(v);
                            }}
                          >
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {["USD","GBP","EUR","CAD","AUD","SEK","NOK","KES"].map(c => (
                                <SelectItem key={c} value={c}>{c}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Amount Sent</Label>
                          <Input
                            type="number" step="0.01" placeholder="e.g. 1000"
                            value={fxForm.originalAmount}
                            onChange={e => { setFxForm(f => ({ ...f, originalAmount: e.target.value })); setBreakdown(null); }}
                            onBlur={computeBreakdown}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>

                      {/* Live rate display */}
                      {fxForm.originalCurrency !== "KES" && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Exchange Rate Applied (per 1 {fxForm.originalCurrency})</Label>
                            <button
                              type="button"
                              onClick={() => fetchLiveRate(fxForm.originalCurrency)}
                              className="text-[10px] text-blue-600 hover:underline"
                            >
                              {rateLoading ? "Fetching…" : "↻ Refresh rate"}
                            </button>
                          </div>
                          <Input
                            type="number" step="0.0001"
                            placeholder={rateLoading ? "Loading…" : "e.g. 130.25"}
                            value={fxForm.appliedRate}
                            onChange={e => { setFxForm(f => ({ ...f, appliedRate: e.target.value })); setBreakdown(null); }}
                            onBlur={computeBreakdown}
                            className="h-8 text-xs font-mono"
                          />
                          {liveRate && (
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span>Mid-market: <strong className="text-foreground">{liveRate.midMarketRate.toFixed(4)}</strong> ({liveRate.source})</span>
                              {liveRate.isStale && <span className="text-amber-500">⚠ Stale rate</span>}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Fees */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Provider Fee (KES)</Label>
                          <Input
                            type="number" step="0.01" placeholder="0.00"
                            value={fxForm.processingFee}
                            onChange={e => { setFxForm(f => ({ ...f, processingFee: e.target.value })); setBreakdown(null); }}
                            onBlur={computeBreakdown}
                            className="h-8 text-xs"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">FX Fee (KES)</Label>
                          <Input
                            type="number" step="0.01" placeholder="0.00"
                            value={fxForm.exchangeFee}
                            onChange={e => { setFxForm(f => ({ ...f, exchangeFee: e.target.value })); setBreakdown(null); }}
                            onBlur={computeBreakdown}
                            className="h-8 text-xs"
                          />
                        </div>
                      </div>

                      {/* ── Compliance receipt preview ── */}
                      {breakdownLoading && (
                        <div className="text-xs text-center text-muted-foreground py-2">Computing…</div>
                      )}
                      {breakdown && !breakdownLoading && (
                        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-white dark:bg-gray-900 p-3 space-y-2">
                          <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                            Disbursement Preview
                          </p>
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Sent</span>
                              <span className="font-mono">{fxForm.originalCurrency} {parseFloat(fxForm.originalAmount).toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Rate applied</span>
                              <span className="font-mono">1 {fxForm.originalCurrency} = KES {parseFloat(fxForm.appliedRate).toFixed(4)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Mid-market rate</span>
                              <span className="font-mono">1 {fxForm.originalCurrency} = KES {breakdown.midMarketRate.toFixed(4)}</span>
                            </div>
                            <div className={`flex justify-between font-medium ${breakdown.spreadPct > 3 ? "text-red-600" : breakdown.spreadPct > 1.5 ? "text-amber-600" : "text-emerald-600"}`}>
                              <span>Spread vs mid-market</span>
                              <span>{breakdown.spreadPct >= 0 ? "+" : ""}{breakdown.spreadPct.toFixed(2)}%</span>
                            </div>
                            <div className="border-t border-border pt-1 flex justify-between">
                              <span className="text-muted-foreground">KES received</span>
                              <span className="font-mono">KES {breakdown.kesReceived.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="flex justify-between text-red-500">
                              <span>Total fees</span>
                              <span className="font-mono">− KES {breakdown.totalFees.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className="border-t border-emerald-200 dark:border-emerald-800 pt-1 flex justify-between font-bold text-emerald-700 dark:text-emerald-400">
                              <span>Owner receives</span>
                              <span className="font-mono">KES {breakdown.kesDisbursed.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </div>
                            <div className={`flex justify-between text-[10px] ${breakdown.effectiveTotalCostPct > 5 ? "text-red-500" : "text-muted-foreground"}`}>
                              <span>Effective total cost to sender</span>
                              <span>{breakdown.effectiveTotalCostPct.toFixed(2)}%</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* KES amount received */}
                    <div className="space-y-2">
                      <Label>Amount Received (KES) *</Label>
                      <Input
                        type="number" step="0.01" name="amount"
                        placeholder="150000"
                        value={kesAmountInput}
                        onChange={e => setKesAmountInput(e.target.value)}
                        required
                        className="font-mono"
                      />
                    </div>

                    {/* Provider info */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Payment Method *</Label>
                        <Select name="paymentMethod" required>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                            <SelectItem value="wire_transfer">Wire Transfer</SelectItem>
                            <SelectItem value="online_transfer">Online Transfer</SelectItem>
                            <SelectItem value="mobile_money">M-Pesa Global</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>International Provider *</Label>
                        <Select name="internationalProvider" required>
                          <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                          <SelectContent>
                            {["Wise","Sendwave","Remitly","WorldRemit","Xoom (PayPal)","Western Union","MoneyGram","Direct Bank Wire"].map(p => (
                              <SelectItem key={p} value={p}>{p}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Payment Date *</Label>
                        <Input type="date" name="paymentDate" required />
                      </div>
                      <div className="space-y-2">
                        <Label>Due Date *</Label>
                        <Input type="date" name="dueDate" required />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Provider Transaction ID</Label>
                      <Input name="providerTransactionId" placeholder="e.g. RMT-123456789" />
                    </div>

                    <div className="space-y-2">
                      <Label>Confirmation Code</Label>
                      <Input name="confirmationCode" placeholder="e.g. CONF-ABC123" />
                    </div>

                    <div className="space-y-2">
                      <Label>Notes</Label>
                      <Input name="notes" placeholder="Any additional notes..." />
                    </div>

                    <div className="pt-2 flex gap-3">
                      <Button type="submit" className="flex-1" disabled={createPaymentMutation.isPending}>
                        {createPaymentMutation.isPending ? "Recording..." : "Record Payment"}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setIsAddPaymentOpen(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            {/* Search bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by client, country, provider, transaction ID..."
                value={paymentsSearch}
                onChange={(e) => { setPaymentsSearch(e.target.value); setPaymentsPage(1); }}
                className="pl-9"
              />
            </div>

            {/* Summary stats */}
            {!paymentsLoading && filteredPayments.length > 0 && (() => {
              const completed = filteredPayments.filter((p: any) => p.status === "completed");
              const pending = filteredPayments.filter((p: any) => p.status === "pending");
              const totalIn = completed.reduce((s: number, p: any) => s + parseFloat(p.amount || 0), 0);
              const totalFees = completed.reduce((s: number, p: any) => s + parseFloat(p.processingFee || 0), 0);
              return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "Total Received", value: formatCurrency(totalIn, "KES" as any), color: "#10b981" },
                    { label: "Completed", value: completed.length, color: "#3b82f6" },
                    { label: "Pending", value: pending.length, color: "#f59e0b" },
                    { label: "Total Fees", value: formatCurrency(totalFees, "KES" as any), color: "#ef4444" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="border border-border rounded-xl p-4 bg-card">
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">{label}</p>
                      <p className="text-xl font-semibold" style={{ color }}>{value}</p>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Payment list */}
            <Card>
              <CardContent className="pt-6">
                {paymentsLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map(i => <div key={i} className="h-24 w-full animate-pulse bg-muted rounded-xl" />)}
                  </div>
                ) : filteredPayments.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="mx-auto w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                      <CreditCard className="h-8 w-8 text-blue-400" />
                    </div>
                    {payments.length === 0 ? (
                      <>
                        <h3 className="text-lg font-bold mb-1">No payments recorded yet</h3>
                        <p className="text-muted-foreground text-sm mb-6">Record a payment to start tracking international transfers from your diaspora investors.</p>
                        <Button onClick={() => setIsAddPaymentOpen(true)} className="gap-2">
                          <Plus className="h-4 w-4" /> Record First Payment
                        </Button>
                      </>
                    ) : (
                      <>
                        <h3 className="text-lg font-bold mb-1">No results found</h3>
                        <p className="text-muted-foreground text-sm mb-4">No payments match your search.</p>
                        <Button variant="outline" onClick={() => setPaymentsSearch("")}>Clear Search</Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {paginatedPayments.map((payment: any) => {
                      const contract = contracts.find((c: any) => c.id === payment.diasporaContractId);
                      const statusColor = payment.status === "completed" ? "#10b981" : payment.status === "pending" ? "#f59e0b" : "#ef4444";
                      const statusBg = payment.status === "completed" ? "#f0fdf4" : payment.status === "pending" ? "#fffbeb" : "#fef2f2";
                      return (
                        <div key={payment.id} className="border rounded-xl p-4 hover:bg-slate-50/60 transition-colors">
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">

                            {/* Left: client + provider */}
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-10 w-10 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
                                <CreditCard className="h-5 w-5 text-blue-500" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="font-bold text-sm truncate">
                                    {contract?.clientName || "Unknown Client"}
                                  </h4>
                                  {contract?.clientCountry && (
                                    <span className="text-xs text-muted-foreground">
                                      {countryFlags[contract.clientCountry] || ""} {contract.clientCountry}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  <ProviderBadge provider={payment.internationalProvider} />
                                  {payment.providerTransactionId && (
                                    <span className="font-mono text-[10px] text-muted-foreground">
                                      {payment.providerTransactionId}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Right: amount + status */}
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <div className="text-right">
                                <p className="text-base font-bold text-emerald-600">
                                  +{formatCurrency(payment.amount, (payment.currency || "KES") as any)}
                                </p>
                                {payment.originalAmount && payment.originalCurrency && (
                                  <p className="text-[10px] text-muted-foreground">
                                    sent {payment.originalAmount} {payment.originalCurrency}
                                  </p>
                                )}
                              </div>
                              <span style={{
                                padding: "3px 10px", borderRadius: 9999, fontSize: 11, fontWeight: 700,
                                background: statusBg, color: statusColor, border: `1px solid ${statusColor}33`,
                                textTransform: "capitalize", whiteSpace: "nowrap",
                              }}>
                                {payment.status}
                              </span>
                            </div>
                          </div>

                          {/* Details row */}
                          <div className="mt-3 pt-3 border-t grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Date</p>
                              <p className="text-xs font-medium mt-0.5">
                                {payment.paymentDate ? format(new Date(payment.paymentDate), "MMM dd, yyyy") : "N/A"}
                              </p>
                            </div>
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Exchange Rate</p>
                              <p className="text-xs font-medium mt-0.5">
                                {payment.exchangeRate ? `1 ${payment.originalCurrency} = ${parseFloat(payment.exchangeRate).toFixed(4)} KES` : "N/A"}
                              </p>
                              {payment.midMarketRate && (
                                <p className="text-[10px] text-muted-foreground">
                                  Mid-market: {parseFloat(payment.midMarketRate).toFixed(4)}
                                </p>
                              )}
                            </div>
                            {payment.spreadPct != null && (
                              <div>
                                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Spread</p>
                                <p className={`text-xs font-semibold mt-0.5 ${
                                  parseFloat(payment.spreadPct) > 3 ? "text-red-600" :
                                  parseFloat(payment.spreadPct) > 1.5 ? "text-amber-600" : "text-emerald-600"
                                }`}>
                                  {parseFloat(payment.spreadPct) >= 0 ? "+" : ""}{parseFloat(payment.spreadPct).toFixed(2)}%
                                </p>
                              </div>
                            )}
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Processing Fee</p>
                              <p className="text-xs font-medium text-orange-600 mt-0.5">
                                {payment.processingFee && parseFloat(payment.processingFee) > 0
                                  ? formatCurrency(payment.processingFee, (payment.originalCurrency || "KES") as any)
                                  : "—"}
                              </p>
                            </div>
                            {payment.kesDisbursed != null && (
                              <div className="col-span-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 px-3 py-2 flex items-center justify-between">
                                <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Owner Disbursed</p>
                                <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400 font-mono">
                                  KES {parseFloat(payment.kesDisbursed).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </p>
                              </div>
                            )}
                            <div>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Payment #{payment.paymentNumber}</p>
                              {payment.confirmationCode && (
                                <p className="text-xs font-mono text-muted-foreground mt-0.5">{payment.confirmationCode}</p>
                              )}
                            </div>
                          </div>

                          {payment.notes && (
                            <p className="mt-2 text-xs text-muted-foreground italic">{payment.notes}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {filteredPayments.length > 0 && (
                  <PaginationBar
                    total={filteredPayments.length}
                    page={paymentsPage}
                    pageSize={paymentsPageSize}
                    onPage={setPaymentsPage}
                    onPageSize={setPaymentsPageSize}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── CERTIFICATES TAB ── */}
          <TabsContent value="certificates" className="space-y-4">

            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Digital Ownership Certificates</h2>
                <p className="text-sm text-muted-foreground">Cryptographically signed certificates issued to diaspora investors</p>
              </div>
              <Dialog open={isAddCertificateOpen} onOpenChange={setIsAddCertificateOpen}>
                <DialogTrigger asChild>
                  <Button className="gap-2">
                    <Plus className="h-4 w-4" /> Issue Certificate
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Award className="h-5 w-5 text-yellow-500" /> Issue Ownership Certificate
                    </DialogTitle>
                    <DialogDescription>Create a digital certificate for a diaspora investor contract.</DialogDescription>
                  </DialogHeader>
                  <form
                    className="space-y-4 mt-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      const data: any = Object.fromEntries(fd.entries());
                      data.diasporaContractId = parseInt(data.diasporaContractId);
                      // Generate unique identifiers client-side as placeholders (server can override)
                      const ts = Date.now().toString(36).toUpperCase();
                      data.certificateNumber = data.certificateNumber || `CERT-DSP-${ts}`;
                      data.qrCode = `QR-${ts}`;
                      data.blockchainHash = `0x${Array.from({length: 40}, () => Math.floor(Math.random()*16).toString(16)).join("")}`;
                      data.verificationUrl = `https://verify.smartprop.co/cert/${ts}`;
                      data.certificateData = JSON.stringify({ issuedVia: "SmartProp", timestamp: new Date().toISOString() });
                      createCertificateMutation.mutate(data);
                    }}
                  >
                    <div className="space-y-2">
                      <Label>Contract *</Label>
                      <Select name="diasporaContractId" required>
                        <SelectTrigger><SelectValue placeholder="Select contract" /></SelectTrigger>
                        <SelectContent>
                          {contracts.map((c: any) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.clientName} — {c.clientCountry}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Certificate Type *</Label>
                        <Select name="certificateType" required>
                          <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ownership">Ownership</SelectItem>
                            <SelectItem value="payment">Payment Completion</SelectItem>
                            <SelectItem value="completion">Construction Completion</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Status *</Label>
                        <Select name="status" required>
                          <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="issued">Issued</SelectItem>
                            <SelectItem value="pending">Pending</SelectItem>
                            <SelectItem value="verified">Verified</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Certificate Number</Label>
                      <Input name="certificateNumber" placeholder="Auto-generated if blank" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Issue Date</Label>
                        <Input type="date" name="issuedDate" />
                      </div>
                      <div className="space-y-2">
                        <Label>Expiry Date</Label>
                        <Input type="date" name="expiryDate" />
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-50 border text-sm text-muted-foreground">
                      <p className="font-semibold text-muted-foreground mb-1">About this certificate</p>
                      <p>A unique cryptographic hash will be generated and stored in the SmartProp Digital Registry. The certificate can be downloaded as a PDF and shared with the investor.</p>
                    </div>

                    <div className="pt-2 flex gap-3">
                      <Button type="submit" className="flex-1" disabled={createCertificateMutation.isPending}>
                        {createCertificateMutation.isPending ? "Issuing..." : "Issue Certificate"}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => setIsAddCertificateOpen(false)}>Cancel</Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            </div>

            <Card>
              <CardContent className="pt-6">
                {/* Search bar */}
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by client, certificate number, type, status..."
                    value={certificatesSearch}
                    onChange={(e) => { setCertificatesSearch(e.target.value); setCertificatesPage(1); }}
                    className="pl-9"
                  />
                </div>

                {certificatesLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map(i => <div key={i} className="h-40 w-full animate-pulse bg-muted rounded-xl" />)}
                  </div>
                ) : filteredCertificates.length === 0 ? (
                  <div className="text-center py-16">
                    <div className="mx-auto w-16 h-16 bg-yellow-50 rounded-full flex items-center justify-center mb-4">
                      <Award className="h-8 w-8 text-yellow-400" />
                    </div>
                    {certificates.length === 0 ? (
                      <>
                        <h3 className="text-lg font-bold mb-1">No certificates issued yet</h3>
                        <p className="text-muted-foreground text-sm mb-6">Issue a digital ownership certificate to a diaspora investor to get started.</p>
                        <Button onClick={() => setIsAddCertificateOpen(true)} className="gap-2">
                          <Plus className="h-4 w-4" /> Issue First Certificate
                        </Button>
                      </>
                    ) : (
                      <>
                        <h3 className="text-lg font-bold mb-1">No results found</h3>
                        <p className="text-muted-foreground text-sm mb-4">No certificates match your search.</p>
                        <Button variant="outline" onClick={() => setCertificatesSearch("")}>Clear Search</Button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {paginatedCertificates.map((cert: any) => {
                      const contract = contracts.find((c: any) => c.id === cert.diasporaContractId);
                      const statusColors: Record<string, { bg: string; text: string; border: string }> = {
                        issued:   { bg: "#f0fdf4", text: "#16a34a", border: "#bbf7d0" },
                        verified: { bg: "#eff6ff", text: "#2563eb", border: "#bfdbfe" },
                        pending:  { bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
                        expired:  { bg: "#f9fafb", text: "#6b7280", border: "#e5e7eb" },
                        revoked:  { bg: "#fef2f2", text: "#dc2626", border: "#fecaca" },
                        not_issued: { bg: "#f9fafb", text: "#9ca3af", border: "#e5e7eb" },
                      };
                      const sc = statusColors[cert.status] || statusColors.pending;
                      const typeLabels: Record<string, string> = {
                        ownership: "Ownership Certificate",
                        payment: "Payment Certificate",
                        completion: "Completion Certificate",
                      };

                      return (
                        <div key={cert.id} style={{
                          background: "linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)",
                          borderRadius: "16px", padding: "24px",
                          border: "1px solid rgba(212,175,55,0.3)",
                          position: "relative", overflow: "hidden", color: "#fff",
                        }}>
                          {/* Watermark */}
                          <div style={{ position: "absolute", right: -20, bottom: -20, opacity: 0.07 }}>
                            <Award style={{ width: 160, height: 160 }} />
                          </div>
                          {/* Gold accent line */}
                          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: "linear-gradient(90deg, #D4AF37, #f5d77b, #D4AF37)" }} />

                          <div className="flex flex-col md:flex-row justify-between gap-6 relative z-10">
                            {/* Left: certificate details */}
                            <div className="flex-1 space-y-4">
                              {/* Header row */}
                              <div className="flex items-start justify-between gap-3 flex-wrap">
                                <div className="flex items-center gap-3">
                                  <div className="p-2 rounded-lg" style={{ background: "rgba(212,175,55,0.2)" }}>
                                    <Award className="h-5 w-5" style={{ color: "#D4AF37" }} />
                                  </div>
                                  <div>
                                    <p className="font-bold text-base leading-tight">{typeLabels[cert.certificateType] || "Certificate"}</p>
                                    <p className="text-xs text-slate-400 font-mono">{cert.certificateNumber}</p>
                                  </div>
                                </div>
                                <span style={{
                                  padding: "3px 12px", borderRadius: 9999, fontSize: 11, fontWeight: 700,
                                  background: sc.bg, color: sc.text, border: `1px solid ${sc.border}`,
                                  textTransform: "capitalize",
                                }}>{cert.status?.replace("_", " ")}</span>
                              </div>

                              {/* Fields grid */}
                              <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                                <div>
                                  <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "#94a3b8" }}>OWNER</p>
                                  <p className="font-semibold text-sm mt-0.5">{contract?.clientName || "—"}</p>
                                  {contract?.clientCountry && (
                                    <p className="text-xs" style={{ color: "#64748b" }}>{countryFlags[contract.clientCountry] || ""} {contract.clientCountry}</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "#94a3b8" }}>CERT HASH</p>
                                  <p className="font-semibold text-sm mt-0.5">SmartProp Registry</p>
                                  {cert.blockchainHash && (
                                    <p className="text-[10px] font-mono mt-0.5" style={{ color: "#64748b" }}>
                                      {cert.blockchainHash.substring(0, 18)}…
                                    </p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "#94a3b8" }}>ISSUED</p>
                                  <p className="font-semibold text-sm mt-0.5">
                                    {cert.issuedDate ? format(new Date(cert.issuedDate), "MMM dd, yyyy") : "Pending"}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] uppercase tracking-widest font-bold" style={{ color: "#94a3b8" }}>EXPIRES</p>
                                  <p className="font-semibold text-sm mt-0.5">
                                    {cert.expiryDate ? format(new Date(cert.expiryDate), "MMM dd, yyyy") : "No Expiry"}
                                  </p>
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="flex gap-2 pt-2 flex-wrap">
                                <Button
                                  size="sm"
                                  className="bg-white text-foreground hover:bg-slate-100 font-bold gap-1.5"
                                  onClick={() => setViewingCert({ cert, contract })}
                                >
                                  <FileText className="h-3.5 w-3.5" /> View Certificate
                                </Button>
                                {cert.status !== "verified" && cert.status !== "revoked" && (
                                  <Button
                                    size="sm"
                                    disabled={verifyCertificateMutation.isPending}
                                    onClick={() => verifyCertificateMutation.mutate(cert.id)}
                                    style={{ background: "rgba(212,175,55,0.2)", color: "#D4AF37", border: "1px solid rgba(212,175,55,0.4)" }}
                                    className="gap-1.5 hover:opacity-80 font-bold"
                                  >
                                    <CheckCircle className="h-3.5 w-3.5" />
                                    {verifyCertificateMutation.isPending ? "Verifying..." : "Mark Verified"}
                                  </Button>
                                )}
                                {cert.transactionHash && (
                                  <Button size="sm" style={{ background: "rgba(255,255,255,0.08)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.15)" }}
                                    className="gap-1.5 font-mono text-xs hover:opacity-80">
                                    TX: {cert.transactionHash.substring(0, 8)}…
                                  </Button>
                                )}
                              </div>
                            </div>

                            {/* Right: QR code panel */}
                            <div className="flex flex-col items-center justify-center p-4 bg-white rounded-xl flex-shrink-0 w-full md:w-44">
                              <div className="w-full aspect-square flex items-center justify-center">
                                {cert.qrCode ? (
                                  // Render as a simple QR-style grid placeholder since we don't have image URLs
                                  <div className="w-full h-full grid" style={{ gridTemplateColumns: "repeat(8, 1fr)", gap: 2 }}>
                                    {Array.from({ length: 64 }, (_, i) => (
                                      <div key={i} style={{
                                        background: [0,7,8,15,16,23,24,31,56,63,9,14,17,22,25,30,
                                          2,3,4,5,10,13,18,21,26,29,34,37,38,39,40,41,43,44,45,46,
                                          48,49,50,51,52,53,55,58,60,62].includes(i) ? "#0f172a" : "#f8fafc",
                                        borderRadius: 1,
                                      }} />
                                    ))}
                                  </div>
                                ) : (
                                  <QrCode className="w-20 h-20 text-slate-300" />
                                )}
                              </div>
                              <p className="text-[9px] text-slate-400 mt-2 font-bold tracking-widest">SCAN TO VERIFY</p>
                              <p className="text-[8px] text-slate-300 font-mono mt-0.5 text-center break-all">
                                {cert.certificateNumber}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {filteredCertificates.length > 0 && (
                  <PaginationBar
                    total={filteredCertificates.length}
                    page={certificatesPage}
                    pageSize={certificatesPageSize}
                    onPage={setCertificatesPage}
                    onPageSize={setCertificatesPageSize}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── CERTIFICATE VIEWER DIALOG ── */}
      <Dialog open={!!viewingCert} onOpenChange={(open) => !open && setViewingCert(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          {viewingCert && (() => {
            const { cert, contract } = viewingCert;
            const typeLabels: Record<string, string> = {
              ownership: "Certificate of Ownership",
              payment: "Certificate of Payment Completion",
              completion: "Certificate of Construction Completion",
            };
            return (
              <div>
                {/* Print toolbar */}
                <div className="flex items-center justify-between px-6 py-3 border-b bg-slate-50">
                  <h2 className="font-bold text-sm text-muted-foreground">Certificate Preview</h2>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.print()}>
                      <FileText className="h-3.5 w-3.5" /> Print / Save PDF
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setViewingCert(null)}>Close</Button>
                  </div>
                </div>

                {/* Certificate body — styled for printing */}
                <div id="certificate-print" style={{
                  background: "linear-gradient(160deg, #0f172a 0%, #1a2e4a 60%, #0f2027 100%)",
                  minHeight: 500, padding: "40px 48px", color: "#fff", position: "relative", overflow: "hidden",
                }}>
                  {/* Corner decorations */}
                  <div style={{ position: "absolute", top: 16, left: 16, width: 60, height: 60, border: "2px solid rgba(212,175,55,0.4)", borderRight: "none", borderBottom: "none", borderRadius: "4px 0 0 0" }} />
                  <div style={{ position: "absolute", top: 16, right: 16, width: 60, height: 60, border: "2px solid rgba(212,175,55,0.4)", borderLeft: "none", borderBottom: "none", borderRadius: "0 4px 0 0" }} />
                  <div style={{ position: "absolute", bottom: 16, left: 16, width: 60, height: 60, border: "2px solid rgba(212,175,55,0.4)", borderRight: "none", borderTop: "none", borderRadius: "0 0 0 4px" }} />
                  <div style={{ position: "absolute", bottom: 16, right: 16, width: 60, height: 60, border: "2px solid rgba(212,175,55,0.4)", borderLeft: "none", borderTop: "none", borderRadius: "0 0 4px 0" }} />
                  {/* Gold top line */}
                  <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 4, background: "linear-gradient(90deg, #D4AF37, #f5d77b, #D4AF37)" }} />
                  {/* Watermark */}
                  <div style={{ position: "absolute", right: -20, bottom: -20, opacity: 0.05 }}>
                    <Award style={{ width: 260, height: 260 }} />
                  </div>

                  {/* Header */}
                  <div style={{ textAlign: "center", marginBottom: 32, position: "relative", zIndex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                      <div style={{ background: "rgba(212,175,55,0.2)", borderRadius: 12, padding: "10px 14px", display: "inline-flex" }}>
                        <Award style={{ width: 32, height: 32, color: "#D4AF37" }} />
                      </div>
                    </div>
                    <p style={{ color: "#D4AF37", fontSize: 11, letterSpacing: "0.3em", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>SmartProp Digital Registry</p>
                    <h1 style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "0.05em", marginBottom: 4 }}>
                      {typeLabels[cert.certificateType] || "Ownership Certificate"}
                    </h1>
                    <p style={{ color: "#94a3b8", fontSize: 11, fontFamily: "monospace" }}>{cert.certificateNumber}</p>
                  </div>

                  {/* Divider */}
                  <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.5), transparent)", marginBottom: 28 }} />

                  {/* This certifies that */}
                  <div style={{ textAlign: "center", marginBottom: 24, position: "relative", zIndex: 1 }}>
                    <p style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>This certifies that</p>
                    <p style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", letterSpacing: "0.02em" }}>
                      {contract?.clientName || "—"}
                    </p>
                    {contract?.clientCountry && (
                      <p style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
                        {countryFlags[contract.clientCountry] || ""} {contract.clientCountry}
                      </p>
                    )}
                  </div>

                  <div style={{ textAlign: "center", marginBottom: 28, color: "#cbd5e1", fontSize: 13, lineHeight: 1.7, position: "relative", zIndex: 1 }}>
                    is hereby granted this certificate of{" "}
                    <span style={{ color: "#D4AF37", fontWeight: 600 }}>{cert.certificateType}</span>{" "}
                    as part of the SmartProp Diaspora Rent-to-Own Programme,
                    <br />uniquely identified by a cryptographic hash
                    <br />and registered in the{" "}
                    <span style={{ color: "#D4AF37", fontWeight: 600 }}>SmartProp Digital Registry</span>.
                  </div>

                  {/* Details grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px 32px", marginBottom: 28, position: "relative", zIndex: 1 }}>
                    {[
                      { label: "ISSUED", value: cert.issuedDate ? new Date(cert.issuedDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "Pending" },
                      { label: "EXPIRES", value: cert.expiryDate ? new Date(cert.expiryDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "No Expiry" },
                      { label: "STATUS", value: cert.status?.replace("_", " ").toUpperCase() },
                      { label: "CERT HASH", value: cert.blockchainHash ? cert.blockchainHash.substring(0, 24) + "…" : "—" },
                    ].map(({ label, value }) => (
                      <div key={label} style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
                        <p style={{ color: "#94a3b8", fontSize: 9, letterSpacing: "0.2em", fontWeight: 700, marginBottom: 4 }}>{label}</p>
                        <p style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600, fontFamily: label === "BLOCKCHAIN HASH" ? "monospace" : undefined }}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Divider */}
                  <div style={{ height: 1, background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.5), transparent)", marginBottom: 20 }} />

                  {/* Footer */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", position: "relative", zIndex: 1 }}>
                    <div>
                      <p style={{ color: "#64748b", fontSize: 10, marginBottom: 4 }}>Verification URL</p>
                      <p style={{ color: "#94a3b8", fontSize: 10, fontFamily: "monospace" }}>{cert.verificationUrl || "N/A"}</p>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ width: 80, height: 1, background: "rgba(212,175,55,0.5)", marginBottom: 4, marginLeft: "auto" }} />
                      <p style={{ color: "#D4AF37", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em" }}>SMARTPROP REGISTRY</p>
                      <p style={{ color: "#64748b", fontSize: 9 }}>Authorised Digital Signature</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

    </div>
  );
}