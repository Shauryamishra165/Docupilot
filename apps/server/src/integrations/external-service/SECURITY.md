# AI Chat Service - Security Architecture

## Request Flow

```
Frontend (React) 
  → Backend (NestJS port 3000) 
    → AI Service (Python port 8000) 
      → Gemini API
```

## Security Measures Implemented

### 1. **JWT Authentication**
- ✅ All requests require valid JWT token
- ✅ Token validated via `JwtAuthGuard`
- ✅ User and workspace extracted from JWT

### 2. **Workspace Context Validation**
- ✅ Workspace ID automatically included from JWT
- ✅ Workspace context middleware validates all requests
- ✅ No workspace = request rejected

### 3. **CASL Permission Checks**
- ✅ Requires `WorkspaceCaslAction.Edit` on `WorkspaceCaslSubject.Settings`
- ✅ Permission checked before any AI service call
- ✅ Unauthorized attempts logged

### 4. **API Key Protection**
- ✅ API key (`parth128`) stored in backend environment variables
- ✅ Never exposed to frontend
- ✅ Backend adds `X-API-Key` header when calling AI service
- ✅ Environment variable: `EXTERNAL_SERVICE_API_KEY=parth128`

### 5. **Rate Limiting**
- ✅ 30 requests per minute per user/workspace
- ✅ Uses Redis for distributed rate limiting (if available)
- ✅ Falls back to in-memory rate limiting
- ✅ Returns `429 Too Many Requests` when exceeded

### 6. **Input Validation**
- ✅ DTOs with `class-validator` decorators
- ✅ Global `ValidationPipe` with whitelist enabled
- ✅ Validates message structure and content
- ✅ Ensures last message is from user

### 7. **CORS Security**
- ✅ AI service CORS restricted to backend origin
- ✅ Default: `http://localhost:3000`
- ✅ Configurable via `ALLOWED_ORIGINS` environment variable
- ✅ Only allows necessary headers

### 8. **Error Handling**
- ✅ Comprehensive error handling at all layers
- ✅ No sensitive information leaked in errors
- ✅ Proper HTTP status codes
- ✅ Detailed logging for debugging

### 9. **Logging & Auditing**
- ✅ All AI requests logged with:
  - User ID
  - Workspace ID
  - Message count
  - Timestamp
- ✅ Failed authentication attempts logged
- ✅ Rate limit violations logged

### 10. **Secure Communication**
- ✅ HTTPS recommended for production
- ✅ API key transmitted via secure headers
- ✅ Workspace context in headers for tracking
- ✅ Timeout protection (30 seconds default)

## Environment Variables

### Backend (.env)
```bash
EXTERNAL_SERVICE_URL=http://localhost:8000
EXTERNAL_SERVICE_API_KEY=parth128
EXTERNAL_SERVICE_TIMEOUT=30000
```

### AI Service (ai/.env)
```bash
API_KEY=parth128
GEMINI_API_KEY=your-gemini-api-key
ALLOWED_ORIGINS=http://localhost:3000  # Optional, defaults to localhost:3000
```

## API Endpoints

### Frontend → Backend
```
POST /api/external-service/ai/chat
Headers: 
  - Cookie: authToken (JWT)
Body:
  {
    "messages": [
      {"role": "user", "content": "..."},
      {"role": "assistant", "content": "..."}
    ]
  }
```

### Backend → AI Service
```
POST http://localhost:8000/api/chat
Headers:
  - X-API-Key: parth128
  - X-Workspace-Id: <workspace-id>
  - X-User-Id: <user-id>
  - Content-Type: application/json
Body:
  {
    "messages": [...]
  }
```

## Rate Limiting

- **Limit**: 30 requests per minute per user/workspace combination
- **Window**: 60 seconds (rolling window)
- **Storage**: Redis (if available) or in-memory fallback
- **Response**: `429 Too Many Requests` with retry-after header

## Production Recommendations

1. **Change API Key**: Use a strong, randomly generated API key
2. **HTTPS**: Enable HTTPS for all services
3. **CORS**: Set `ALLOWED_ORIGINS` to your production domain
4. **Rate Limits**: Adjust based on your usage patterns
5. **Monitoring**: Set up alerts for rate limit violations
6. **Logging**: Centralize logs for security auditing
7. **API Key Rotation**: Implement key rotation strategy

## Security Checklist

- [x] JWT authentication required
- [x] Workspace permissions checked
- [x] API key not exposed to frontend
- [x] Rate limiting implemented
- [x] Input validation enabled
- [x] CORS properly configured
- [x] Error handling secure
- [x] Logging and auditing enabled
- [x] Timeout protection
- [x] Secure headers used

