# External Service Integration

This module provides a secure, workspace-aware integration for connecting Docmost backend to external services.

## Features

✅ **JWT Authentication** - All endpoints require valid JWT tokens  
✅ **Workspace Context** - Automatically includes workspace information in requests  
✅ **CASL Permissions** - Role-based access control (requires workspace edit permissions)  
✅ **Input Validation** - DTOs with class-validator decorators  
✅ **Error Handling** - Comprehensive error handling with proper HTTP status codes  
✅ **Timeout Protection** - Configurable request timeouts  
✅ **Security Headers** - Automatic workspace and user context headers  

## Architecture

```
external-service/
├── dto/
│   ├── call-external-service.dto.ts    # Request/Response DTOs
│   └── external-service-config.dto.ts  # Configuration DTOs
├── external-service.controller.ts      # REST endpoints with guards
├── external-service.service.ts          # HTTP client service
├── external-service.module.ts          # NestJS module
└── index.ts                            # Exports
```

## Configuration

Add these environment variables to your `.env` file:

```bash
# External Service Configuration
EXTERNAL_SERVICE_URL=http://localhost:8000
EXTERNAL_SERVICE_API_KEY=your-api-key-here
EXTERNAL_SERVICE_TIMEOUT=30000  # milliseconds (default: 30000)
```

## API Endpoints

### POST `/api/external-service/call`

Call an external service endpoint with workspace context.

**Authentication:** Required (JWT)  
**Permissions:** Workspace Edit permission required

**Request Body:**
```json
{
  "endpoint": "api/process",
  "method": "POST",
  "body": {
    "data": "example"
  },
  "headers": {
    "Custom-Header": "value"
  },
  "query": {
    "param": "value"
  }
}
```

**Response:**
```json
{
  "status": 200,
  "data": {
    "result": "success"
  },
  "headers": {
    "Content-Type": "application/json"
  }
}
```

### POST `/api/external-service/health`

Check external service health status.

**Authentication:** Required (JWT)  
**Permissions:** Workspace Read permission required

**Response:**
```json
{
  "healthy": true,
  "service": "external-service"
}
```

## Security Features

### 1. JWT Authentication
- All endpoints protected with `@UseGuards(JwtAuthGuard)`
- Workspace context automatically extracted from JWT token

### 2. Workspace Context Middleware
- Workspace ID automatically included in requests
- No need to add endpoints to exclusion list (works with workspace context)

### 3. CASL Permissions
- `call` endpoint requires `WorkspaceCaslAction.Edit` on `WorkspaceCaslSubject.Settings`
- `health` endpoint requires `WorkspaceCaslAction.Read` on `WorkspaceCaslSubject.Settings`

### 4. Automatic Headers
The service automatically adds these headers to external requests:
- `X-Workspace-Id`: Current workspace ID
- `X-Workspace-Name`: Current workspace name
- `X-User-Id`: Current user ID
- `Authorization`: Bearer token (if API key configured)

### 5. Input Validation
- All DTOs use `class-validator` decorators
- Global `ValidationPipe` ensures data integrity
- Whitelist enabled (unknown properties rejected)

### 6. Error Handling
- `BadRequestException`: Invalid input
- `ForbiddenException`: Insufficient permissions
- `GatewayTimeoutException`: Request timeout
- `ServiceUnavailableException`: External service unavailable

## Usage Example

```typescript
// In your controller or service
import { ExternalServiceService } from './integrations/external-service';

constructor(
  private readonly externalService: ExternalServiceService,
) {}

async processData(data: any, workspace: Workspace, userId: string) {
  const result = await this.externalService.callExternalService(
    {
      endpoint: 'api/process',
      method: 'POST',
      body: { data },
    },
    workspace,
    userId,
  );
  
  return result.data;
}
```

## Error Handling

The service handles various error scenarios:

- **Timeout Errors**: Throws `GatewayTimeoutException` after configured timeout
- **Connection Errors**: Throws `ServiceUnavailableException` for network failures
- **Invalid Requests**: Throws `BadRequestException` for validation errors
- **Permission Errors**: Throws `ForbiddenException` for unauthorized access

## Next Steps

1. **Create Your External Service**: Build your external service that will receive these requests
2. **Configure Environment**: Set `EXTERNAL_SERVICE_URL` and `EXTERNAL_SERVICE_API_KEY`
3. **Test Integration**: Use the `/api/external-service/health` endpoint to verify connectivity
4. **Implement Business Logic**: Add your specific endpoints and processing logic

## Notes

- The external service endpoints work **with** workspace context (not excluded)
- All requests automatically include workspace and user information
- The service uses native `fetch` API (no additional dependencies)
- Timeout is configurable per environment
- All requests are logged for debugging and auditing

