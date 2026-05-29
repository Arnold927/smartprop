import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Clock, AlertTriangle, DollarSign } from "lucide-react";

interface KPIProps {
  label: string;
  value: string;
  icon: any;
  color: string;
  sub: string;
}

export function RentKPIStrip({ stats }: { stats: KPIProps[] }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      {stats.map(({ label, value, icon: Icon, color, sub }) => (
        <Card key={label} className="rounded-2xl border-border dark:border-gray-800 shadow-none">
          <CardContent className="p-4 md:p-5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 md:mb-3 bg-${color}-50`}>
              <Icon className={`w-4 h-4 text-${color}-600`} />
            </div>
            <p className="text-lg md:text-xl font-semibold text-slate-900 mb-0.5">{value}</p>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground uppercase tracking-wide font-medium mb-0.5">{label}</p>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">{sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
