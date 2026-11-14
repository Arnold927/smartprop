/**
 * Lets any "add a tenant / caretaker / contractor / buyer / staff member" form report what happened
 * to the portal invite WITHOUT each one owning a dialog. The server returns
 *   invite: { status, link, emailSent, warning? }
 * on those endpoints; call announceInvite(result.invite, email) after a successful create and the
 * <InviteLinkHost /> mounted once in App.tsx shows the shareable link when the email did not go out
 * (or explains why no invite was created).
 */
export type InviteInfo = {
  status?: "created" | "reissued" | "active";
  link?: string | null;
  emailSent?: boolean;
  warning?: string;
};

export type InviteNotice = { invite: InviteInfo; email?: string; who?: string };

export const INVITE_NOTICE_EVENT = "smartprop:invite-notice";

export function announceInvite(invite: InviteInfo | null | undefined, email?: string, who?: string) {
  if (!invite || typeof window === "undefined") return;
  const detail: InviteNotice = { invite, email, who };
  window.dispatchEvent(new CustomEvent<InviteNotice>(INVITE_NOTICE_EVENT, { detail }));
}

/** Copy text; falls back to a hidden textarea for browsers/contexts without the async clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
