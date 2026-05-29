import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],

  resolve: {
    // Pin ALL react imports to the single copy inside client/node_modules.
    dedupe: ["react", "react-dom", "react/jsx-runtime"],
    alias: [
      { find: /^react-dom\/(.*)$/, replacement: path.resolve(__dirname, "node_modules/react-dom/$1") },
      { find: /^react\/(.*)$/,     replacement: path.resolve(__dirname, "node_modules/react/$1") },
      { find: "react",             replacement: path.resolve(__dirname, "node_modules/react") },
      { find: "react-dom",         replacement: path.resolve(__dirname, "node_modules/react-dom") },
      { find: "@",                 replacement: path.resolve(__dirname, "src") },
      { find: "@shared",           replacement: path.resolve(__dirname, "../shared") },
      { find: "@assets",           replacement: path.resolve(__dirname, "src/assets") },
    ],
  },

  build: {
    outDir: path.resolve(__dirname, "../dist/public"),
    emptyOutDir: true,
    sourcemap: false,

    rollupOptions: {
      output: {
        /**
         * Manual chunks — keeps related lazy pages in the same downloaded file
         * so a navigation within a section (e.g. Tenants list → Tenant detail)
         * reuses the already-downloaded chunk instead of fetching a new one.
         *
         * Strategy:
         *   vendor-*   Third-party libs (never change between deploys)
         *   portal-*   One chunk per role portal (each role only downloads theirs)
         *   page-*     Feature-domain page groups
         */
        manualChunks(id: string) {
          // ── Third-party vendor splits ────────────────────────────────────
          // recharts is ~180 KB gzipped — keep it out of the main bundle.
          // It's only used by dashboard/reports pages; lazy-loaded with them.
          if (id.includes("node_modules/recharts") ||
              id.includes("node_modules/d3-") ||
              id.includes("node_modules/victory-")) {
            return "vendor-charts";
          }

          if (id.includes("node_modules/react") ||
              id.includes("node_modules/scheduler")) {
            return "vendor-react";
          }

          if (id.includes("node_modules/@tanstack")) {
            return "vendor-query";
          }

          if (id.includes("node_modules/lucide-react")) {
            return "vendor-icons";
          }

          if (id.includes("node_modules/date-fns")) {
            return "vendor-dates";
          }

          if (id.includes("node_modules/zod") ||
              id.includes("node_modules/@hookform") ||
              id.includes("node_modules/react-hook-form")) {
            return "vendor-forms";
          }

          if (id.includes("node_modules/")) {
            return "vendor-misc";
          }

          // ── App source splits ────────────────────────────────────────────
          // Role portals: each role only ever loads their own chunk
          if (id.includes("pages/landlord-portal"))  return "portal-landlord";
          if (id.includes("pages/tenant-portal"))    return "portal-tenant";
          if (id.includes("pages/staff-portal"))     return "portal-staff";
          if (id.includes("pages/guard-checkin"))    return "portal-guard";

          // Tenant-domain pages
          if (id.includes("pages/tenant") ||
              id.includes("pages/rent-collection") ||
              id.includes("pages/leases") ||
              id.includes("pages/arrears")) {
            return "page-tenants";
          }

          // Finance-domain pages
          if (id.includes("pages/finance") ||
              id.includes("pages/billing") ||
              id.includes("pages/expense") ||
              id.includes("pages/rent-to-own") ||
              id.includes("pages/diaspora") ||
              id.includes("pages/utilities") ||
              id.includes("pages/utility") ||
              id.includes("pages/enterprise-finance")) {
            return "page-finance";
          }

          // Maintenance-domain pages
          if (id.includes("pages/maintenance") ||
              id.includes("pages/contractor") ||
              id.includes("pages/work-order") ||
              id.includes("pages/construction")) {
            return "page-maintenance";
          }

          // Operations-domain pages
          if (id.includes("pages/security") ||
              id.includes("pages/visitor") ||
              id.includes("pages/parking") ||
              id.includes("pages/workforce") ||
              id.includes("pages/staff/")) {
            return "page-operations";
          }

          // Communications-domain pages
          if (id.includes("pages/messages") ||
              id.includes("pages/broadcast") ||
              id.includes("pages/marketing") ||
              id.includes("pages/whatsapp") ||
              id.includes("pages/citizen")) {
            return "page-comms";
          }

          // Reports & admin pages
          if (id.includes("pages/reports") ||
              id.includes("pages/ai-analytics") ||
              id.includes("pages/facility") ||
              id.includes("pages/sustainability") ||
              id.includes("pages/organization") ||
              id.includes("pages/user-management")) {
            return "page-admin";
          }

          // Properties
          if (id.includes("pages/properties") ||
              id.includes("pages/property-")) {
            return "page-properties";
          }

          // Heavy shared components (lease generator, charts, etc.)
          if (id.includes("components/lease-agreement-generator") ||
              id.includes("components/tenant-rent-payments") ||
              id.includes("components/vehicle-log-tab") ||
              id.includes("components/tenant-visitor-invite")) {
            return "components-heavy";
          }
        },
      },
    },
  },

  cacheDir: "node_modules/.vite",

  optimizeDeps: {
    force: true,
  },

  server: {
    port: 5173,
    proxy: {
      "/api":     { target: "http://localhost:5000", changeOrigin: true, secure: false },
      "/uploads": { target: "http://localhost:5000", changeOrigin: true, secure: false },
    },
    fs: { allow: [".."] },
  },
});
