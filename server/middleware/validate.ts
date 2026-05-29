/**
 * server/middleware/validate.ts
 *
 * A tiny Express middleware factory that validates req.body against a Zod
 * schema and returns a consistent 422 response if it fails.
 *
 * Usage (new routes should use this; existing validated routes can migrate):
 *
 *   import { validate } from "../middleware/validate";
 *   import { insertTenantSchema } from "@shared/schema";
 *
 *   router.post("/", validate(insertTenantSchema), async (req, res) => {
 *     // req.body is now the fully-typed, validated value
 *     const tenant = await storage.createTenant(req.body);
 *     res.status(201).json(tenant);
 *   });
 *
 * For partial updates (PATCH/PUT):
 *   router.patch("/:id", validate(insertTenantSchema.partial()), handler);
 *
 * The 422 response shape:
 *   { message: "Validation error", errors: { fieldName: ["error message"] } }
 *
 * This matches the shape already used in the organisations and M-Pesa routes,
 * giving clients a single consistent error contract across all endpoints.
 */

import type { Request, Response, NextFunction } from "express";
import { z } from "zod";

export function validate<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(422).json({
        message: "Validation error",
        errors: result.error.flatten().fieldErrors,
      });
    }
    // Replace req.body with the coerced, validated value so handlers
    // can trust the types without re-parsing.
    req.body = result.data;
    next();
  };
}

/**
 * validate.query — same pattern for req.query parameters.
 *
 * Example:
 *   const pageSchema = z.object({ page: z.coerce.number().min(1).default(1) });
 *   router.get("/", validate.query(pageSchema), handler);
 */
validate.query = function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(422).json({
        message: "Invalid query parameters",
        errors: result.error.flatten().fieldErrors,
      });
    }
    (req as any).validatedQuery = result.data;
    next();
  };
};
