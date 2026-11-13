import { AlertTriangle } from "lucide-react";

/**
 * Shown when a list fails to load. Without it, a failed request looks exactly
 * like "you have no data yet" (an empty table), which sends users hunting for
 * records that are fine. Gives a plain message and a retry.
 */
export default function QueryError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center text-center px-4 py-12 space-y-3">
      <div className="w-14 h-14 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center">
        <AlertTriangle className="w-7 h-7 text-red-600" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">Couldn't load {what}</p>
        <p className="text-xs text-muted-foreground mt-0.5 max-w-xs">
          Your data is safe. Check your connection and try again.
        </p>
      </div>
      <button
        onClick={onRetry}
        className="inline-flex items-center justify-center h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium"
      >
        Try again
      </button>
    </div>
  );
}
