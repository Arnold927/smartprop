// components/time-tracking-error-boundary.tsx
import { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
 children: ReactNode;
}

interface State {
 hasError: boolean;
 error: Error | null;
}

export class TimeTrackingErrorBoundary extends Component<Props, State> {
 public state: State = {
 hasError: false,
 error: null
 };

 public static getDerivedStateFromError(error: Error): State {
 return { hasError: true, error };
 }

 public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
 console.error("Time tracking error:", error, errorInfo);
 }

 public render() {
 if (this.state.hasError) {
 return (
 <div className="rounded-lg border border-red-200 bg-red-50 p-4">
 <div className="flex items-center gap-3">
 <AlertCircle className="h-5 w-5 text-red-600" />
 <div>
 <h3 className="font-medium text-red-800">Time Tracking Error</h3>
 <p className="text-sm text-red-700">{this.state.error?.message}</p>
 <Button
 variant="outline"
 size="sm"
 className="mt-2 border-red-300 text-red-700"
 onClick={() => window.location.reload()}
 >
 Reload Page
 </Button>
 </div>
 </div>
 </div>
 );
 }

 return this.props.children;
 }
}