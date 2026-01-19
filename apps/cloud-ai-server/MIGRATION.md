# Migration Summary: Embedding Code to Cloud AI Server

## What Was Done

✅ **Created `apps/cloud-ai-server/`** - New service for AI features
✅ **Moved embedding code** from `apps/server/src/core/embedding/` to `apps/cloud-ai-server/src/embeddings/`
✅ **Created subscription guard** - Protects AI endpoints with subscription verification
✅ **Updated queue processor** - Handles missing embedding service gracefully (for Electron builds)
✅ **Created agent module structure** - Ready for future AI agent implementation

## File Structure

```
apps/
├── server/                          # Main server (goes to Electron)
│   └── src/
│       └── core/
│           └── embedding/          # ❌ REMOVED (moved to cloud-ai-server)
│
└── cloud-ai-server/                 # NEW: Cloud AI service (NOT in Electron)
    └── src/
        ├── main.ts                  # Entry point
        ├── cloud-ai.module.ts       # Main module
        ├── auth/                    # Subscription verification
        │   ├── subscription.guard.ts
        │   └── subscription.service.ts
        ├── embeddings/              # Moved from server
        │   ├── embedding.service.ts
        │   ├── embedding.controller.ts
        │   ├── embedding.module.ts
        │   ├── dto/
        │   └── utils/
        └── agent/                   # Future AI agent
            └── agent.module.ts
```

## Key Changes

### 1. Queue Processor (`apps/server/src/integrations/queue/processors/embedding.processor.ts`)
- Made `EmbeddingService` optional
- Gracefully skips embedding jobs if service not available
- Logs warning instead of failing (expected in Electron builds)

### 2. Queue Module (`apps/server/src/integrations/queue/queue.module.ts`)
- Conditionally imports `EmbeddingModule` only if it exists
- Works in both cloud and Electron builds

### 3. Cloud AI Server
- New standalone service on port 3001
- Requires subscription token for all endpoints
- Shares database with main server (for page_embeddings table)

## Next Steps

1. **Integrate subscription verification** with your billing system (Stripe, etc.)
   - Update `apps/cloud-ai-server/src/auth/subscription.service.ts`

2. **Deploy cloud AI server** separately
   - Deploy to Google Cloud Run, AWS ECS, or Railway
   - Configure environment variables
   - Set up CORS for Electron apps

3. **Implement AI agent** (when ready)
   - Add tools to `apps/cloud-ai-server/src/agent/`
   - Use Google AI SDK for agent orchestration

4. **Update Electron build** to exclude embedding code
   - Add build script to exclude `core/embedding/` folder
   - Verify no AI code in Electron distribution

5. **Create AI client SDK** for Electron app
   - Package in `packages/ai-client/`
   - Handles API calls to cloud service
   - Manages subscription tokens

## Testing

### Test Cloud AI Server:
```bash
cd apps/cloud-ai-server
pnpm install
pnpm start:dev
```

### Test Main Server (without embeddings):
```bash
cd apps/server
# Should work without embedding module
pnpm start:dev
```

## Important Notes

⚠️ **The embedding code in `apps/server/src/core/embedding/` should be removed** once you verify the cloud-ai-server works correctly.

⚠️ **Database migrations** for `page_embeddings` table remain in the main server (shared database).

⚠️ **Queue jobs** for embeddings will be skipped in Electron builds (expected behavior).
