import {
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from "@/components/ui/table";

interface Column<T> {
 header: string;
 accessorKey: keyof T | string;
 cell?: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
 data: T[];
 columns: Column<T>[];
 emptyMessage?: React.ReactNode;
 className?: string; // Add this
}

export default function DataTable<T>({ 
 data, 
 columns, 
 emptyMessage = "No data available",
 className = "" // Add this
}: DataTableProps<T>) {
 if (data.length === 0) {
 return (
 <div className={`text-center py-12 ${className}`}>
 {typeof emptyMessage === 'string' ? (
 <>
 <p className="text-muted-foreground text-lg mb-2">{emptyMessage}</p>
 <p className="text-muted-foreground text-sm">Data will appear here when available.</p>
 </>
 ) : (
 emptyMessage
 )}
 </div>
 );
 }

 return (
 <div className={`overflow-x-auto ${className}`}>
 <Table className="w-full">
 <TableHeader>
 <TableRow className="border-b border-border">
 {columns.map((column) => (
 <TableHead 
 key={String(column.accessorKey)} 
 className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider bg-muted"
 >
 {column.header}
 </TableHead>
 ))}
 </TableRow>
 </TableHeader>
 <TableBody>
 {data.map((item, index) => (
 <TableRow 
 key={index} 
 className="border-b border-border last:border-b-0 hover:bg-muted/50 transition-colors"
 >
 {columns.map((column) => {
 let cellValue: React.ReactNode;
 
 if (column.cell) {
 cellValue = column.cell(item);
 } else {
 cellValue = String((item as any)[column.accessorKey] || '');
 }
 
 return (
 <TableCell 
 key={String(column.accessorKey)} 
 className="px-6 py-4 whitespace-nowrap text-sm text-foreground"
 >
 {cellValue}
 </TableCell>
 );
 })}
 </TableRow>
 ))}
 </TableBody>
 </Table>
 </div>
 );
}



