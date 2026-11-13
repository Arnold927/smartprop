import { Home, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsCompact } from "@/hooks/use-mobile";
import { NotificationBell } from "@/components/layout/top-bar";
import DashboardSwitcher from "@/components/layout/dashboard-switcher";

interface MobileHeaderProps {
 onMenuClick: () => void;
}

// In-flow (not fixed): it is a flex child of the shell column, so <main> starts
// below it and page titles are never hidden underneath.
export default function MobileHeader({ onMenuClick }: MobileHeaderProps) {
 const isCompact = useIsCompact();
 if (!isCompact) return null;

 return (
 <header
 className="lg:hidden shrink-0 chrome-scope bg-background shadow-sm z-40 border-b border-border"
 style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
 >
 <div className="flex items-center justify-between px-3 sm:px-4 h-14">
 <div className="flex items-center gap-2 min-w-0">
 <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center shrink-0">
 <Home className="w-4 h-4 text-white" />
 </div>
 <span className="text-base font-bold text-foreground tracking-tight truncate">SmartProp</span>
 </div>

 <div className="flex items-center gap-1">
 <DashboardSwitcher compact />
 <NotificationBell />
 <Button variant="ghost" size="sm" className="h-11 w-11 p-0" onClick={onMenuClick} aria-label="Open menu">
 <Menu className="w-5 h-5 text-muted-foreground" />
 </Button>
 </div>
 </div>
 </header>
 );
}
