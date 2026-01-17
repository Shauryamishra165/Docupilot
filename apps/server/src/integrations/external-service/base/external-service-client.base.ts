import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  GatewayTimeoutException,
} from '@nestjs/common';
import { EnvironmentService } from '../../environment/environment.service';
import { Workspace } from '@docmost/db/types/entity.types';

export interface ExternalServiceRequest {
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: any;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface ExternalServiceResponse<T = any> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

@Injectable()
export abstract class ExternalServiceClientBase {
  protected readonly logger: Logger;
  protected readonly baseUrl: string;
  protected readonly apiKey: string;
  protected readonly timeout: number;

  constructor(
    protected readonly environmentService: EnvironmentService,
    serviceName: string,
  ) {
    this.logger = new Logger(serviceName);
    this.baseUrl =
      process.env.EXTERNAL_SERVICE_URL ||
      this.environmentService.getExternalServiceUrl() ||
      'http://localhost:8000';
    this.apiKey =
      process.env.EXTERNAL_SERVICE_API_KEY ||
      this.environmentService.getExternalServiceApiKey() ||
      'parth128';
    this.timeout =
      parseInt(
        process.env.EXTERNAL_SERVICE_TIMEOUT ||
          this.environmentService.getExternalServiceTimeout() ||
          '240000', // 4 minutes default (240 seconds = 240000ms)
        10,
      ) || 240000; // 4 minutes default

    this.logger.log(
      `${serviceName} configured: ${this.baseUrl} (timeout: ${this.timeout}ms)`,
    );
  }

  /**
   * Make a request to external service (shared by all services)
   */
  protected async callExternalService<T = any>(
    request: ExternalServiceRequest,
    workspace: Workspace,
    userId: string,
    additionalHeaders?: Record<string, string>,
  ): Promise<ExternalServiceResponse<T>> {
    try {
      const url = this.buildUrl(request.endpoint, request.query);
      const headers = this.prepareHeaders(
        request.headers,
        workspace,
        userId,
        additionalHeaders,
      );

      const requestOptions: RequestInit = {
        method: request.method || 'POST',
        headers,
        signal: AbortSignal.timeout(this.timeout),
      };

      if (request.body && ['POST', 'PUT', 'PATCH'].includes(request.method || 'POST')) {
        requestOptions.body = JSON.stringify(request.body);
      }

      this.logger.debug(
        `Calling external service: ${request.method || 'POST'} ${url} (workspace: ${workspace.id})`,
      );

      const response = await fetch(url, requestOptions);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `External service error: ${response.status} - ${errorText}`,
        );
        throw new ServiceUnavailableException(
          `External service returned error: ${response.statusText}`,
        );
      }

      const data = await this.parseResponse<T>(response);

      return {
        data,
        status: response.status,
        headers: this.extractResponseHeaders(response),
      };
    } catch (error: any) {
      return this.handleError(error, request.endpoint);
    }
  }

  /**
   * Build full URL
   */
  private buildUrl(endpoint: string, query?: Record<string, string>): string {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    const baseUrl = this.baseUrl.endsWith('/') ? this.baseUrl.slice(0, -1) : this.baseUrl;
    let url = `${baseUrl}/${cleanEndpoint}`;

    if (query && Object.keys(query).length > 0) {
      const queryString = new URLSearchParams(query).toString();
      url += `?${queryString}`;
    }

    return url;
  }

  /**
   * Prepare headers with authentication and workspace context
   */
  private prepareHeaders(
    customHeaders?: Record<string, string>,
    workspace?: Workspace,
    userId?: string,
    additionalHeaders?: Record<string, string>,
  ): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'X-API-Key': this.apiKey,
      'X-Workspace-Id': workspace?.id || '',
      'X-User-Id': userId || '',
      ...(workspace && { 'X-Workspace-Name': workspace.name }),
      ...customHeaders,
      ...additionalHeaders,
    };
  }

  /**
   * Parse response
   */
  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') || '';
    
    if (contentType.includes('application/json')) {
      return await response.json();
    }
    
    if (contentType.includes('text/')) {
      return (await response.text()) as any;
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer) as any;
  }

  /**
   * Extract response headers
   */
  private extractResponseHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return headers;
  }

  /**
   * Handle errors
   */
  private handleError(error: any, endpoint: string): never {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      this.logger.error(`External service timeout: ${endpoint}`);
      throw new GatewayTimeoutException(
        `Request timed out after ${this.timeout}ms`,
      );
    }

    if (error instanceof ServiceUnavailableException) {
      throw error;
    }

    if (error?.message?.includes('fetch failed') || error?.code === 'ECONNREFUSED') {
      this.logger.error(`External service connection failed: ${endpoint}`, error);
      throw new ServiceUnavailableException('External service is currently unavailable');
    }

    this.logger.error(`External service error: ${endpoint}`, error);
    throw new ServiceUnavailableException(
      `Failed to communicate with external service: ${error?.message || 'Unknown error'}`,
    );
  }
}

