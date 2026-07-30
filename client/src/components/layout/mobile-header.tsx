import { Home, Bell, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";

interface MobileHeaderProps {
 onMenuClick: () => void;
}

export default function MobileHeader({ onMenuClick }: MobileHeaderProps) {
 const isMobile = useIsMobile();
 if (!isMobile) return null;

 return (
 <div className="lg:hidden fixed top-0 left-0 right-0 chrome-scope bg-background shadow-sm z-40 border-b border-border ">
 <div className="flex items-center justify-between px-4 h-14">
 {/* Logo */}
 <div className="flex items-center gap-2">
 <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
 <Home className="w-4 h-4 text-white" />
 </div>
 <span className="text-base font-bold text-foreground tracking-tight">SmartProp</span>
 </div>

 {/* Right side: notifications + menu (for deep nav access) */}
 <div className="flex items-center gap-1">
 <Button variant="ghost" size="sm" className="h-8 w-8 p-0 relative">
 <Bell className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
 </Button>
 <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onMenuClick}>
 <Menu className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
 </Button>
 </div>
 </div>
 </div>
 );
}