import { SUPPORTED_CURRENCIES, type CurrencyCode } from './schema';

export function formatCurrency(amount: number | string, currency: CurrencyCode = 'KES'): string {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount)) return 'KSh 0';
  
  const currencyInfo = SUPPORTED_CURRENCIES.find(c => c.code === currency);
  const symbol = currencyInfo?.symbol || 'KSh';
  
  return `${symbol} ${numAmount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function getCurrencySymbol(currency: CurrencyCode): string {
  const currencyInfo = SUPPORTED_CURRENCIES.find(c => c.code === currency);
  return currencyInfo?.symbol || 'KSh';
}

export function getCurrencyName(currency: CurrencyCode): string {
  const currencyInfo = SUPPORTED_CURRENCIES.find(c => c.code === currency);
  return currencyInfo?.name || 'US Dollar';
}