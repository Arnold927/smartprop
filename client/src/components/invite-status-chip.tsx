import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, ensureArray } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InviteLinkDialog } from "@/components/invite-link-dialog";
import { Clock, Send, Link2 } from "lucide-react";

type Pending = { id: string; email: string; role: string; inviteExpiresAt: string | null };

/** Shared, cached list of invites that have not been accepted yet (admin/manager only). */
export function usePendingInvites() {
  const { user } = useAuth();
  const allowed = ["admin", "manager", "platform_admin"].includes((user as any)?.role ?? "");
  return useQuery<Pending[]>({
    queryKey: ["/api/users/pending-invites"],
    queryFn: async () => ensureArray(await (await apiRequest("/api/users/pending-invites")).json()),
    enabled: allowed,
    staleTime: 60 * 1000,
    retry: false,
  });
}

/**
 * Small "Invite pending" / "Invite expired" marker for a person who was added (tenant, caretaker,
 * contractor...) but has not set up their login yet. Click it to re-send the email or copy a fresh link.
 * Renders nothing for anyone who has already joined, and for roles that cannot manage invites.
 */
export function InviteStatusChip({ email, className = "" }: { email?: string | null; className?: string }) {
  const { data: pending = [] } = usePendingInvites();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [link, setLink] = useState<{ link: string; email: string; emailRequested: boolean } | null>(null);

  const match = email ? pending.find(p => p.email.toLowerCase() === email.toLowerCase()) : undefined;

  const resend = useMutation({
    mutationFn: async (sendEmail: boolean) => {
      const r = await apiRequest(`/api/users/${match!.id}/resend-invite`, { method: "POST", data: { sendEmail } });
      return { ...(await r.json()), sendEmail };
    },
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users/pending-invites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      if (res.emailSent) {
        toast({ title: "Invitation re-sent", description: `A fresh link was emailed to ${match!.email}.` });
      } else if (res.inviteLink) {
        setLink({ link: res.inviteLink, email: match!.email, emailRequested: !!res.sendEmail });
      }
    },
    onError: (e: any) => {
      let msg = e?.message ?? "Please try again.";
      try { msg = JSON.parse(msg).message ?? msg; } catch { /* plain text */ }
      toast({ title: "Couldn't re-issue the invite", description: msg, variant: "destructive" });
    },
  });

  if (!match) return null;
  const expired = !match.inviteExpiresAt || new Date(match.inviteExpiresAt) < new Date();

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-no-touch-target
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 [@media(pointer:coarse)]:min-h-8 text-[11px] font-medium transition-colors ${
              expired
                ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
            } ${className}`}
            title="Hasn't set up their login yet — click to resend the invite"
          >
            <Clock className="h-3 w-3" />
            {expired ? "Invite expired" : "Invite pending"}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => resend.mutate(true)} disabled={resend.isPending}>
            <Send className="mr-2 h-4 w-4" /> Resend invite email
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => resend.mutate(false)} disabled={resend.isPending}>
            <Link2 className="mr-2 h-4 w-4" /> Get invite link
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <InviteLinkDialog
        open={!!link}
        onOpenChange={(o) => { if (!o) setLink(null); }}
        link={link?.link ?? ""}
        email={link?.email}
        emailSent={false}
        emailRequested={link?.emailRequested ?? true}
      />
    </>
  );
}
