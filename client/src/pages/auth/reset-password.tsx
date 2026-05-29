import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Lock, ArrowLeft, CheckCircle, Eye, EyeOff } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import FuturisticLogo from "@/components/ui/futuristic-logo";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

export default function ResetPasswordPage() {
 const { toast } = useToast();
 const [location, navigate] = useLocation();
 const [password, setPassword] = useState("");
 const [confirmPassword, setConfirmPassword] = useState("");
 const [showPassword, setShowPassword] = useState(false);
 const [isSuccess, setIsSuccess] = useState(false);

 // Get token from URL query params
 const searchParams = new URLSearchParams(window.location.search);
 const token = searchParams.get("token");

 const resetMutation = useMutation({
 mutationFn: async ({ token, password }: { token: string; password: string }) => {
 const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
   });
   const json = await res.json();
   if (!res.ok) throw new Error(json.message || "Failed to reset password");
   return json;
  },
 onSuccess: () => {
 setIsSuccess(true);
 toast({ title: "Password reset!", description: "Your password has been updated successfully." });
 },
 onError: (error: any) => {
 toast({
 title: "Reset failed",
 description: error.message || "The reset link may have expired. Please request a new one.",
 variant: "destructive",
 });
 },
 });

 const handleSubmit = (e: React.FormEvent) => {
 e.preventDefault();
 if (!token) {
 toast({ title: "Invalid link", description: "This reset link is invalid.", variant: "destructive" });
 return;
 }
 if (password.length < 8) {
 toast({ title: "Password too short", description: "Password must be at least 8 characters.", variant: "destructive" });
 return;
 }
 if (!/[A-Z]/.test(password)) {
 toast({ title: "Weak password", description: "Password must contain at least one uppercase letter.", variant: "destructive" });
 return;
 }
 if (!/[0-9]/.test(password)) {
 toast({ title: "Weak password", description: "Password must contain at least one number.", variant: "destructive" });
 return;
 }
 if (!/[^A-Za-z0-9]/.test(password)) {
 toast({ title: "Weak password", description: "Password must contain at least one special character (e.g. ! @ # $).", variant: "destructive" });
 return;
 }
 if (password !== confirmPassword) {
 toast({ title: "Passwords don't match", description: "Please make sure both passwords match.", variant: "destructive" });
 return;
 }
 resetMutation.mutate({ token, password });
 };

 if (!token) {
 return (
 <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
 <Card className="w-full max-w-md shadow-xl border-0">
 <CardHeader className="text-center">
 <CardTitle>Invalid Reset Link</CardTitle>
 <CardDescription>This password reset link is invalid or missing.</CardDescription>
 </CardHeader>
 <CardContent className="text-center">
 <Link href="/auth/forgot-password">
 <Button>Request a new reset link</Button>
 </Link>
 </CardContent>
 </Card>
 </div>
 );
 }

 if (isSuccess) {
 return (
 <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
 <div className="w-full max-w-md text-center">
 <FuturisticLogo className="mx-auto mb-4" />
 <Card className="shadow-xl border-0">
 <CardHeader>
 <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
 <CheckCircle className="h-6 w-6 text-green-600" />
 </div>
 <CardTitle>Password updated!</CardTitle>
 <CardDescription>Your password has been changed successfully.</CardDescription>
 </CardHeader>
 <CardContent>
 <Button className="w-full" onClick={() => navigate("/auth")}>
 Sign in with new password
 </Button>
 </CardContent>
 </Card>
 </div>
 </div>
 );
 }

 return (
 <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
 <div className="w-full max-w-md">
 <div className="mb-6">
 <Link href="/auth">
 <Button variant="ghost" className="text-sm">
 <ArrowLeft className="h-4 w-4 mr-2" />
 Back to sign in
 </Button>
 </Link>
 </div>

 <div className="text-center mb-8">
 <FuturisticLogo className="mx-auto mb-4" />
 <h1 className="text-2xl font-semibold text-foreground">Smart Prop</h1>
 </div>

 <Card className="w-full shadow-xl border-0">
 <CardHeader className="space-y-1 pb-4">
 <CardTitle className="text-2xl text-center">Set new password</CardTitle>
 <CardDescription className="text-center">
 Enter a new password for your account
 </CardDescription>
 </CardHeader>
 <CardContent>
 <form onSubmit={handleSubmit} className="space-y-4">
 <div className="space-y-2">
 <Label htmlFor="password">New password</Label>
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
 <Label htmlFor="confirm-password">Confirm new password</Label>
 <div className="relative">
 <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
 <Input
 id="confirm-password"
 type={showPassword ? "text" : "password"}
 placeholder="Repeat your new password"
 className="pl-10"
 value={confirmPassword}
 onChange={(e) => setConfirmPassword(e.target.value)}
 required
 />
 </div>
 </div>

 <Button type="submit" className="w-full" disabled={resetMutation.isPending}>
 {resetMutation.isPending ? "Updating..." : "Update password"}
 </Button>
 </form>
 </CardContent>
 </Card>
 </div>
 </div>
 );
}