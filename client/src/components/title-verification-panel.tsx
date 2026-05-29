/**
 * TitleVerificationPanel
 *
 * Embedded inside the Add/Edit Property modal.
 * Lets the property manager:
 *   1. Enter a Kenya title deed number (free text)
 *   2. Click "Verify with Ardhisasa" — calls POST /api/title-verification/lookup
 *   3. See a rich result card (owner, parcel, area, encumbrances)
 *   4. The result is auto-saved to the property when propertyId is provided
 *
 * Props:
 *   propertyId?     — if set, the result is persisted server-side
 *   initialTitle?   — pre-populate the field (e.g. when editing an existing property)
 *   onVerified?     — callback with the title number + status when done
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TitleVerificationBadge } from "@/components/ui/title-verification-badge";
import {
  Shield, ShieldCheck, Loader2, ExternalLink, AlertTriangle,
  MapPin, User, Hash, Layers, Calendar, FlaskConical,
} from "lucide-react";

interface TitleVerificationPanelProps {
  propertyId?: number;
  initialTitle?: string;
  initialResult?: TitleVerificationData | null;
  onVerified?: (titleNumber: string, status: string) => void;
}

export interface TitleVerificationData {
  titleNumber: string;
  status: string;
  verifiedAt?: string;
  registeredOwner?: string;
  parcelNumber?: string;
  registrationDate?: string;
  landUse?: string;
  area?: string;
  county?: string;
  locality?: string;
  encumbrances?: string[];
  message?: string;
  isSandbox?: boolean;
}

export function TitleVerificationPanel({
  propertyId,
  initialTitle = "",
  initialResult = null,
  onVerified,
}: TitleVerificationPanelProps) {
  const { toast } = useToast();
  const [titleNumber, setTitleNumber] = useState(initialTitle);
  const [result, setResult] = useState<TitleVerificationData | null>(initialResult);
  const [isLive, setIsLive] = useState<boolean | null>(null);

  const verifyMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/title-verification/lookup", {
        method: "POST",
        data: {
          titleNumber: titleNumber.trim(),
          propertyId,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message ?? "Verification failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setResult(data.result);
      setIsLive(data.isLive ?? false);
      onVerified?.(data.result.titleNumber, data.result.status);

      if (data.result.status === "verified") {
        toast({ title: "Title verified ✓", description: data.result.message });
      } else if (data.result.status === "encumbered") {
        toast({
          title: "Title has encumbrances",
          description: data.result.message,
          variant: "destructive",
        });
      } else if (data.result.status === "not_found") {
        toast({
          title: "Title not found",
          description: data.result.message,
          variant: "destructive",
        });
      }
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const statusColor =
    result?.status === "verified"   ? "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-800" :
    result?.status === "encumbered" ? "border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800" :
    result?.status === "disputed"   ? "border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800" :
    result?.status === "not_found"  ? "border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800" :
    "border-gray-200 bg-gray-50 dark:bg-gray-900 dark:border-gray-70";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5 text-foreground">
          <Shield className="h-3.5 w-3.5 text-blue-600" />
          Title Deed Number
        </Label>
        {isLive === false && (
          <span className="flex items-center gap-1 text-[10px] text-amber-600 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-700 rounded-full px-2 py-0.5">
            <FlaskConical className="h-3 w-3" /> Sandbox mode
          </span>
        )}
        {isLive === true && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-700 rounded-full px-2 py-0.5">
            <ShieldCheck className="h-3 w-3" /> Live Ardhisasa
          </span>
        )}
      </div>

      {/* Input + button row */}
      <div className="flex gap-2">
        <Input
          placeholder="e.g. IR 123456 / LR 456/789"
          value={titleNumber}
          onChange={e => setTitleNumber(e.target.value.toUpperCase())}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (titleNumber.trim()) verifyMut.mutate();
            }
          }}
          className="font-mono text-sm bg-card text-foreground border-border flex-1"
        />
        <Button
          type="button"
          variant="outline"
          className="shrink-0 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-400 dark:hover:bg-blue-950/30"
          disabled={!titleNumber.trim() || verifyMut.isPending}
          onClick={() => verifyMut.mutate()}
        >
          {verifyMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Shield className="h-4 w-4" />
          )}
          {verifyMut.isPending ? "Checking…" : "Verify"}
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Verified against Kenya's{" "}
        <a
          href="https://ardhisasa.lands.go.ke"
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-blue-600 hover:text-blue-800 dark:text-blue-400 inline-flex items-center gap-0.5"
        >
          Ardhisasa Land Registry
          <ExternalLink className="h-3 w-3" />
        </a>
        . Leave blank to add the property without verification.
      </p>

      {/* Result card */}
      {result && (
        <div className={`rounded-lg border p-4 space-y-3 ${statusColor}`}>
          {/* Status row */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <TitleVerificationBadge
              status={result.status as any}
              size="md"
              isSandbox={result.isSandbox}
              encumbrances={result.encumbrances}
            />
            {result.verifiedAt && (
              <span className="text-[10px] text-muted-foreground">
                Checked {new Date(result.verifiedAt).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" })}
              </span>
            )}
          </div>

          {/* Message */}
          <p className="text-xs text-muted-foreground leading-relaxed">{result.message}</p>

          {/* Registry details grid */}
          {(result.registeredOwner || result.parcelNumber || result.area || result.county) && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-1 border-t border-current/10">
              {result.registeredOwner && (
                <div className="col-span-2">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <User className="h-3 w-3" /> Registered Owner
                  </p>
                  <p className="text-xs font-semibold mt-0.5">{result.registeredOwner}</p>
                </div>
              )}
              {result.parcelNumber && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <Hash className="h-3 w-3" /> Parcel No.
                  </p>
                  <p className="text-xs font-mono mt-0.5">{result.parcelNumber}</p>
                </div>
              )}
              {result.area && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <Layers className="h-3 w-3" /> Area
                  </p>
                  <p className="text-xs mt-0.5">{result.area}</p>
                </div>
              )}
              {result.county && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> County
                  </p>
                  <p className="text-xs mt-0.5">{result.county}{result.locality ? ` — ${result.locality}` : ""}</p>
                </div>
              )}
              {result.landUse && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Land Use</p>
                  <p className="text-xs mt-0.5 capitalize">{result.landUse}</p>
                </div>
              )}
              {result.registrationDate && (
                <div>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Registered
                  </p>
                  <p className="text-xs mt-0.5">{result.registrationDate}</p>
                </div>
              )}
            </div>
          )}

          {/* Encumbrances */}
          {result.encumbrances && result.encumbrances.length > 0 && (
            <div className="pt-2 border-t border-amber-300 dark:border-amber-700" >
              <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide flex items-center gap-1 mb-1.5">
                <AlertTriangle className="h-3 w-3" /> Active Encumbrances
              </p>
              <ul className="space-y-1">
                {result.encumbrances.map((e, i) => (
                  <li key={i} className="text-xs text-amber-800 dark:text-amber-300 flex items-start gap-1.5">
                    <span className="mt-0.5 shrink-0">•</span> {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TitleVerificationPanel;
