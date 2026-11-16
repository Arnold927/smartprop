import { SUPPORTED_CURRENCIES, type CurrencyCode } from './schema';

export function formatCurrency(amount: number | string, currency: CurrencyCode = 'KES'): string {
  const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
  
  if (isNaN(numAmount)) return 'KES 0';
  
  const currencyInfo = SUPPORTED_CURRENCIES.find(c => c.code === currency);
  // Shillings are always written "KES" (never "KSh") so one screen never mixes the two, and whole amounts drop ".00".
  const symbol = currency === 'KES' ? 'KES' : (currencyInfo?.symbol || 'KES');
  const digits = currency === 'KES' && Number.isInteger(numAmount) ? 0 : 2;
  
  return `${symbol} ${numAmount.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function getCurrencySymbol(currency: CurrencyCode): string {
  const currencyInfo = SUPPORTED_CURRENCIES.find(c => c.code === currency);
  return currencyInfo?.symbol || 'KES';
}

export function getCurrencyName(currency: CurrencyCode): string {
  const currencyInfo = SUPPORTED_CURRENCIES.find(c => c.code === currency);
  return currencyInfo?.name || 'US Dollar';
}