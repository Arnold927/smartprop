# Migration from Replit to Standalone Express.js

## Overview

This document outlines the changes made to migrate the Smart Prop application from Replit to a standalone Express.js application that can run on any hosting platform.

## Changes Made

### 1. Removed Replit-Specific Files

- **Deleted**: `server/replitAuth.ts` - Replit OAuth authentication module
- **Reason**: Replaced with custom JWT-based authentication

### 2. Updated Dependencies

**Removed packages:**
- `openid-client` - Used only for Replit OAuth
- `passport` - Used only for Replit OAuth  
- `memoizee` - Used only for Replit OAuth
- `connect-pg-simple` - Used only for Replit session storage

**Added packages:**
- `axios` - Required by WhatsApp service

### 3. Environment Variables

**Removed:**
- `REPLIT_DOMAINS` - Replit-specific domain configuration
- `REPL_ID` - Replit OAuth client ID
- `ISSUER_URL` - Replit OAuth issuer URL

**Retained:**
- `DATABASE_URL` - PostgreSQL connection string (update with your own)
- `JWT_SECRET` - JWT access token secret
- `JWT_REFRESH_SECRET` - JWT refresh token secret
- `SESSION_SECRET` - Session secret
- `PORT` - Server port (default: 5000)
- `NODE_ENV` - Environment (development/production)

### 4. Authentication System

**Before:** Replit OAuth with passport.js
**After:** Custom JWT-based authentication

The application now uses:
- `/api/auth/signup` - User registration
- `/api/auth/login` - User login with JWT tokens
- `/api/auth/logout` - User logout
- JWT middleware for protected routes

### 5. Frontend Changes

**Removed:**
- Replit banner script from `client/index.html`
- "Continue with Replit" OAuth buttons from login page
- Replit OAuth handler function

**Updated:**
- Activity tracker now logs `jwt_auth` instead of `replit_oauth`

### 6. Mobile App Configuration

**Updated:** `mobile-apps/src/services/config.ts`
- Changed from Replit URLs to localhost/configurable URLs
- Added instructions for updating with production URLs

### 7. Code Structure

**Updated imports:**
- `server/routes.ts` now imports `isAuthenticated` from `./middleware/auth` instead of `./replitAuth`
- Added `isAuthenticated` export to `server/middleware/auth.ts` for backward compatibility

## Database Setup

The application uses PostgreSQL (currently configured with Neon serverless). To use your own database:

1. Set up a PostgreSQL instance (local or cloud)
2. Update `DATABASE_URL` in `.env` file
3. Run migrations: `npm run db:push`

## Running the Application

### Development

```bash
# Install dependencies
npm install
cd client && npm install && cd ..

# Start backend server
npm run dev

# Start frontend (in a new terminal)
npm run client:dev
```

### Production

```bash
# Build client
cd client && npm run build && cd ..

# Set environment
export NODE_ENV=production

# Start server
npm run dev
```

The server will serve both API and static files on the configured PORT (default: 5000).

## Deployment Options

The application can now be deployed to:
- **VPS** (Ubuntu/Debian) with PM2 and Nginx
- **Heroku** - Simple git-based deployment
- **DigitalOcean App Platform** - Automated deployment
- **AWS** (EC2, Elastic Beanstalk, or ECS)
- **Railway** - Simple deployment platform
- **Render** - Modern cloud platform
- Any Node.js hosting service

See `README.md` for detailed deployment instructions.

## Security Considerations

1. **Update secrets**: Change all JWT and session secrets in `.env`
2. **Use HTTPS**: Always use SSL/TLS in production
3. **Secure database**: Use strong passwords and restrict access
4. **Environment variables**: Never commit `.env` to version control
5. **Rate limiting**: Consider adding rate limiting for production

## Testing

The server starts successfully and listens on the configured port. The authentication system is fully functional with:
- User registration
- User login with JWT tokens
- Protected API routes
- Session management

## Known Issues

None. The migration is complete and the application is ready for deployment.

## Next Steps

1. Update `DATABASE_URL` with your PostgreSQL credentials
2. Change all secrets in `.env` to secure random values
3. Install client dependencies: `cd client && npm install`
4. Test the application locally
5. Deploy to your chosen hosting platform

## Support

For questions or issues, refer to the main `README.md` file or create an issue in the project repository.

---

**Migration Date**: December 30, 2025
**Migration Status**: ✅ Complete
