/**
 * organization-onboarding.tsx  (REDESIGNED)
 *
 * Captures ONLY org name + currency — the bare minimum to create an org.
 * Branding and subscription are deferred to Settings where they belong.
 *
 * After org creation, redirects to /quick-setup for the value-delivery wizard.
 */
import React, { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, ArrowRight, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

const currencies = [
  { value: "KES", label: "KES — Kenyan Shilling" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "ZAR", label: "ZAR — South African Rand" },
  { value: "NGN", label: "NGN — Nigerian Naira" },
  { value: "GHS", label: "GHS — Ghanaian Cedi" },
  { value: "UGX", label: "UGX — Ugandan Shilling" },
  { value: "TZS", label: "TZS — Tanzanian Shilling" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
];

export default function OrganizationOnboarding() {
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("KES");
  const { toast } = useToast();

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const createOrg = useMutation({
    mutationFn: async () =>
      apiRequest("/api/organizations", {
        method: "POST",
        data: {
          organizationName: name,
          slug,
          defaultCurrency: currency,
          timezone: "Africa/Nairobi",
          dateFormat: "DD/MM/YYYY",
          language: "en",
          primaryColor: "#3B82F6",
          secondaryColor: "#EF4444",
          brandingEnabled: false,
          subscriptionPlan: "professional",
          maxProperties: 25,
          maxUsers: 50,
          features: {
            multiProperty: true,
            whiteLabel: false,
            advancedReporting: true,
            apiAccess: true,
            smsNotifications: true,
            customDomain: false,
          },
        },
      }),
    onSuccess: () => {
      window.location.href = "/quick-setup";
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't create organisation",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
  });

  const canSubmit = name.trim().length >= 2 && !createOrg.isPending;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg mb-4">
            <Building2 className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Welcome to SmartProp</h1>
          <p className="text-slate-500 mt-1 text-sm text-center">
            Let's get your organisation set up in under a minute.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 space-y-6">
          <div className="space-y-2">
            <Label htmlFor="orgName" className="text-sm font-medium text-slate-700">
              Organisation name <span className="text-red-500">*</span>
            </Label>
            <Input
              id="orgName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Westlands Property Group"
              className="h-11"
              onKeyDown={(e) => e.key === "Enter" && canSubmit && createOrg.mutate()}
              autoFocus
            />
            {slug && (
              <p className="text-xs text-slate-400">
                Your workspace: smartprop.app/<span className="font-medium text-slate-500">{slug}</span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency" className="text-sm font-medium text-slate-700">
              Default currency
            </Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger id="currency" className="h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {currencies.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            onClick={() => createOrg.mutate()}
            disabled={!canSubmit}
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg"
          >
            {createOrg.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating…
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </>
            )}
          </Button>
        </div>

        <p className="text-center text-xs text-slate-400 mt-5">
          Branding, subscription plan, and advanced settings are available in Settings after setup.
        </p>
      </div>
    </div>
  );
}
