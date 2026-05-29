import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KPIWidgetProps {
 title: string;
 value: string | number;
 change?: {
 value: number;
 type: 'increase' | 'decrease' | 'neutral';
 period: string;
 };
 trend?: 'up' | 'down' | 'neutral';
 variant?: 'primary' | 'secondary' | 'success' | 'warning';
 icon?: React.ReactNode;
 subtitle?: string;
 className?: string;
 onClick?: () => void;
}

export function KPIWidget({
 title,
 value,
 change,
 trend = 'neutral',
 variant = 'secondary',
 icon,
 subtitle,
 className,
 onClick,
}: KPIWidgetProps) {
 const getVariantStyles = () => {
 switch (variant) {
 case 'primary':
 return 'bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700 text-white border-blue-200 shadow-lg shadow-blue-500/25';
 case 'success':
 return 'bg-gradient-to-br from-emerald-400 via-green-500 to-teal-600 text-white border-emerald-200 shadow-lg shadow-emerald-500/25';
 case 'warning':
 return 'bg-gradient-to-br from-orange-400 via-amber-500 to-yellow-500 text-white border-orange-200 shadow-lg shadow-orange-500/25';
 default:
 return 'bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-100 border-border text-foreground hover:shadow-md shadow-gray-500/10';
 }
 };

 const getTrendIcon = () => {
 switch (trend) {
 case 'up':
 return <TrendingUp className="h-4 w-4 text-green-500" />;
 case 'down':
 return <TrendingDown className="h-4 w-4 text-red-500" />;
 default:
 return <Minus className="h-4 w-4 text-muted-foreground" />;
 }
 };

 const getChangeColor = () => {
 switch (change?.type) {
 case 'increase':
 return 'text-green-600 bg-green-50';
 case 'decrease':
 return 'text-red-600 bg-red-50';
 default:
 return 'text-muted-foreground bg-muted';
 }
 };

 return (
 <Card className={cn(
 'transition-all duration-200 hover:shadow-lg border',
 onClick ? 'cursor-pointer group' : '',
 getVariantStyles(),
 className
 )}
 onClick={onClick}
 role={onClick ? 'button' : undefined}
 tabIndex={onClick ? 0 : undefined}
 onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); } : undefined}
 >
 <CardContent className="p-6">
 <div className="flex items-start justify-between">
 <div className="space-y-2 flex-1">
 <div className="flex items-center gap-2">
 <p className={cn(
 "text-sm font-medium",
 variant === 'primary' || variant === 'success' || variant === 'warning' ? 'text-white/90' : 'text-muted-foreground'
 )}>
 {title}
 </p>
 {change && (
 <Badge variant="outline" className={cn(
 "text-xs px-2 py-0.5 border-0",
 getChangeColor()
 )}>
 {change.type === 'increase' ? '+' : change.type === 'decrease' ? '-' : ''}
 {Math.abs(change.value)}%
 </Badge>
 )}
 </div>
 
 <div className="space-y-1">
 <div className={cn(
 "text-3xl font-bold tracking-tight",
 variant === 'primary' || variant === 'success' || variant === 'warning' ? 'text-white' : 'text-foreground'
 )}>
 {value}
 </div>
 
 {subtitle && (
 <p className={cn(
 "text-sm",
 variant === 'primary' || variant === 'success' || variant === 'warning' ? 'text-white/80' : 'text-muted-foreground'
 )}>
 {subtitle}
 </p>
 )}
 
 {change && (
 <div className="flex items-center gap-1 mt-2">
 {getTrendIcon()}
 <span className={cn(
 "text-xs",
 variant === 'primary' ? 'text-white/70' : 'text-muted-foreground'
 )}>
 {change.period}
 </span>
 </div>
 )}
 </div>
 </div>
 
 <div className="flex flex-col items-end gap-2">
 {icon && (
 <div className={cn(
 "p-2 rounded-lg",
 variant === 'primary' 
 ? 'bg-card text-white' 
 : 'bg-muted text-muted-foreground group-hover:bg-muted'
 )}>
 {icon}
 </div>
 )}
 
 <ArrowUpRight className={cn(
 "h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity",
 variant === 'primary' ? 'text-white/60' : 'text-muted-foreground'
 )} />
 </div>
 </div>
 </CardContent>
 </Card>
 );
}