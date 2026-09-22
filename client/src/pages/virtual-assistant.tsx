import React, { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MessageCircle,
  Mic, MicOff, Send, Bot,
  Calendar, FileText, DollarSign, Users, Home,
  Clock, CheckCircle, Zap, Brain,
  TrendingUp, TrendingDown, AlertCircle, Wrench,
  Activity,
} from "lucide-react";

interface ChatMessage {
  id: string;
  type: "user" | "assistant";
  message: string;
  timestamp: string;
}

interface Suggestion {
  id: string;
  title: string;
  description: string;
  category: "maintenance" | "rent" | "tenant" | "financial" | "marketing";
  icon: React.ReactNode;
  impact: string;
  severity: "info" | "warning" | "success";
  href?: string;
}

const categoryIcons = {
  maintenance: <Home className="h-4 w-4" />,
  rent:        <DollarSign className="h-4 w-4" />,
  tenant:      <Users className="h-4 w-4" />,
  financial:   <FileText className="h-4 w-4" />,
  marketing:   <TrendingUp className="h-4 w-4" />,
};

const severityColors = {
  info:    "border-l-blue-500  bg-blue-50/30  dark:bg-blue-950/10",
  warning: "border-l-amber-500 bg-amber-50/30 dark:bg-amber-950/10",
  success: "border-l-emerald-500 bg-emerald-50/30 dark:bg-emerald-950/10",
};

