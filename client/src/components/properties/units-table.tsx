import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
 Table,
 TableBody,
 TableCell,
 TableHead,
 TableHeader,
 TableRow,
} from "@/components/ui/table";
import { BedDouble, Bath, Square, DollarSign, User, Plus } from "lucide-react";

interface Unit {
 id: number;
 unitNumber: string;
 bedrooms: number;
 bathrooms: number;
 sqft: number;
 monthlyRent: number;
 currency: string;
 isOccupied: boolean;
 tenant?: {
 firstName: string;
 lastName: string;
 };
}

interface UnitsTableProps {
 propertyId: number;
 units: Unit[];
}

export default function UnitsTable({ propertyId, units }: UnitsTableProps) {
 const [showAddUnit, setShowAddUnit] = useState(false);

 return (
 <div className="space-y-4">
 <div className="flex justify-between items-center">
 <div>
 <h3 className="text-lg font-medium">Units ({units.length})</h3>
 <p className="text-sm text-muted-foreground">Manage individual units in this property</p>
 </div>
 <Button onClick={() => setShowAddUnit(true)}>
 <Plus className="mr-2 h-4 w-4" />
 Add Unit
 </Button>
 </div>

 <div className="border rounded-lg">
 <Table>
 <TableHeader>
 <TableRow>
 <TableHead>Unit Number</TableHead>
 <TableHead>Details</TableHead>
 <TableHead>Rent</TableHead>
 <TableHead>Status</TableHead>
 <TableHead>Tenant</TableHead>
 <TableHead>Actions</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {units.length === 0 ? (
 <TableRow>
 <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
 No units found. Add your first unit.
 </TableCell>
 </TableRow>
 ) : (
 units.map((unit) => (
 <TableRow key={unit.id}>
 <TableCell className="font-medium">{unit.unitNumber}</TableCell>
 <TableCell>
 <div className="flex items-center space-x-4">
 <div className="flex items-center space-x-1">
 <BedDouble className="h-4 w-4 text-muted-foreground" />
 <span>{unit.bedrooms}</span>
 </div>
 <div className="flex items-center space-x-1">
 <Bath className="h-4 w-4 text-muted-foreground" />
 <span>{unit.bathrooms}</span>
 </div>
 <div className="flex items-center space-x-1">
 <Square className="h-4 w-4 text-muted-foreground" />
 <span>{unit.sqft} sqft</span>
 </div>
 </div>
 </TableCell>
 <TableCell>
 <div className="flex items-center">
 <DollarSign className="h-4 w-4 text-muted-foreground mr-1" />
 <span className="font-medium">
 {unit.monthlyRent.toLocaleString()}
 </span>
 <span className="text-sm text-muted-foreground ml-1">/{unit.currency}</span>
 </div>
 </TableCell>
 <TableCell>
 <Badge variant={unit.isOccupied ? "default" : "outline"}>
 {unit.isOccupied ? "Occupied" : "Vacant"}
 </Badge>
 </TableCell>
 <TableCell>
 {unit.tenant ? (
 <div className="flex items-center">
 <User className="h-4 w-4 text-muted-foreground mr-2" />
 <span>{unit.tenant.firstName} {unit.tenant.lastName}</span>
 </div>
 ) : (
 <span className="text-muted-foreground">No tenant</span>
 )}
 </TableCell>
 <TableCell>
 <Button variant="ghost" size="sm">Edit</Button>
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