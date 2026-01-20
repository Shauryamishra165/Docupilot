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
   EXTERNAL_SERVICE_API_KEY=parth128
   ALLOWED_ORIGINS=http://localhost:3000
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
## API Key Authentication
The service uses `ApiKeyAuthGuard` to verify that requests come from the main server. 
All endpoints require the `X-API-Key` header with the value from `EXTERNAL_SERVICE_API_KEY` environment variable.
## Deployment

This service should be deployed separately from the main Docmost server:

- **Recommended**: Google Cloud Run, AWS ECS, or Railway
- **Database**: Shared PostgreSQL with main server (for page_embeddings table)
- **Environment**: Production with proper secrets management

## Security

All endpoints require API key authentication (`X-API-Key` header)
- Context headers for tracking (`X-Workspace-Id`, `X-User-Id`, `X-Page-Id`)
- CORS restricted to backend origin (configurable via `ALLOWED_ORIGINS`)
- Input validation via ValidationPipe

## Development Notes

- This service shares the database with the main server
- Uses the same repos from `@docmost/db`
- Imports utilities from main server (collaboration, export, etc.)
- Should NOT be bundled with Electron app
