interface CurrencyDisplayProps {
 amount: number;
 currency?: string;
 locale?: string;
 className?: string;
}

export function CurrencyDisplay({ 
 amount, 
 currency = "USD", 
 locale = "en-US",
 className 
}: CurrencyDisplayProps) {
 const formatCurrency = (amount: number, currency: string, locale: string) => {
 try {
 return new Intl.NumberFormat(locale, {
 style: 'currency',
 currency: currency,
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
 }).format(amount);
 } catch (error) {
 // Fallback if currency or locale is not supported
 return `${currency} ${amount.toFixed(2)}`;
 }
 };

 return (
 <span className={className}>
 {formatCurrency(amount, currency, locale)}
 </span>
 );
}