/**
 * client/src/pages/caretaker-portal.tsx
 *
 * A caretaker's own dashboard. Previously caretakers were routed to the
 * generic /staff-portal (same as the plain "staff" role) — this replaces
 * that with something scoped to what a caretaker specifically needs: their
 * property assignment, shift, and a quick view of maintenance activity at
 * their specific property, plus links to the pages they already have
 * access to (Maintenance, Visitor Management, Guard Check-in, Inspections).
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useRoleGuard, ROLES } from "@/hooks/useRoleGuard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Shield, Home, Clock, Phone, Wrench, Users, ClipboardCheck, KeyRound, ChevronRight,
} from "lucide-react";

interface CaretakerMe {
  id: number;
  propertyId: number | null;
  propertyName: string;
  caretakerType: string;
  shift: string | null;
  status: string;
  contactNumber: string | null;
  accommodationProvided: boolean;
}

interface MaintenanceRow {
  id: number;
  ticketNumber: string;
  title: string;
  priority: string;
  status: string;
  unitNumber?: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending:     "text-amber-700 border-amber-200",
  in_progress: "text-blue-700 border-blue-200",
  completed:   "text-emerald-700 border-emerald-200",
  rejected:    "text-red-700 border-red-200",
};

export default function CaretakerPortalPage() {
  const guard = useRoleGuard(ROLES.CARETAKER_ALLOWED);
  if (guard.gate) return guard.gate;

  const [, navigate] = useLocation();

  const { data: me, isLoading: meLoading } = useQuery<CaretakerMe>({
    queryKey: ["/api/caretakers/me"],
    queryFn: async () => {
      const r = await apiRequest("/api/caretakers/me");
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load your caretaker record");
      }
      return r.json();
    },
    retry: false,
  });

  const { data: maintenanceRequests = [], isLoading: maintLoading } = useQuery<MaintenanceRow[]>({
    queryKey: ["/api/maintenance-requests", "caretaker-portal", me?.propertyId],
    queryFn: async () => {
      const r = await apiRequest(`/api/maintenance-requests?propertyId=${me!.propertyId}`);
      const body = await r.json();
      return Array.isArray(body) ? body : [];
    },
    enabled: !!me?.propertyId,
  });

  const openRequests = maintenanceRequests.filter(m => m.status !== "completed" && m.status !== "rejected");

  const quickLinks = [
    { label: "Maintenance",       href: "/maintenance",         icon: Wrench },
    { label: "Visitor Log",       href: "/visitor-management",  icon: Users },
    { label: "Guard Check-in",    href: "/guard-checkin",       icon: KeyRound },
    { label: "Inspections",       href: "/inspections",         icon: ClipboardCheck },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 md:py-8">
      <div className="flex items-center gap-3 mb-6">
        <div className="rounded-xl bg-emerald-500/10 p-2.5">
          <Shield className="h-5 w-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Caretaker Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Your assignment and what's happening at your property.</p>
        </div>
      </div>

      {meLoading ? (
        <div className="space-y-3">
          <div className="h-24 rounded-xl bg-muted animate-pulse" />
          <div className="h-40 rounded-xl bg-muted animate-pulse" />
        </div>
      ) : !me ? (
        <Card>
          <CardContent className="text-center py-16">
            <Shield className="h-12 w-12 text-muted-foreground mx-auto mb-4 opacity-20" />
            <h3 className="text-lg font-semibold">No caretaker record found yet</h3>
            <p className="text-muted-foreground mt-2">Ask your admin or manager to finish setting up your assignment.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Assignment card */}
          <Card className="mb-6">
            <CardContent className="py-5">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Home className="h-4 w-4 text-muted-foreground" />
                    <span className="text-base font-semibold">{me.propertyName}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{me.caretakerType}</Badge>
                  </div>
                  <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                    {me.shift && (
                      <span className="flex items-center gap-1.5 capitalize">
                        <Clock className="h-3.5 w-3.5" /> {me.shift} shift
                      </span>
                    )}
                    {me.contactNumber && (
                      <span className="flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5" /> {me.contactNumber}
                      </span>
                    )}
                    {me.accommodationProvided && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">On-site accommodation</Badge>
                    )}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`capitalize ${me.status === "active" ? "text-emerald-700 border-emerald-200" : "text-muted-foreground"}`}
                >
                  {me.status}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Quick links */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {quickLinks.map(({ label, href, icon: Icon }) => (
              <Card
                key={href}
                className="cursor-pointer hover:border-emerald-300 dark:hover:border-emerald-800 transition-colors"
                onClick={() => navigate(href)}
              >
                <CardContent className="py-4 flex flex-col items-center text-center gap-2">
                  <Icon className="h-5 w-5 text-emerald-600" />
                  <span className="text-xs font-medium">{label}</span>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Maintenance at this property */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">
                Open Maintenance at {me.propertyName}
                {openRequests.length > 0 && (
                  <span className="ml-2 text-xs bg-muted dark:bg-gray-800 text-muted-foreground px-1.5 py-0.5 rounded-full">
                    {openRequests.length}
                  </span>
                )}
              </CardTitle>
              <Button variant="ghost" size="sm" className="gap-1" onClick={() => navigate("/maintenance")}>
                View all <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </CardHeader>
            <CardContent>
              {!me.propertyId ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  You're not assigned to a property yet — ask your admin or manager.
                </p>
              ) : maintLoading ? (
                <div className="space-y-2">
                  <div className="h-10 rounded bg-muted animate-pulse" />
                  <div className="h-10 rounded bg-muted animate-pulse" />
                </div>
              ) : openRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Nothing open right now — all caught up.</p>
              ) : (
                <div className="divide-y divide-border dark:divide-gray-800">
                  {openRequests.slice(0, 8).map(m => (
                    <div key={m.id} className="flex items-center justify-between py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{m.title}</p>
                        <p className="text-xs text-muted-foreground">{m.ticketNumber}{m.unitNumber ? ` · Unit ${m.unitNumber}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 capitalize">{m.priority}</Badge>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 capitalize ${STATUS_COLORS[m.status] ?? ""}`}>{m.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}