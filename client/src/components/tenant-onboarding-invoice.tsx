import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Download, CreditCard, FileText, QrCode, Building, User, Calendar, Zap, Droplets, Flame } from 'lucide-react';

interface TenantOnboardingInvoiceProps {
 tenant: {
 name: string;
 email: string;
 phone: string;
 idNumber: string;
 property: string;
 unit: string;
 moveInDate: string;
 monthlyRent: number;
 };
 utilities: {
 water: { meterNumber: string; currentReading: string; ratePerUnit: number };
 electricity: { meterNumber: string; currentReading: string; ratePerUnit: number };
 gas?: { meterNumber: string; currentReading: string; ratePerUnit: number };
 };
 charges: {
 serviceCharge: number;
 security: number;
 parking?: number;
 garbage?: number;
 };
 paymentInfo: {
 method: string;
 dueDate: string;
 depositPaid: number;
 status: 'paid' | 'pending';
 };
}

export default function TenantOnboardingInvoice({
 tenant,
 utilities,
 charges,
 paymentInfo
}: TenantOnboardingInvoiceProps) {
 const portalUrl = `${window.location.origin}/tenant-portal?id=${tenant.idNumber}`;
 
 const totalCharges = 
 tenant.monthlyRent + 
 charges.serviceCharge + 
 charges.security + 
 (charges.parking || 0) + 
 (charges.garbage || 0);

 const handleDownloadPDF = () => {
 // In a real implementation, this would generate a PDF using @react-pdf/renderer
 alert('PDF download would be initiated here. In production, this would use @react-pdf/renderer to generate a professional PDF invoice.');
 };

 const handlePayOnline = () => {
 // In a real implementation, this would integrate with payment providers
 alert('Online payment portal would open here. In production, this would integrate with M-PESA, Stripe, or other payment providers.');
 };

 return (
 <div className="min-h-screen bg-muted py-8 px-4">
 <div className="max-w-4xl mx-auto">
 <Card className="shadow-lg border-0">
 <CardHeader className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
 <div className="flex items-center justify-between">
 <div className="flex items-center space-x-4">
 <div className="w-12 h-12 bg-card bg-opacity-20 rounded-lg flex items-center justify-center">
 <Building className="h-6 w-6" />
 </div>
 <div>
 <CardTitle className="text-2xl font-bold">Smart Prop</CardTitle>
 <p className="text-blue-100">Property Management Solutions</p>
 </div>
 </div>
 <div className="text-right">
 <p className="text-sm text-blue-100">Invoice Date</p>
 <p className="text-lg font-semibold">{new Date().toLocaleDateString()}</p>
 </div>
 </div>
 </CardHeader>

 <CardContent className="p-8 space-y-8">
 {/* Payment Status Indicator */}
 <div className="flex items-center justify-between">
 <div>
 <h2 className="text-2xl font-bold text-foreground">Tenant Onboarding Invoice</h2>
 <p className="text-muted-foreground">Invoice #TNT-{Date.now().toString().slice(-6)}</p>
 </div>
 <Badge 
 variant={paymentInfo.status === 'paid' ? 'default' : 'destructive'}
 className={`px-4 py-2 text-sm font-semibold ${
 paymentInfo.status === 'paid' 
 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
 : 'bg-red-50 text-red-700 border border-red-200'
 }`}>
 {paymentInfo.status === 'paid' ? 'PAID' : 'UNPAID'}
 </Badge>
 </div>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
 <Card className="border border-border">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center text-lg text-foreground">
 <User className="h-5 w-5 mr-2 text-blue-600" />
 Tenant Information
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Full Name</p>
 <p className="text-lg font-semibold text-foreground">{tenant.name}</p>
 </div>
 <div>
 <p className="text-sm font-medium text-muted-foreground">Email</p>
 <p className="text-foreground">{tenant.email}</p>
 </div>
 <div>
 <p className="text-sm font-medium text-muted-foreground">Phone</p>
 <p className="text-foreground">{tenant.phone}</p>
 </div>
 <div>
 <p className="text-sm font-medium text-muted-foreground">ID Number</p>
 <p className="text-foreground">{tenant.idNumber}</p>
 </div>
 </CardContent>
 </Card>

 <Card className="border border-border">
 <CardHeader className="pb-3">
 <CardTitle className="flex items-center text-lg text-foreground">
 <Building className="h-5 w-5 mr-2 text-blue-600" />
 Property Details
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Property</p>
 <p className="text-lg font-semibold text-foreground">{tenant.property}</p>
 </div>
 <div>
 <p className="text-sm font-medium text-muted-foreground">Unit</p>
 <p className="text-foreground">{tenant.unit}</p>
 </div>
 <div>
 <p className="text-sm font-medium text-muted-foreground">Move-in Date</p>
 <p className="text-foreground">{new Date(tenant.moveInDate).toLocaleDateString()}</p>
 </div>
 <div>
 <p className="text-sm font-medium text-muted-foreground">Monthly Rent</p>
 <p className="text-xl font-bold text-green-600">KES {tenant.monthlyRent.toLocaleString()}</p>
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Utilities Breakdown */}
 <Card className="border border-border">
 <CardHeader>
 <CardTitle className="flex items-center text-lg text-foreground">
 <Zap className="h-5 w-5 mr-2 text-blue-600" />
 Utilities Baseline & Rates
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="border-b border-border">
 <th className="text-left py-3 font-semibold text-foreground">Utility</th>
 <th className="text-left py-3 font-semibold text-foreground">Meter Number</th>
 <th className="text-left py-3 font-semibold text-foreground">Current Reading</th>
 <th className="text-left py-3 font-semibold text-foreground">Rate per Unit (KES)</th>
 </tr>
 </thead>
 <tbody className="space-y-2">
 <tr className="border-b border-border">
 <td className="py-3 flex items-center">
 <Droplets className="h-4 w-4 mr-2 text-blue-500" />
 Water
 </td>
 <td className="py-3 font-mono text-foreground">{utilities.water.meterNumber}</td>
 <td className="py-3 font-semibold text-foreground">{utilities.water.currentReading}</td>
 <td className="py-3 font-semibold text-green-600">{utilities.water.ratePerUnit}</td>
 </tr>
 <tr className="border-b border-border">
 <td className="py-3 flex items-center">
 <Zap className="h-4 w-4 mr-2 text-yellow-500" />
 Electricity
 </td>
 <td className="py-3 font-mono text-foreground">{utilities.electricity.meterNumber}</td>
 <td className="py-3 font-semibold text-foreground">{utilities.electricity.currentReading}</td>
 <td className="py-3 font-semibold text-green-600">{utilities.electricity.ratePerUnit}</td>
 </tr>
 {utilities.gas && (
 <tr className="border-b border-border">
 <td className="py-3 flex items-center">
 <Flame className="h-4 w-4 mr-2 text-orange-500" />
 Gas
 </td>
 <td className="py-3 font-mono text-foreground">{utilities.gas.meterNumber}</td>
 <td className="py-3 font-semibold text-foreground">{utilities.gas.currentReading}</td>
 <td className="py-3 font-semibold text-green-600">{utilities.gas.ratePerUnit}</td>
 </tr>
 )}
 </tbody>
 </table>
 </div>
 </CardContent>
 </Card>

 {/* Charges Summary */}
 <Card className="border border-border">
 <CardHeader>
 <CardTitle className="flex items-center text-lg text-foreground">
 <FileText className="h-5 w-5 mr-2 text-blue-600" />
 Monthly Charges Summary
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="space-y-3">
 <div className="flex justify-between items-center py-2">
 <span className="text-foreground">Monthly Rent</span>
 <span className="font-semibold text-foreground">KES {tenant.monthlyRent.toLocaleString()}</span>
 </div>
 <div className="flex justify-between items-center py-2">
 <span className="text-foreground">Service Charge</span>
 <span className="font-semibold text-foreground">KES {charges.serviceCharge.toLocaleString()}</span>
 </div>
 <div className="flex justify-between items-center py-2">
 <span className="text-foreground">Security Fee</span>
 <span className="font-semibold text-foreground">KES {charges.security.toLocaleString()}</span>
 </div>
 {charges.parking && (
 <div className="flex justify-between items-center py-2">
 <span className="text-foreground">Parking Fee</span>
 <span className="font-semibold text-foreground">KES {charges.parking.toLocaleString()}</span>
 </div>
 )}
 {charges.garbage && (
 <div className="flex justify-between items-center py-2">
 <span className="text-foreground">Garbage Collection</span>
 <span className="font-semibold text-foreground">KES {charges.garbage.toLocaleString()}</span>
 </div>
 )}
 <Separator />
 <div className="flex justify-between items-center py-3 bg-blue-50 px-4 rounded-lg">
 <span className="text-lg font-semibold text-foreground">Total Monthly Charges</span>
 <span className="text-xl font-bold text-blue-600">KES {totalCharges.toLocaleString()}</span>
 </div>
 </div>
 </CardContent>
 </Card>

 {/* QR Code & Payment Information */}
 <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
 <Card className="border border-border">
 <CardHeader>
 <CardTitle className="flex items-center text-lg text-foreground">
 <QrCode className="h-5 w-5 mr-2 text-blue-600" />
 Tenant Portal Access
 </CardTitle>
 </CardHeader>
 <CardContent className="flex flex-col items-center space-y-4">
 <img
 src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(portalUrl)}`}
 alt="Tenant portal QR code"
 width={120}
 height={120}
 className="rounded border border-border"
 />
 <div className="text-center">
 <p className="text-sm text-muted-foreground mb-2">Scan to access your tenant portal</p>
 <p className="text-xs text-muted-foreground break-all">{portalUrl}</p>
 </div>
 </CardContent>
 </Card>

 <Card className="border border-border">
 <CardHeader>
 <CardTitle className="flex items-center text-lg text-foreground">
 <Calendar className="h-5 w-5 mr-2 text-blue-600" />
 Payment Information
 </CardTitle>
 </CardHeader>
 <CardContent className="space-y-3">
 <div>
 <p className="text-sm font-medium text-muted-foreground">Payment Method</p>
 <p className="text-foreground">{paymentInfo.method}</p>
 </div>
 <div>
 <p className="text-sm font-medium text-muted-foreground">Monthly Due Date</p>
 <p className="text-foreground">{paymentInfo.dueDate}</p>
 </div>
 <div>
 <p className="text-sm font-medium text-muted-foreground">Security Deposit Paid</p>
 <p className="text-lg font-semibold text-green-600">KES {paymentInfo.depositPaid.toLocaleString()}</p>
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Action Buttons */}
 <div className="flex flex-col sm:flex-row gap-4 pt-6">
 <Button 
 onClick={handleDownloadPDF}
 className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3"
 >
 <Download className="h-5 w-5 mr-2" />
 Download PDF Invoice
 </Button>
 
 {paymentInfo.status === 'pending' && (
 <Button 
 onClick={handlePayOnline}
 className="flex-1 bg-green-600 hover:bg-green-700 text-white py-3"
 >
 <CreditCard className="h-5 w-5 mr-2" />
 Pay Online
 </Button>
 )}
 </div>

 {/* Footer */}
 <div className="pt-8 border-t border-border text-center text-sm text-muted-foreground">
 <p>This invoice was generated automatically by Smart Prop Property Management System</p>
 <p className="mt-2">For support, contact us at support@smartprop.com or +254759657590</p>
 </div>
 </CardContent>
 </Card>
 </div>
 </div>
 );
}