import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SUPPORTED_LANGUAGES, type SupportedLang } from "@/i18n";
import { useToast } from "@/hooks/use-toast";

interface LanguageToggleProps {
  /** Render as a compact icon-only button (default) or show label text */
  variant?: "icon" | "full";
  className?: string;
}

export function LanguageToggle({ variant = "icon", className }: LanguageToggleProps) {
  const { i18n, t } = useTranslation();
  const { toast } = useToast();

  const currentLang = i18n.language?.startsWith("sw") ? "sw" : "en";

  function changeLang(code: SupportedLang) {
    if (code === currentLang) return;
    i18n.changeLanguage(code);
    const msg = code === "sw"
      ? "Lugha imebadilishwa kuwa Kiswahili"
      : "Language changed to English";
    toast({ title: msg, duration: 2500 });
  }

  const currentLabel = SUPPORTED_LANGUAGES.find((l) => l.code === currentLang)?.nativeLabel ?? "EN";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={variant === "icon" ? "icon" : "sm"}
          className={className}
          title={t("language.toggle")}
          aria-label={t("language.toggle")}
        >
          <Globe className="h-4 w-4" />
          {variant === "full" && (
            <span className="ml-1.5 text-xs font-medium">{currentLabel}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => changeLang(lang.code)}
            className={
              lang.code === currentLang
                ? "font-semibold text-primary bg-primary/5"
                : "cursor-pointer"
            }
          >
            <span className="mr-2 text-base leading-none">
              {lang.code === "en" ? "🇬🇧" : "🇰🇪"}
            </span>
            {lang.nativeLabel}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default LanguageToggle;
