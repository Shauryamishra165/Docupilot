# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Docmost is an open-source collaborative wiki and documentation software. It features real-time collaboration, diagrams (Draw.io, Excalidraw, Mermaid), spaces, permissions management, groups, comments, page history, search, and file attachments.

## Development Commands

### Full-Stack Development
```bash
pnpm dev                    # Run both frontend and backend concurrently
```

### Individual Services
```bash
pnpm client:dev             # Frontend only (Vite dev server)
pnpm server:dev             # Backend only (NestJS with watch)
pnpm collab:dev             # Collaboration server (real-time editing)
```

### Build
```bash
pnpm build                  # Build all packages
pnpm server:build           # Build server only
pnpm client:build           # Build client only
pnpm editor-ext:build       # Build editor extensions
```

### Database Migrations (from apps/server)
```bash
pnpm migration:create       # Create new migration
pnpm migration:up           # Run pending migrations
pnpm migration:down         # Rollback last migration
pnpm migration:latest       # Run all pending migrations
pnpm migration:redo         # Rollback and rerun last migration
pnpm migration:codegen      # Generate TypeScript types from DB schema
```

### Testing (from apps/server)
```bash
pnpm test                   # Run unit tests
pnpm test:watch             # Run tests in watch mode
pnpm test:e2e               # Run end-to-end tests
pnpm test:cov               # Run tests with coverage
```

### Linting & Formatting
```bash
pnpm --filter server lint   # Lint server code
pnpm --filter client lint   # Lint client code
pnpm --filter server format # Format server code
pnpm --filter client format # Format client code
```

### AI Service (from ai/ directory)
```bash
pip install -r requirements.txt   # Install Python dependencies
python main.py                    # Run AI service
uvicorn main:app --port 8000 --reload  # Run with hot reload
```

### Cloud AI Server (from apps/cloud-ai-server)
```bash
pnpm start:dev              # Development mode with hot reload
pnpm build && pnpm start    # Production mode
```

## Architecture Overview

### Monorepo Structure (pnpm workspaces + Nx)

```
apps/
├── client/          # React frontend (Vite, Mantine UI, Tiptap editor)
├── server/          # NestJS backend (Fastify, Kysely ORM, PostgreSQL)
└── cloud-ai-server/ # NestJS service for embeddings/vector search

packages/
├── editor-ext/      # Shared Tiptap editor extensions
└── ee/              # Enterprise edition features (separate license)

ai/                  # Python FastAPI service for AI chat (LangGraph + Gemini)
```

### Backend (apps/server)

**Framework**: NestJS with Fastify adapter

**Key Modules** (in `src/core/`):
- `page/` - Document/page management
- `space/` - Workspaces organization
- `workspace/` - Multi-tenant workspace management
- `auth/` - Authentication (JWT, SAML, OIDC, LDAP)
- `user/`, `group/` - User and permissions management
- `search/` - Full-text search (PostgreSQL pg_trgm)
- `embedding/` - Vector embeddings for semantic search
- `comment/` - Page comments
- `attachment/` - File uploads (local or S3)
- `share/` - Public page sharing

**Database**: PostgreSQL with Kysely (type-safe query builder)
- Migrations in `src/database/migrations/`
- Types generated via `migration:codegen`
- Vector support via pgvector extension

**Real-time Collaboration**:
- Hocuspocus server in `src/collaboration/`
- Uses Yjs for CRDT-based sync
- Redis adapter for multi-instance scaling

### Frontend (apps/client)

**Framework**: React 18 with Vite

**Key Technologies**:
- **UI**: Mantine v8 component library
- **Editor**: Tiptap (ProseMirror-based) with collaborative editing
- **State**: Jotai for atoms, React Query for server state
- **Routing**: React Router v7

**Feature Structure** (in `src/features/`):
- `editor/` - Tiptap editor with AI sidebar integration
- `page/` - Page viewing and management
- `space/` - Space navigation and settings
- `ai/` - AI chat sidebar and tool execution
- `search/` - Search UI components
- `auth/` - Login, registration, SSO

### AI System (Custom Addition)

**Python AI Service** (`ai/`):
- FastAPI server on port 8000
- LangGraph agent with Gemini 2.5 Flash
- Tools: document read/write, vector search, workspace navigation
- Communicates with backend via internal APIs

**Cloud AI Server** (`apps/cloud-ai-server/`):
- NestJS service on port 3001
- Generates and stores document embeddings
- Provides vector similarity search endpoint

**Frontend AI Integration** (`apps/client/src/features/ai/`):
- AI sidebar component in editor
- Tool executor converts AI commands to ProseMirror operations
- SSE streaming for real-time responses

## Key Configuration

### Environment Variables (root .env)
```
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
APP_SECRET=<32+ char secret>
```

### AI Service Environment (ai/.env)
```
GEMINI_API_KEY=<your-key>
BACKEND_URL=http://localhost:3000
CLOUD_AI_URL=http://localhost:3001
API_KEY=<service-api-key>
```

## Enterprise Features

Files under these paths are under enterprise license:
- `apps/server/src/ee/`
- `apps/client/src/ee/`
- `packages/ee/`

## Important Patterns

### Editor Extensions
Custom Tiptap extensions live in `packages/editor-ext/`. Changes here require rebuilding (`pnpm editor-ext:build`) before they appear in the client.

### Internal APIs
The server exposes internal endpoints at `/api/internal/ai/*` for service-to-service communication (authenticated via X-API-Key header, not JWT).

### Database Queries
Use Kysely's type-safe query builder. Repository pattern is used in `src/database/repos/`.
