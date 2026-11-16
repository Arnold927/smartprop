import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { getSectionTabs, isNavHrefActive } from "@/lib/roleNav";

/**
 * Slim "pages in this area" strip shown at the top of a section's list pages
 * (e.g. Finances → Overview · Rent collection · Arrears · Expenses …).
 *
 * The sidebar lists each area once; this strip is how users move between the
 * related pages, so no page is listed twice and none becomes unreachable.
 * Built from the same nav config as the sidebar (lib/roleNav.ts).
 */
export default function SectionTabs() {
  const [location] = useLocation();
  const { user } = useAuth();
  const { t } = useTranslation();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const section = getSectionTabs(user?.role, t, false, location, search);
  if (!section) return null;
  const anyExact = section.tabs.some(x => isNavHrefActive(x.href, location, search, true));

  return (
    <nav
      aria-label={`${section.title} sections`}
      className="px-4 md:px-6 pt-3 pb-1"
    >
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1 -mx-1 px-1">
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">
          {section.title}
        </span>
        {section.tabs.map(tab => {
          // Exact match (incl. ?tab=) first; if the page switched its own tab
          // and none match exactly, fall back to the tab for this path.
          const active = anyExact
            ? isNavHrefActive(tab.href, location, search, true)
            : tab.href.split("?")[0] === location;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              ref={(el: HTMLAnchorElement | null) => {
                // keep the current page's tab visible when the strip scrolls (phones)
                if (active && el) {
                  const box = el.parentElement;
                  if (box) box.scrollLeft = Math.max(0, el.offsetLeft - box.clientWidth / 2 + el.offsetWidth / 2);
                }
              }}
              className={`inline-flex min-h-[36px] items-center sm:min-h-0 shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {tab.name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
