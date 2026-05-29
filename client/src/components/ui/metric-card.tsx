import { Card, CardContent } from "@/components/ui/card";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricCardProps {
 title: string;
 value: string | number;
 subtitle?: string;
 icon: LucideIcon;
 iconColor?: string;
 valueColor?: string;
 trend?: {
 value: string;
 isPositive: boolean;
 };
 className?: string;
}

export default function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = "text-primary",
  valueColor = "text-foreground",
  trend,
  className = "",
}: MetricCardProps) {
  return (
    <Card className={cn("metric-card border-border shadow-sm", className)}>
      <CardContent className="p-6">
        <div className="flex items-center">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className={cn("text-3xl font-bold tracking-tight", valueColor)}>{value}</p>
            {subtitle && (
              <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
            )}
            {trend && (
              <p className={cn(
                "text-sm mt-1 font-medium",
                trend.isPositive ? 'text-status-success' : 'text-status-error'
              )}>
                {trend.value}
              </p>
            )}
          </div>
          <div className={cn(
            "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
            "bg-muted/50 dark:bg-gray-800"
          )}>
            <Icon className={cn("h-6 w-6", iconColor)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
