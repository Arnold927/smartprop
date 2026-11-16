import { AnimatedNumber } from "@/components/ui/motion";

interface CurrencyDisplayProps {
  amount: number;
  currency?: string;
  locale?: string;
  className?: string;
  /** Count up from zero the first time it shows. Use for headline figures, not for table cells. */
  animate?: boolean;
}

export function CurrencyDisplay({
  amount,
  currency = "USD",
  locale = "en-US",
  className,
  animate = false,
}: CurrencyDisplayProps) {
  const formatCurrency = (amount: number, currency: string, locale: string) => {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency,
        // "KES 1,000" everywhere, never "Ksh 1,000" on one card and "KES" on the next.
        currencyDisplay: currency === "KES" ? "code" : "symbol",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch (error) {
      // Fallback if currency or locale is not supported
      return `${currency} ${amount.toFixed(2)}`;
    }
  };

  const text = formatCurrency(amount, currency, locale);
  return (
    <span className={className}>
      {animate ? <AnimatedNumber value={text} /> : text}
    </span>
  );
}
