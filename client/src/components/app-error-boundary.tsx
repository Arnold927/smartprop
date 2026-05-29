import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
 children: ReactNode;
}

interface State {
 hasError: boolean;
 error: Error | null;
 errorInfo: ErrorInfo | null;
}

export class AppErrorBoundary extends Component<Props, State> {
 public state: State = {
 hasError: false,
 error: null,
 errorInfo: null,
 };

 public static getDerivedStateFromError(error: Error): Partial<State> {
 return { hasError: true, error };
 }

 public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
 this.setState({ errorInfo });
 // In production wire this to your error reporting service (Sentry, etc.)
 console.error("[AppErrorBoundary] Uncaught error:", error, errorInfo);
 }

 private handleReload = () => {
 window.location.reload();
 };

 private handleReset = () => {
 this.setState({ hasError: false, error: null, errorInfo: null });
 };

 public render() {
 if (!this.state.hasError) return this.props.children;

 const isDev = import.meta.env.DEV;

 return (
 <div className="min-h-screen bg-muted dark:bg-gray-950 flex items-center justify-center p-6">
 <div className="max-w-lg w-full bg-card dark:bg-gray-900 rounded-2xl border border-border dark:border-gray-800 shadow-sm p-8">
 <div className="flex items-center gap-3 mb-4">
 <div className="w-10 h-10 bg-red-50 dark:bg-red-950 rounded-xl flex items-center justify-center flex-shrink-0">
 <AlertTriangle className="w-5 h-5 text-red-600" />
 </div>
 <div>
 <h1 className="text-base font-semibold text-slate-900">
 Something went wrong
 </h1>
 <p className="text-sm text-muted-foreground dark:text-muted-foreground">
 An unexpected error occurred in the application.
 </p>
 </div>
 </div>

 {isDev && this.state.error && (
 <div className="mb-5 p-3 bg-red-50 dark:bg-red-950 rounded-lg border border-red-100 dark:border-red-900" >
 <p className="text-xs font-mono text-red-700 dark:text-red-400 break-all">
 {this.state.error.toString()}
 </p>
 {this.state.errorInfo && (
 <details className="mt-2">
 <summary className="text-xs text-red-600 cursor-pointer">
 Component stack
 </summary>
 <pre className="mt-1 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap overflow-auto max-h-48">
 {this.state.errorInfo.componentStack}
 </pre>
 </details>
 )}
 </div>
 )}

 <div className="flex gap-3">
 <Button
 variant="outline"
 size="sm"
 onClick={this.handleReset}
 className="flex-1"
 >
 Try again
 </Button>
 <Button
 size="sm"
 onClick={this.handleReload}
 className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
 >
 <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
 Reload page
 </Button>
 </div>
 </div>
 </div>
 );
 }
}
