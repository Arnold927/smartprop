import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, ArrowRight, MailCheck } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import FuturisticLogo from "@/components/ui/futuristic-logo";
import { PageShell, PageHeader, SectionCard, SPBadge, EmptyState, PrimaryButton, SecondaryButton, FilterBar, SPTable, SPAvatar, StatTile, StatsGrid, KESAmount, ActionMenu, ConfirmDialog } from "@/components/ui/sp-ui";

export default function VerifyEmailPage() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"loading" | "pending" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    const pending = params.get("pending");

    // Redirected here from login — email not yet verified, no token in URL
    if (!token && pending === "true") {
      setStatus("pending");
      setMessage(
        "We sent a verification link to your email address. Please check your inbox (and spam folder) and click the link to activate your account."
      );
      return;
    }

    if (!token) {
      setStatus("error");
      setMessage("Verification token is missing.");
      return;
    }

    const verify = async () => {
      try {
        const res = await apiRequest("/api/auth/verify-email", {
          method: "POST",
          data: { token },
        });
        const data = await res.json();

        if (res.ok) {
          setStatus("success");
          setMessage(data.message || "Email verified successfully!");
        } else {
          setStatus("error");
          setMessage(data.message || "Failed to verify email.");
        }
      } catch (err) {
        setStatus("error");
        setMessage("An unexpected error occurred.");
      }
    };

    verify();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <FuturisticLogo className="mx-auto mb-4" />
          <h1 className="text-2xl font-semibold text-foreground">Smart Prop</h1>
        </div>

        <Card className="w-full shadow-xl border-0">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Email Verification</CardTitle>
            <CardDescription>
              {status === "loading" && "Verifying your email address..."}
              {status === "pending" && "Check your inbox"}
              {status === "success" && "Your account is now active"}
              {status === "error" && "Verification failed"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center py-6">
            {status === "loading" && (
              <Loader2 className="h-16 w-16 text-blue-600 animate-spin mb-4" />
            )}

            {status === "pending" && (
              <>
                <MailCheck className="h-16 w-16 text-blue-500 mb-4" />
                <p className="text-center text-muted-foreground mb-6">{message}</p>
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => setLocation("/auth")}
                >
                  Back to Login <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            )}

            {status === "success" && (
              <>
                <CheckCircle2 className="h-16 w-16 text-green-500 mb-4" />
                <p className="text-center text-muted-foreground mb-6">{message}</p>
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => setLocation("/auth")}
                >
                  Go to Login <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </>
            )}

            {status === "error" && (
              <>
                <XCircle className="h-16 w-16 text-red-500 mb-4" />
                <p className="text-center text-muted-foreground mb-6">{message}</p>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setLocation("/auth")}
                >
                  Back to Login
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}