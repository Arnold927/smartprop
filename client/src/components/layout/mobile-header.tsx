import { useState } from "react";
import { Home, Menu, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsCompact } from "@/hooks/use-mobile";
import { NotificationBell } from "@/components/layout/top-bar";
import DashboardSwitcher from "@/components/layout/dashboard-switcher";
import { CommandPalette } from "@/components/layout/command-palette";

interface MobileHeaderProps {
 onMenuClick: () => void;
}

// In-flow (not fixed): it is a flex child of the shell column, so <main> starts
// below it and page titles are never hidden underneath.
export default function MobileHeader({ onMenuClick }: MobileHeaderProps) {
 const isCompact = useIsCompact();
 const [searchOpen, setSearchOpen] = useState(false);
 if (!isCompact) return null;

 return (
 <header
 className="lg:hidden shrink-0 chrome-scope bg-background shadow-sm z-40 border-b border-border"
 style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
 >
 <div className="flex items-center justify-between px-3 sm:px-4 h-14">
 <div className="flex items-center gap-1 min-w-0">
 {/* Menu button sits on the left because the drawer slides in from the left */}
 <Button variant="ghost" size="sm" className="h-11 w-11 p-0 -ml-1 shrink-0" onClick={onMenuClick} aria-label="Open menu">
 <Menu className="w-5 h-5 text-muted-foreground" />
 </Button>
 <div className="flex items-center gap-2 min-w-0">
 <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center shrink-0">
 <Home className="w-4 h-4 text-white" />
 </div>
 <span className="text-base font-bold text-foreground tracking-tight truncate">SmartProp</span>
 </div>
 </div>

 <div className="flex items-center gap-1">
 <Button variant="ghost" size="sm" className="h-11 w-11 p-0 shrink-0" onClick={() => setSearchOpen(true)} aria-label="Search">
 <Search className="w-5 h-5 text-muted-foreground" />
 </Button>
 <DashboardSwitcher compact />
 <NotificationBell />
 </div>
 </div>
 <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
 </header>
 );
}
