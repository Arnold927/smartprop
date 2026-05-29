import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_CURRENCIES, CurrencyCode } from '@shared/schema';

interface CurrencySelectProps {
 value?: CurrencyCode;
 onValueChange?: (value: CurrencyCode) => void;
 placeholder?: string;
 disabled?: boolean;
}

export function CurrencySelect({ 
 value, 
 onValueChange, 
 placeholder = "Select currency",
 disabled = false 
}: CurrencySelectProps) {
 return (
 <Select value={value} onValueChange={onValueChange} disabled={disabled}>
 <SelectTrigger>
 <SelectValue placeholder={placeholder} />
 </SelectTrigger>
 <SelectContent>
 {SUPPORTED_CURRENCIES.map((currency) => (
 <SelectItem key={currency.code} value={currency.code}>
 <div className="flex items-center space-x-2">
 <span>{currency.symbol}</span>
 <span>{currency.code}</span>
 <span className="text-muted-foreground">- {currency.name}</span>
 </div>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 );
}

export default CurrencySelect;