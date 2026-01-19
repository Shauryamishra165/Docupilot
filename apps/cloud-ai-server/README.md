# Cloud AI Server

This is the **proprietary cloud service** that handles AI features for Docmost. This code is **NOT distributed** to users in the Electron app.

## What This Service Does

- **Embedding Generation**: Creates vector embeddings for pages using Google AI SDK
- **Semantic Search**: Provides similarity search across documents
- **AI Agent** (coming soon): Agent with tools for editing and answering questions

## Architecture

```
┌─────────────────────────────────────┐
│    User's Electron App              │
│  (No AI code - only client SDK)     │
└──────────────┬──────────────────────┘
               │ HTTPS + Subscription Token
               ▼
┌─────────────────────────────────────┐
│    Cloud AI Server (This Service)   │
│  - Embedding generation             │
│  - AI agent                         │
│  - Vector database                  │
└─────────────────────────────────────┘
```

## Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment variables:**
   ```env
   PORT=3001
   DATABASE_URL=postgresql://...
   GEMINI_API_KEY=your-key-here
   SUBSCRIPTION_SECRET=your-secret-for-verifying-tokens
   ```

3. **Build:**
   ```bash
   pnpm build
   ```

4. **Run:**
   ```bash
   pnpm start:dev  # Development
   pnpm start:prod # Production
   ```

## Subscription Verification

The service uses `SubscriptionGuard` to verify that requests come from users with active subscriptions. 

**TODO**: Integrate with your billing system (Stripe, etc.) in `src/auth/subscription.service.ts`

## Deployment

This service should be deployed separately from the main Docmost server:

- **Recommended**: Google Cloud Run, AWS ECS, or Railway
- **Database**: Shared PostgreSQL with main server (for page_embeddings table)
- **Environment**: Production with proper secrets management

## Security

- All endpoints require subscription token
- Rate limiting per subscription plan
- CORS configured for Electron apps
- No AI code in client applications

## Development Notes

- This service shares the database with the main server
- Uses the same repos from `@docmost/db`
- Imports utilities from main server (collaboration, export, etc.)
- Should NOT be bundled with Electron app
