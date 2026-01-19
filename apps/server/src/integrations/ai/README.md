# AI Integration Module

This module provides HTTP client services to communicate with the cloud-ai-server.

## CloudAiClientService

Handles all HTTP communication with the cloud-ai-server for embedding operations.

### Environment Variables

Add to your `.env` file:

```env
# Cloud AI Server URL (defaults to http://localhost:3001)
CLOUD_AI_URL=http://localhost:3001
# Or for production:
CLOUD_AI_URL=https://ai.docmost.com
```

### Usage

The service is automatically used by the `EmbeddingProcessor` in the queue module. When pages are created, updated, or deleted, the processor will call the cloud-ai-server via HTTP.

### Endpoints Called

- `POST /embeddings/generate` - Generate embeddings for a page
- `POST /embeddings/delete` - Delete embeddings for a page
