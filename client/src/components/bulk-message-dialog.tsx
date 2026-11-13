import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

const CHANNELS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "sms", label: "SMS" },
  { id: "email", label: "Email" },
  { id: "app_notification", label: "In-app" },
] as const;

interface BulkMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantIds: number[];
  /** Called after a successful send, e.g. to clear the row selection. */
  onSent?: () => void;
}

/** Send one message to the tenants ticked in a list, over the channels you pick. */
export function BulkMessageDialog({ open, onOpenChange, tenantIds, onSent }: BulkMessageDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [channels, setChannels] = useState<string[]>(["whatsapp"]);

  const send = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/broadcast-messages", {
        method: "POST",
        data: { title: title.trim(), content: content.trim(), audienceType: "custom_filter", audienceFilter: { tenantIds }, broadcastMedium: channels },
      });
      return res.json();
    },
    onSuccess: (b: any) => {
      const sent = b?.sentCount ?? b?.broadcast?.sentCount;
      toast({ title: "Message sent", description: sent !== undefined ? `Delivered to ${sent} of ${tenantIds.length} tenants.` : `Sent to ${tenantIds.length} tenants.` });
      setTitle(""); setContent("");
      onOpenChange(false);
      onSent?.();
    },
    onError: (e: any) => toast({ title: "Could not send", description: e?.message?.slice(0, 120) || "Please try again", variant: "destructive" }),
  });

  const toggle = (id: string) => setChannels(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]));
  const ready = title.trim() && content.trim() && channels.length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Message {tenantIds.length} tenant{tenantIds.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>Goes only to the tenants you selected. Tenants without a phone or email for a channel are skipped on that channel.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="bm-title">Subject</Label>
            <Input id="bm-title" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} placeholder="e.g. Water shutdown on Saturday" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bm-body">Message</Label>
            <Textarea id="bm-body" rows={5} value={content} onChange={e => setContent(e.target.value)} placeholder="Type your message…" />
          </div>
          <div className="space-y-2">
            <Label>Send via</Label>
            <div className="flex flex-wrap gap-4">
              {CHANNELS.map(c => (
                <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={channels.includes(c.id)} onCheckedChange={() => toggle(c.id)} />{c.label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => send.mutate()} disabled={!ready || send.isPending}>
            <Send className="mr-1.5 h-4 w-4" />{send.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
