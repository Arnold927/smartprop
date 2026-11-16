import plugin from "tailwindcss/plugin";

/** @type {import('tailwindcss').Config} */
export default {
  /**
   * Fix: darkMode previously only recognised the `.dark` class, so
   * Tailwind's `dark:` variant utilities had no effect when the `.gray`
   * theme was active.  Using the selector strategy with a CSS custom
   * property check means `dark:` variants fire for BOTH `.dark` and
   * `.gray` on the <html> element, matching the three-way theme cycle
   * implemented in useDarkMode.ts (light → gray → dark → light).
   *
   * We also add `[data-theme="dark"]` and `[data-theme="gray"]` support
   * so server-rendered or non-JS environments can set the theme via an
   * HTML attribute instead of a class.
   */
  darkMode: ["variant", [
    "&:is(.dark *)",
    "&:is(.gray *)",
    "&:is([data-theme='dark'] *)",
    "&:is([data-theme='gray'] *)",
  ]],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border:     "hsl(var(--border) / <alpha-value>)",
        input:      "hsl(var(--input) / <alpha-value>)",
        ring:       "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT:    "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT:    "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT:    "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        brand: {
          primary:   "hsl(var(--brand-primary) / <alpha-value>)",
          secondary: "hsl(var(--brand-secondary) / <alpha-value>)",
          accent:    "hsl(var(--brand-accent) / <alpha-value>)",
          neutral:   "hsl(var(--brand-neutral) / <alpha-value>)",
        },
        status: {
          success: "hsl(var(--status-success) / <alpha-value>)",
          warning: "hsl(var(--status-warning) / <alpha-value>)",
          error:   "hsl(var(--status-error) / <alpha-value>)",
          info:    "hsl(var(--status-info) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft:       "0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 10px 20px -2px rgba(0, 0, 0, 0.04)",
        card:       "0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)",
        "card-hover": "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
      },
      keyframes: {
        enter: {
          from: {
            opacity: "var(--tw-enter-opacity, 1)",
            transform: "translate3d(var(--tw-enter-translate-x, 0), var(--tw-enter-translate-y, 0), 0) scale3d(var(--tw-enter-scale, 1), var(--tw-enter-scale, 1), var(--tw-enter-scale, 1)) rotate(var(--tw-enter-rotate, 0))",
          },
        },
        exit: {
          to: {
            opacity: "var(--tw-exit-opacity, 1)",
            transform: "translate3d(var(--tw-exit-translate-x, 0), var(--tw-exit-translate-y, 0), 0) scale3d(var(--tw-exit-scale, 1), var(--tw-exit-scale, 1), var(--tw-exit-scale, 1)) rotate(var(--tw-exit-rotate, 0))",
          },
        },
      },
      backgroundImage: {
        "gradient-primary": "linear-gradient(135deg, hsl(var(--primary)) 0%, hsl(172, 66%, 50%) 100%)",
        "gradient-brand":   "linear-gradient(135deg, hsl(var(--brand-primary)) 0%, hsl(var(--brand-secondary)) 100%)",
        stripes:            "repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255, 255, 255, 0.1) 2px, rgba(255, 255, 255, 0.1) 4px)",
      },
    },
  },
  plugins: [
    /**
     * Enter/exit motion for dialogs, menus, popovers, sheets, tooltips and toasts.
     *
     * Every shadcn/Radix component in components/ui is written with classes like
     * `data-[state=open]:animate-in fade-in-0 zoom-in-95 slide-in-from-top-2`, but nothing
     * defined those classes, so every one of them appeared and disappeared instantly.
     * This is a small, dependency-free version of the classes those components expect
     * (same names as the tailwindcss-animate plugin), so no install step is needed.
     */
    plugin(({ addUtilities, matchUtilities, theme }) => {
      addUtilities({
        ".animate-in": {
          animationName: "enter",
          animationDuration: "var(--tw-anim-dur, 150ms)",
          "--tw-enter-opacity": "initial", "--tw-enter-scale": "initial", "--tw-enter-rotate": "initial",
          "--tw-enter-translate-x": "initial", "--tw-enter-translate-y": "initial",
        },
        ".animate-out": {
          animationName: "exit",
          animationDuration: "var(--tw-anim-dur, 150ms)",
          "--tw-exit-opacity": "initial", "--tw-exit-scale": "initial", "--tw-exit-rotate": "initial",
          "--tw-exit-translate-x": "initial", "--tw-exit-translate-y": "initial",
        },
      });
      matchUtilities({ "fade-in": (v) => ({ "--tw-enter-opacity": v }) }, { values: theme("opacity") });
      matchUtilities({ "fade-out": (v) => ({ "--tw-exit-opacity": v }) }, { values: theme("opacity") });
      matchUtilities({ "zoom-in": (v) => ({ "--tw-enter-scale": v }) }, { values: theme("scale") });
      matchUtilities({ "zoom-out": (v) => ({ "--tw-exit-scale": v }) }, { values: theme("scale") });
      const dist = { ...theme("spacing"), DEFAULT: "100%" };
      matchUtilities({
        "slide-in-from-top":    (v) => ({ "--tw-enter-translate-y": `-${v}` }),
        "slide-in-from-bottom": (v) => ({ "--tw-enter-translate-y": v }),
        "slide-in-from-left":   (v) => ({ "--tw-enter-translate-x": `-${v}` }),
        "slide-in-from-right":  (v) => ({ "--tw-enter-translate-x": v }),
        "slide-out-to-top":     (v) => ({ "--tw-exit-translate-y": `-${v}` }),
        "slide-out-to-bottom":  (v) => ({ "--tw-exit-translate-y": v }),
        "slide-out-to-left":    (v) => ({ "--tw-exit-translate-x": `-${v}` }),
        "slide-out-to-right":   (v) => ({ "--tw-exit-translate-x": v }),
      }, { values: { ...dist, "1/2": "50%", full: "100%" } });
      // `duration-*` already sets transition-duration; these also set the animation's length.
      matchUtilities({ duration: (v) => ({ "--tw-anim-dur": v }) }, { values: theme("transitionDuration") });
    }),
  ],
};