export default function VirtualAssistant() {
  const [activeTab, setActiveTab]     = useState("chat");
  const [chatMessage, setChatMessage] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSending, setIsSending]     = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([{
    id: "1", type: "assistant", timestamp: new Date().toISOString(),
    message: "Hello! I have access to your live property data. I can answer questions about occupancy, rent collections, maintenance requests, and your portfolio. What would you like to know?",
  }]);

  // ── Live data ─────────────────────────────────────────────────────────────

  const { data: dashMetrics } = useQuery({
    queryKey: ["/api/dashboard/metrics"],
    queryFn: async () => { const r = await apiRequest("/api/dashboard/metrics"); return r.json(); },
    staleTime: 60_000,
  });

  const { data: rentStats } = useQuery({
    queryKey: ["/api/rent-payments/stats"],
    queryFn: async () => { const r = await apiRequest("/api/rent-payments/stats"); return r.json(); },
    staleTime: 60_000,
  });

  const { data: recentMaint = [] } = useQuery({
    queryKey: ["/api/maintenance-requests", "recent"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/maintenance-requests?limit=5&sort=newest")).json()),
    staleTime: 60_000,
  });

  const { data: recentPayments = [] } = useQuery({
    queryKey: ["/api/rent-payments", "recent"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/rent-payments?limit=5&sort=newest")).json()),
    staleTime: 60_000,
  });

  // ── Computed real-data suggestions ────────────────────────────────────────
  const suggestions: Suggestion[] = useMemo(() => {
    const items: Suggestion[] = [];
    const dm = dashMetrics as any;
    const rs = rentStats   as any;

    // 1. Occupancy
    const totalUnits    = Number(dm?.totalUnits    ?? 0);
    const occupiedUnits = Number(dm?.occupiedUnits ?? 0);
    const vacantUnits   = totalUnits - occupiedUnits;
    if (vacantUnits > 0) {
      items.push({
        id: "occ-1", category: "marketing", icon: <Home className="h-4 w-4" />,
        title: `${vacantUnits} vacant unit${vacantUnits > 1 ? "s" : ""}`,
        description: `Your portfolio has ${vacantUnits} of ${totalUnits} units vacant. Each empty unit represents lost monthly revenue. Check the Letting Pipeline to see active prospects.`,
        impact: `KES ${(vacantUnits * Number(dm?.avgRent ?? 50000)).toLocaleString("en-KE")}/mo lost`,
        severity: vacantUnits > 3 ? "warning" : "info",
        href: "/prospects",
      });
    }

    // 2. Arrears
    const overdueAmount = Number(rs?.overdue ?? dm?.overdueRent ?? 0);
    const overdueCount  = Number(rs?.overdueCount ?? 0);
    if (overdueAmount > 0) {
      items.push({
        id: "arr-1", category: "rent", icon: <DollarSign className="h-4 w-4" />,
        title: `KES ${overdueAmount.toLocaleString("en-KE")} in arrears`,
        description: `${overdueCount} tenant${overdueCount !== 1 ? "s" : ""} ${overdueCount !== 1 ? "have" : "has"} overdue rent totalling KES ${overdueAmount.toLocaleString("en-KE")}. WhatsApp reminders are sent automatically but manual follow-up may be needed for long-overdue cases.`,
        impact: `${overdueCount} tenant${overdueCount !== 1 ? "s" : ""} overdue`,
        severity: overdueAmount > 100000 ? "warning" : "info",
        href: "/arrears",
      });
    }

    // 3. Pending maintenance
    const pendingMaint = Number(dm?.pendingRequests ?? 0);
    if (pendingMaint > 0) {
      items.push({
        id: "maint-1", category: "maintenance", icon: <Wrench className="h-4 w-4" />,
        title: `${pendingMaint} maintenance request${pendingMaint !== 1 ? "s" : ""} pending`,
        description: `There ${pendingMaint !== 1 ? "are" : "is"} ${pendingMaint} open maintenance request${pendingMaint !== 1 ? "s" : ""}. Unresolved requests affect tenant satisfaction and can escalate in cost if left unattended.`,
        impact: `${pendingMaint} open ticket${pendingMaint !== 1 ? "s" : ""}`,
        severity: pendingMaint > 5 ? "warning" : "info",
        href: "/maintenance",
      });
    }

    // 4. Collection rate
    const collectionRate = Number(rs?.collectionRate ?? 0);
    if (collectionRate > 0 && collectionRate < 90) {
      items.push({
        id: "coll-1", category: "financial", icon: <TrendingDown className="h-4 w-4" />,
        title: `Collection rate at ${collectionRate}%`,
        description: `Rent collection this period is ${collectionRate}%. An industry benchmark for professional PM companies in Nairobi is 95%+. Consider reviewing payment reminders and M-Pesa paybill visibility.`,
        impact: `${(100 - collectionRate).toFixed(1)}% below 100%`,
        severity: collectionRate < 75 ? "warning" : "info",
        href: "/rent-collection",
      });
    } else if (collectionRate >= 95) {
      items.push({
        id: "coll-2", category: "financial", icon: <TrendingUp className="h-4 w-4" />,
        title: `Strong collection rate: ${collectionRate}%`,
        description: "Excellent rent collection performance. Your automated reminders and M-Pesa integration are working well.",
        impact: "Above 95% benchmark",
        severity: "success",
        href: "/rent-collection",
      });
    }

    // 5. Total portfolio value (informational)
    const totalRevenue = Number(dm?.totalRevenue ?? rs?.collected ?? 0);
    if (totalRevenue > 0) {
      items.push({
        id: "rev-1", category: "financial", icon: <FileText className="h-4 w-4" />,
        title: `KES ${totalRevenue.toLocaleString("en-KE")} collected this period`,
        description: `Rent collected this period across ${totalUnits} units. Review the Owner Statements page to generate remittance reports for your landlords.`,
        impact: `Across ${occupiedUnits} occupied units`,
        severity: "success",
        href: "/owner-statements",
      });
    }

    // If no live data yet, show a placeholder
    if (items.length === 0) {
      items.push({
        id: "loading-1", category: "financial", icon: <Activity className="h-4 w-4" />,
        title: "Loading portfolio insights…",
        description: "Suggestions are computed from your live portfolio data. They will appear once your dashboard metrics have loaded.",
        impact: "—",
        severity: "info",
      });
    }

    return items;
  }, [dashMetrics, rentStats]);

  // ── Chat handler — calls Anthropic API with org context ───────────────────
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatHistory]);

  const handleSendMessage = async () => {
    const text = chatMessage.trim();
    if (!text || isSending) return;

    const userMsg: ChatMessage = { id: Date.now().toString(), type: "user", message: text, timestamp: new Date().toISOString() };
    setChatHistory(prev => [...prev, userMsg]);
    setChatMessage("");
    setIsSending(true);

    try {
      const dm = dashMetrics as any;
      const rs = rentStats   as any;

      // Build a concise context snapshot for the AI
      const context = [
        `You are a property management assistant for SmartProp, a system used by property managers in Nairobi, Kenya.`,
        `Keep answers concise and specific. Use KES for currency. Reference Nairobi neighbourhoods, KRA, M-Pesa, and Kenyan tenancy law when relevant.`,
        ``,
        `Current portfolio snapshot:`,
        `- Total properties: ${dm?.totalProperties ?? "unknown"}`,
        `- Total units: ${dm?.totalUnits ?? "unknown"}, occupied: ${dm?.occupiedUnits ?? "unknown"}, vacant: ${Number(dm?.totalUnits ?? 0) - Number(dm?.occupiedUnits ?? 0)}`,
        `- Pending maintenance requests: ${dm?.pendingRequests ?? "unknown"}`,
        `- Rent collected this period: KES ${Number(rs?.collected ?? dm?.totalRevenue ?? 0).toLocaleString("en-KE")}`,
        `- Overdue rent: KES ${Number(rs?.overdue ?? dm?.overdueRent ?? 0).toLocaleString("en-KE")} across ${rs?.overdueCount ?? "unknown"} tenants`,
        `- Collection rate: ${rs?.collectionRate ?? "unknown"}%`,
      ].join("\n");

      // Call the server-side proxy — keeps the Anthropic API key off the browser
      const response = await apiRequest("/api/ai/chat", {
        method: "POST",
        data: {
          system: context,
          messages: [
            ...chatHistory.slice(-6).map(m => ({
              role: m.type === "user" ? "user" : "assistant",
              content: m.message,
            })),
            { role: "user", content: text },
          ],
          max_tokens: 1000,
        },
      });

      const data = await response.json();
      const reply = data?.reply
        ?? "I'm sorry, I wasn't able to get a response. Please try again.";

      const assistantMsg: ChatMessage = {
        id:        (Date.now() + 1).toString(),
        type:      "assistant",
        message:   reply,
        timestamp: new Date().toISOString(),
      };
      setChatHistory(prev => [...prev, assistantMsg]);
    } catch {
      setChatHistory(prev => [...prev, {
        id: (Date.now() + 1).toString(), type: "assistant", timestamp: new Date().toISOString(),
        message: "I couldn't reach the AI service right now. Your portfolio data is still available on the Dashboard.",
      }]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  // ── Recent activity feed (replaces fake "Voice Commands" history) ─────────
  const recentActivity = useMemo(() => {
    const items: Array<{ id: string; label: string; sub: string; time: string; icon: React.ReactNode }> = [];

    ensureArray(recentMaint).slice(0, 4).forEach((m: any) => {
      items.push({
        id:    `maint-${m.id}`,
        label: m.title ?? "Maintenance request",
        sub:   `#${m.ticketNumber} · ${m.status ?? "pending"}`,
        time:  m.createdAt,
        icon:  <Wrench className="h-3.5 w-3.5 text-amber-500" />,
      });
    });

    ensureArray(recentPayments).slice(0, 4).forEach((p: any) => {
      items.push({
        id:    `pay-${p.id}`,
        label: `KES ${Number(p.amount).toLocaleString("en-KE")} received`,
        sub:   `${p.paymentMethod ?? "M-Pesa"} · ${p.status ?? "paid"}`,
        time:  p.paidDate ?? p.createdAt,
        icon:  <DollarSign className="h-3.5 w-3.5 text-emerald-500" />,
      });
    });

    return items
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 6);
  }, [recentMaint, recentPayments]);

  const dm = dashMetrics as any;

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bot className="h-6 w-6 text-blue-600" />
            Property Assistant
          </h1>
          <p className="text-sm text-muted-foreground">Ask questions about your portfolio or review live insights.</p>
        </div>
      </div>

      {/* KPI strip — live data only */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4 pb-3">
          <p className="text-xs text-muted-foreground">Messages</p>
          <p className="text-xl font-semibold text-blue-600">{chatHistory.length}</p>
          <p className="text-xs text-muted-foreground">this session</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <p className="text-xs text-muted-foreground">Pending maintenance</p>
          <p className="text-xl font-semibold text-amber-600">{dm?.pendingRequests ?? "—"}</p>
          <p className="text-xs text-muted-foreground">open requests</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <p className="text-xs text-muted-foreground">Occupied units</p>
          <p className="text-xl font-semibold text-emerald-600">{dm?.occupiedUnits ?? "—"}<span className="text-sm text-muted-foreground">/{dm?.totalUnits ?? "—"}</span></p>
          <p className="text-xs text-muted-foreground">units occupied</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 pb-3">
          <p className="text-xs text-muted-foreground">Overdue rent</p>
          <p className="text-xl font-semibold text-red-600">{dm?.overdueRent ?? "—"}</p>
          <p className="text-xs text-muted-foreground">KES overdue</p>
        </CardContent></Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-muted/50">
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="activity">Recent activity</TabsTrigger>
        </TabsList>

        {/* ── Chat tab ───────────────────────────────────────────────────────── */}
        <TabsContent value="chat" className="mt-4">
          <Card className="flex flex-col" style={{ height: "520px" }}>
            <CardContent className="flex-1 flex flex-col p-4 gap-3 overflow-hidden">
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {chatHistory.map(msg => (
                  <div key={msg.id} className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      msg.type === "user" ? "bg-blue-600 text-white" : "bg-muted border"
                    }`}>
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.message}</p>
                      <p className="text-xs mt-1 opacity-60">{new Date(msg.timestamp).toLocaleTimeString("en-KE")}</p>
                    </div>
                  </div>
                ))}
                {isSending && (
                  <div className="flex justify-start">
                    <div className="bg-muted border rounded-lg px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 animate-spin" /> Thinking…
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="flex gap-2 border-t pt-3">
                <Input
                  placeholder="Ask about occupancy, rent, maintenance…"
                  value={chatMessage}
                  onChange={e => setChatMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  className="flex-1"
                  disabled={isSending}
                />
                <Button onClick={handleSendMessage} disabled={isSending || !chatMessage.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Suggested prompts */}
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              "What is my current occupancy rate?",
              "How much rent is overdue?",
              "How many maintenance requests are pending?",
              "What is my collection rate?",
            ].map(prompt => (
              <button key={prompt} onClick={() => { setChatMessage(prompt); }}
                className="text-xs px-3 py-1.5 rounded-full border border-border hover:bg-muted transition-colors">
                {prompt}
              </button>
            ))}
          </div>
        </TabsContent>

        {/* ── Insights tab (replaces fake suggestions) ───────────────────────── */}
        <TabsContent value="insights" className="mt-4">
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              These insights are computed from your live portfolio data — not AI guesses.
            </p>
            {suggestions.map(s => (
              <Card key={s.id} className={`border-l-4 ${severityColors[s.severity]}`}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1">
                      <div className="mt-0.5 shrink-0">{categoryIcons[s.category]}</div>
                      <div>
                        <p className="font-semibold text-sm">{s.title}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">{s.description}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium text-muted-foreground">{s.impact}</p>
                      {s.href && (
                        <a href={s.href} className="text-xs text-blue-600 hover:underline">View →</a>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* ── Activity tab (replaces fake voice commands history) ────────────── */}
        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <h3 className="text-sm font-semibold text-slate-900">Recent portfolio activity</h3>
              <CardDescription>Latest maintenance requests and rent payments from across your portfolio.</CardDescription>
            </CardHeader>
            <CardContent>
              {recentActivity.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No recent activity loaded yet.</p>
              ) : (
                <div className="space-y-3">
                  {recentActivity.map(a => (
                    <div key={a.id} className="flex items-center gap-3 text-sm border-b border-border pb-3 last:border-0 last:pb-0">
                      <div className="shrink-0 rounded-full bg-muted p-1.5">{a.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{a.label}</p>
                        <p className="text-xs text-muted-foreground">{a.sub}</p>
                      </div>
                      <p className="text-xs text-muted-foreground shrink-0">
                        {a.time ? new Date(a.time).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : "—"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}