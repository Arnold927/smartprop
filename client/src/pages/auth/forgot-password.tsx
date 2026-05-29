import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Mail, ArrowLeft, CheckCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import FuturisticLogo from "@/components/ui/futuristic-logo";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

export default function ForgotPasswordPage() {
 const { toast } = useToast();
 const [email, setEmail] = useState("");
 const [isSubmitted, setIsSubmitted] = useState(false);

 const forgotPasswordMutation = useMutation({
 mutationFn: async (email: string) => {
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || "Failed to send reset email");
    return json;
   },
 onSuccess: () => {
 setIsSubmitted(true);
 toast({ 
 title: "Reset link sent!", 
 description: "Check your email for password reset instructions" 
 });
 },
 onError: (error: any) => {
 toast({ 
 title: "Error", 
 description: error.message || "Failed to send reset email",
 variant: "destructive" 
 });
 }
 });

 const handleSubmit = (e: React.FormEvent) => {
 e.preventDefault();
 forgotPasswordMutation.mutate(email);
 };

 if (isSubmitted) {
 return (
 <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
 <div className="w-full max-w-md">
 <div className="text-center mb-8">
 <FuturisticLogo className="mx-auto mb-4" />
 <h1 className="text-2xl font-semibold text-foreground">Smart Prop</h1>
 </div>

 <Card className="w-full shadow-xl border-0">
 <CardHeader className="text-center">
 <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
 <CheckCircle className="h-6 w-6 text-green-600" />
 </div>
 <CardTitle className="text-2xl">Check your email</CardTitle>
 <CardDescription>
 We've sent a password reset link to <strong>{email}</strong>
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 <p className="text-sm text-muted-foreground text-center">
 Didn't receive the email? Check your spam folder or click below to try again.
 </p>
 
 <Button 
 variant="outline" 
 className="w-full"
 onClick={() => forgotPasswordMutation.mutate(email)}
 disabled={forgotPasswordMutation.isPending}
 data-testid="button-resend-email"
 >
 {forgotPasswordMutation.isPending ? "Sending..." : "Resend email"}
 </Button>

 <Link href="/auth">
 <Button variant="link" className="w-full" data-testid="button-back-to-login">
 <ArrowLeft className="h-4 w-4 mr-2" />
 Back to sign in
 </Button>
 </Link>
 </CardContent>
 </Card>
 </div>
 </div>
 );
 }

 return (
 <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
 <div className="w-full max-w-md">
 {/* Back to Login */}
 <div className="mb-6">
 <Link href="/auth">
 <Button variant="ghost" className="text-sm" data-testid="button-back-to-auth">
 <ArrowLeft className="h-4 w-4 mr-2" />
 Back to sign in
 </Button>
 </Link>
 </div>

 {/* Logo */}
 <div className="text-center mb-8">
 <FuturisticLogo className="mx-auto mb-4" />
 <h1 className="text-2xl font-semibold text-foreground">Smart Prop</h1>
 <p className="text-muted-foreground mt-2">Reset your password</p>
 </div>

 <Card className="w-full shadow-xl border-0">
 <CardHeader className="space-y-1">
 <CardTitle className="text-2xl text-center">Forgot password?</CardTitle>
 <CardDescription className="text-center">
 Enter your email address and we'll send you a link to reset your password
 </CardDescription>
 </CardHeader>
 <CardContent>
 <form onSubmit={handleSubmit} className="space-y-4">
 <div className="space-y-2">
 <Label htmlFor="email">Email address</Label>
 <div className="relative">
 <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
 <Input
 id="email"
 type="email"
 placeholder="your.email@example.com"
 className="pl-10"
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 required
 data-testid="input-forgot-email"
 />
 </div>
 </div>

 <Button 
 type="submit" 
 className="w-full bg-emerald-600 hover:bg-emerald-700"
 disabled={forgotPasswordMutation.isPending}
 data-testid="button-send-reset"
 >
 {forgotPasswordMutation.isPending ? "Sending..." : "Send reset link"}
 </Button>
 </form>
 </CardContent>
 </Card>

 <div className="text-center mt-6 text-sm text-muted-foreground">
 <p>
 Remember your password?{" "}
 <Link href="/auth">
 <Button variant="link" className="p-0 h-auto text-sm underline" data-testid="link-back-to-login">
 Sign in here
 </Button>
 </Link>
 </p>
 </div>
 </div>
 </div>
 );
}