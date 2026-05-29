import { 
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Mail, Phone, Calendar, DollarSign } from "lucide-react";

interface Tenant {
 id: number;
 firstName: string;
 lastName: string;
 email: string;
 phone?: string;
 unitId: number;
 leaseStartDate: string;
 leaseEndDate: string;
 monthlyRent: number;
 status: string;
}

interface TenantsTableProps {
 propertyId: number;
 tenants: Tenant[];
}

export default function TenantsTable({ propertyId, tenants }: TenantsTableProps) {
 const getStatusBadge = (status: string) => {
 const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
 active: "default",
 pending: "secondary",
 inactive: "outline",
 default: "default",
 };
 
 return (
 <Badge variant={variants[status] || "outline"}>
 {status.charAt(0).toUpperCase() + status.slice(1)}
 </Badge>
 );
 };

 const formatDate = (dateString: string) => {
 return new Date(dateString).toLocaleDateString();
 };

 return (
 <div className="space-y-4">
 <div>
 <h3 className="text-lg font-medium">Tenants ({tenants.length})</h3>
 <p className="text-sm text-muted-foreground">All tenants currently residing in this property</p>
 </div>

 <div className="border rounded-lg">
 <Table>
 <TableHeader>
 <TableRow>
 <TableHead>Tenant</TableHead>
 <TableHead>Contact</TableHead>
 <TableHead>Lease Period</TableHead>
 <TableHead>Rent</TableHead>
 <TableHead>Status</TableHead>
 <TableHead>Actions</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {tenants.length === 0 ? (
 <TableRow>
 <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
 No tenants found for this property.
 </TableCell>
 </TableRow>
 ) : (
 tenants.map((tenant) => (
 <TableRow key={tenant.id}>
 <TableCell>
 <div className="flex items-center space-x-3">
 <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
 <User className="h-4 w-4 text-muted-foreground" />
 </div>
 <div>
 <p className="font-medium">
 {tenant.firstName} {tenant.lastName}
 </p>
 </div>
 </div>
 </TableCell>
 <TableCell>
 <div className="space-y-1">
 <div className="flex items-center space-x-2">
 <Mail className="h-4 w-4 text-muted-foreground" />
 <span className="text-sm">{tenant.email}</span>
 </div>
 {tenant.phone && (
 <div className="flex items-center space-x-2">
 <Phone className="h-4 w-4 text-muted-foreground" />
 <span className="text-sm">{tenant.phone}</span>
 </div>
 )}
 </div>
 </TableCell>
 <TableCell>
 <div className="space-y-1">
 <div className="flex items-center space-x-2">
 <Calendar className="h-4 w-4 text-green-600" />
 <span className="text-sm">{formatDate(tenant.leaseStartDate)}</span>
 </div>
 <div className="flex items-center space-x-2">
 <Calendar className="h-4 w-4 text-red-600" />
 <span className="text-sm">{formatDate(tenant.leaseEndDate)}</span>
 </div>
 </div>
 </TableCell>
 <TableCell>
 <div className="flex items-center">
 <DollarSign className="h-4 w-4 text-muted-foreground mr-1" />
 <span className="font-medium">
 {tenant.monthlyRent.toLocaleString()}
 </span>
 <span className="text-sm text-muted-foreground ml-1">/month</span>
 </div>
 </TableCell>
 <TableCell>
 {getStatusBadge(tenant.status)}
 </TableCell>
 <TableCell>
 <Button variant="ghost" size="sm">View</Button>
 </TableCell>
 </TableRow>
 ))
 )}
 </TableBody>
 </Table>
 </div>
 </div>
 );
}