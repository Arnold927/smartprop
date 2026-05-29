import { format, formatDistanceToNow } from 'date-fns'

export const safeFormatDate = (dateString: string | Date | undefined | null, formatStr: string = 'MMM dd, yyyy'): string => {
  if (!dateString) return 'N/A';
  
  try {
    const date = new Date(dateString);
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    
    return format(date, formatStr);
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'N/A';
  }
};

export const safeFormatDistanceToNow = (dateString: string | Date | undefined | null): string => {
  if (!dateString) return 'N/A';
  
  try {
    const date = new Date(dateString);
    
    if (isNaN(date.getTime())) {
      return 'Invalid date';
    }
    
    return formatDistanceToNow(date, { addSuffix: true });
  } catch (error) {
    console.error('Error formatting date distance:', error);
    return 'N/A';
  }
};