/**
 * Thin re-export — all authenticated fetching goes through queryClient.ts.
 * This file exists only for backward compatibility with any legacy imports.
 */
export { apiRequest as fetchWithAuth, refreshAccessToken } from "./queryClient";
