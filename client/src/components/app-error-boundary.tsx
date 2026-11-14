import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

// After a deploy, a tab that was opened on the previous build still points at
// JS chunks that no longer exist. Opening a lazy page then fails with one of
// these messages. A single reload fetches the new build and fixes it, so we do
// that automatically (once per tab per minute, to avoid reload loops).
const STALE_CHUNK = /dynamically imported module|Importing a module script failed|Loading chunk|Loading CSS chunk|error loading dynamically/i;
const RELOAD_KEY = "sp_chunk_reload_at";

function tryAutoReload(error: Error): boolean {
  try {
    if (!STALE_CHUNK.test(String(error?.message ?? error))) return false;
    const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.location.reload();
    return true;
  } catch {
    return false;
  }
}

export class AppErrorBoundary extends Component<Props, State> {
  public state: State = { hasError: false, error: null, errorInfo: null, copied: false };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    // In production wire this to your error reporting service (Sentry, etc.)
    console.error("[AppErrorBoundary] Uncaught error:", error, errorInfo);
    tryAutoReload(error);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
  };

  private details = () => {
    const { error, errorInfo } = this.state;
    return [
      `Page: ${window.location.pathname}${window.location.search}`,
      `Time: ${new Date().toISOString()}`,
      `Error: ${error?.toString() ?? "unknown"}`,
      error?.stack ? `\nStack:\n${error.stack.split("\n").slice(0, 8).join("\n")}` : "",
      errorInfo?.componentStack ? `\nComponent stack:${errorInfo.componentStack.split("\n").slice(0, 10).join("\n")}` : "",
    ].filter(Boolean).join("\n");
  };

  private handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(this.details());
      this.setState({ copied: true });
      setTimeout(() => this.setState({ copied: false }), 2000);
    } catch { /* clipboard unavailable — the details are visible to copy by hand */ }
  };

  public render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-card rounded-2xl border border-border shadow-sm p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-red-50 dark:bg-red-950/40 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-foreground">Something went wrong</h1>
              <p className="text-sm text-muted-foreground">An unexpected error occurred in the application.</p>
            </div>
          </div>

          {this.state.error && (
            <details className="mb-5 rounded-lg border border-border bg-muted/50 p-3">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Technical details</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs text-foreground/80">{this.details()}</pre>
              <Button variant="outline" size="sm" onClick={this.handleCopy} className="mt-2 h-7 gap-1.5 text-xs">
                {this.state.copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {this.state.copied ? "Copied" : "Copy details"}
              </Button>
            </details>
          )}

          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={this.handleReset} className="flex-1">
              Try again
            </Button>
            <Button size="sm" onClick={this.handleReload} className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Reload page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
