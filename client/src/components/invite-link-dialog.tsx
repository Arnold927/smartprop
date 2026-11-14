import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, Link2, Mail, MessageCircle as WhatsAppIcon } from "lucide-react";
import { INVITE_NOTICE_EVENT, copyText, type InviteNotice } from "@/lib/invite-notice";

/**
 * Shows an invite link the manager can copy or send over WhatsApp. Used by the Users page (resend /
 * "get link"), the invite form ("create link only" or when the email could not be sent) and — via
 * <InviteLinkHost /> — by every form that creates a login-capable record.
 */
export function InviteLinkDialog({
  open, onOpenChange, link, email, emailSent, emailRequested = true, who,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  link: string;
  email?: string;
  emailSent: boolean;
  /** false when the inviter asked for "link only" — then "not emailed" is expected, not a problem. */
  emailRequested?: boolean;
  who?: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { if (!open) setCopied(false); }, [open]);

  const name = who || email || "them";
  const message = `You've been invited to SmartProp. Set up your account here: ${link}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(message)}`;

  const doCopy = async () => {
    if (await copyText(link)) { setCopied(true); setTimeout(() => setCopied(false), 2500); }
  };

  const headline = emailSent
    ? `Invitation emailed to ${email ?? "them"}`
    : emailRequested
      ? "Invitation created — the email could not be sent"
      : "Invitation link ready";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {emailSent ? <Mail className="h-5 w-5 text-primary" /> : <Link2 className="h-5 w-5 text-primary" />}
            {headline}
          </DialogTitle>
          <DialogDescription>
            {emailSent
              ? `You can also share this link with ${name} directly.`
              : emailRequested
                ? `Email isn't available right now, but the account is ready. Send ${name} this link instead.`
                : `Send ${name} this link. It works once and expires in 7 days.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-2">
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" aria-label="Invitation link" />
            <Button type="button" variant="outline" onClick={doCopy} className="shrink-0 gap-1.5">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <Button type="button" variant="outline" className="w-full gap-2" asChild>
            <a href={wa} target="_blank" rel="noopener noreferrer">
              <WhatsAppIcon className="h-4 w-4" /> Share on WhatsApp
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">
            Anyone with this link can set the password for this account, so only send it to {name}.
            Creating a new link for the same person later makes this one stop working.
          </p>
        </div>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Mounted once (App.tsx). Reacts to announceInvite() from any form. */
export function InviteLinkHost() {
  const { toast } = useToast();
  const [notice, setNotice] = useState<InviteNotice | null>(null);

  useEffect(() => {
    const onNotice = (e: Event) => {
      const n = (e as CustomEvent<InviteNotice>).detail;
      if (!n?.invite) return;
      if (n.invite.warning) {
        toast({ title: "No portal invite was sent", description: n.invite.warning, variant: "destructive" });
        return;
      }
      // Email went out, or the person already has an account: nothing more to do here.
      if (!n.invite.link || n.invite.emailSent) return;
      setNotice(n);
    };
    window.addEventListener(INVITE_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(INVITE_NOTICE_EVENT, onNotice);
  }, [toast]);

  return (
    <InviteLinkDialog
      open={!!notice}
      onOpenChange={(o) => { if (!o) setNotice(null); }}
      link={notice?.invite.link ?? ""}
      email={notice?.email}
      who={notice?.who}
      emailSent={false}
    />
  );
}
