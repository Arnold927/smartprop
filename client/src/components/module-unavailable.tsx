import { Construction } from "lucide-react";
import { Link } from "wouter";

/**
 * Shown for modules whose pages exist in the codebase but whose server
 * endpoints have never been built (workforce, security operations,
 * construction projects, enhanced service providers). Instead of a page that
 * loads, fires failing requests and shows empty tables, the user gets a clear
 * message and a way back. Re-point the route at the real page once the API exists.
 */
export default function ModuleUnavailable({ name, alternative }: { name: string; alternative?: { label: string; href: string } }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
          <Construction className="w-7 h-7 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">{name} isn't available yet</h1>
        <p className="text-sm text-muted-foreground">
          This module is still being built. Nothing is wrong with your account or your data.
        </p>
        {alternative && (
          <Link href={alternative.href} className="inline-flex items-center justify-center h-11 px-5 rounded-lg bg-primary text-primary-foreground text-sm font-medium">
            {alternative.label}
          </Link>
        )}
      </div>
    </div>
  );
}
