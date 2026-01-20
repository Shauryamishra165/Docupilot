[33mcommit 49e8999e055c54147fc639a2331a55525864407d[m
Author: Rahul Gandhi <parthmishra128@gmail.com>
Date:   Tue Jan 20 13:27:46 2026 +0530

    Add API key authentication to Cloud AI server, vector search tool, and slugId support
    
    - Added API key authentication to Cloud AI server (port 3001) matching Python AI service
    - Created vector_search tool for semantic search across documents
    - Added support for both UUID and slugId in vector search filtering
    - Removed subscription guard, replaced with common API key auth
    - Updated CORS to restrict to backend origin
    - Fixed schema validation to remove minimum/maximum fields for Gemini compatibility
    - Added comprehensive test queries documentation

ai/main.py
ai/test_vector_search_queries.md
ai/tools/README.md
ai/tools/tool_registry.py
ai/tools/vector_search_tools.py
apps/cloud-ai-server/MIGRATION.md
apps/cloud-ai-server/README.md
apps/cloud-ai-server/src/auth/api-key-auth.guard.ts
apps/cloud-ai-server/src/auth/auth.module.ts
apps/cloud-ai-server/src/auth/subscription.guard.ts
apps/cloud-ai-server/src/auth/subscription.service.ts
apps/cloud-ai-server/src/cloud-ai.module.ts
apps/cloud-ai-server/src/database/repos/embedding/page-embeddings.repo.ts
apps/cloud-ai-server/src/embeddings/dto/similarity-search.dto.ts
apps/cloud-ai-server/src/embeddings/embedding.controller.ts
apps/cloud-ai-server/src/embeddings/embedding.module.ts
apps/cloud-ai-server/src/embeddings/embedding.service.ts
apps/cloud-ai-server/src/integrations/environment/environment.service.ts
apps/cloud-ai-server/src/main.ts
apps/server/src/integrations/ai/cloud-ai-client.service.ts
apps/server/src/integrations/queue/processors/embedding.processor.ts
