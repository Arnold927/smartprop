import type { JwtPayload } from 'jsonwebtoken';

export interface CustomJWTPayload extends JwtPayload {
  userId?: string;
  id?: string;
  claims?: {
    sub?: string;
    organizationId?: number;
    [key: string]: any;
  };
  email?: string;
  organizationId?: number; 
  role?: string;
  firstName?: string;
  lastName?: string;
}

