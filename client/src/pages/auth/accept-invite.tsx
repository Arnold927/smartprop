import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Lock, Eye, EyeOff, CheckCircle, AlertCircle } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import FuturisticLogo from "@/components/ui/futuristic-logo";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

export default function AcceptInvitePage() {
 const { toast } = useToast();
 const [, navigate] = useLocation();
 const [password, setPassword] = useState("");
 const [confirmPassword, setConfirmPassword] = useState("");
 const [showPassword, setShowPassword] = useState(false);
 const [isSuccess, setIsSuccess] = useState(false);

 // Extract token from URL path /accept-invite/:token
 const token = window.location.pathname.split("/accept-invite/")[1];

 // Verify token is valid
 const { data: inviteData = [], isLoading, error } = useQuery({
 queryKey: [`/api/auth/invite/${token}`],
 enabled: !!token,
 retry: false,
 });

 const activateMutation = useMutation({
 mutationFn: async ({ token, password }: { token: string; password: string }) => {
 const res = await apiRequest("/api/auth/activate", {
 method: "POST",
 data: { token, password },
 });
 return await res.json();
 },
 onSuccess: () => {
 setIsSuccess(true);
 toast({ title: "Account activated!", description: "Your account is ready. Please sign in." });
 },
 onError: (error: any) => {
 toast({
 title: "Activation failed",
 description: error.message || "This invite link may have expired.",
 variant: "destructive",
 });
 },
 });

 const handleSubmit = (e: React.FormEvent) => {
 e.preventDefault();
 if (password.length < 8) {
 toast({ title: "Password too short", description: "Minimum 8 characters.", variant: "destructive" });
 return;
 }
 if (password !== confirmPassword) {
 toast({ title: "Passwords don't match", variant: "destructive" });
 return;
 }
 activateMutation.mutate({ token, password });
 };

 if (isLoading) {
 return (
 <div className="min-h-screen flex items-center justify-center">
 <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
 </div>
 );
 }

 if (error || !inviteData) {
 return (
 <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
 <Card className="w-full max-w-md shadow-xl border-0">
 <CardHeader className="text-center">
 <div className="mx-auto w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
 <AlertCircle className="h-6 w-6 text-red-600" />
 </div>
 <CardTitle>Invalid Invitation</CardTitle>
 <CardDescription>
 This invitation link is invalid or has expired. Please ask your administrator to send a new invite.
 </CardDescription>
 </CardHeader>
 <CardContent className="text-center">
 <Button variant="outline" onClick={() => navigate("/auth")}>Go to Sign In</Button>
 </CardContent>
 </Card>
 </div>
 );
 }

 if (isSuccess) {
 return (
 <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
 <div className="w-full max-w-md text-center">
 <FuturisticLogo className="mx-auto mb-6" />
 <Card className="shadow-xl border-0">
 <CardHeader>
 <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
 <CheckCircle className="h-6 w-6 text-green-600" />
 </div>
 <CardTitle>You're all set!</CardTitle>
 <CardDescription>Your account has been activated. You can now sign in.</CardDescription>
 </CardHeader>
 <CardContent>
 <Button className="w-full" onClick={() => navigate("/auth")}>Sign in</Button>
 </CardContent>
 </Card>
 </div>
 </div>
 );
 }

 return (
 <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
 <div className="w-full max-w-md">
 <div className="text-center mb-8">
 <FuturisticLogo className="mx-auto mb-4" />
 <h1 className="text-2xl font-semibold text-foreground">Smart Prop</h1>
 <p className="text-muted-foreground mt-1">You've been invited to join</p>
 </div>

 <Card className="shadow-xl border-0">
 <CardHeader className="pb-4">
 <CardTitle className="text-2xl text-center">Activate your account</CardTitle>
 <CardDescription className="text-center">
 Set a password for <strong>{(inviteData as any)?.email}</strong>
 </CardDescription>
 </CardHeader>
 <CardContent>
 <form onSubmit={handleSubmit} className="space-y-4">
 <div className="space-y-2">
 <Label htmlFor="password">Password</Label>
 <div className="relative">
 <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input
 id="password"
 type={showPassword ? "text" : "password"}
 placeholder="Minimum 8 characters"
 className="pl-10 pr-10"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 required
 />
 <button
 type="button"
 className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
 onClick={() => setShowPassword(!showPassword)}
 >
 {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
 </button>
 </div>
 </div>
 <div className="space-y-2">
 <Label htmlFor="confirm">Confirm password</Label>
 <div className="relative">
 <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input
 id="confirm"
 type={showPassword ? "text" : "password"}
 placeholder="Repeat your password"
 className="pl-10"
 value={confirmPassword}
 onChange={(e) => setConfirmPassword(e.target.value)}
 required
 />
 </div>
 </div>
 <Button type="submit" className="w-full" disabled={activateMutation.isPending}>
 {activateMutation.isPending ? "Activating..." : "Activate account"}
 </Button>
 </form>
 </CardContent>
 </Card>
 </div>
 </div>
 );
}
