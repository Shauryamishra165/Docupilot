import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import Redis from 'ioredis';
import { EnvironmentService } from '../environment/environment.service';

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly inMemoryStore = new Map<string, { count: number; resetAt: number }>();
  private redis: Redis | null = null;

  constructor(private readonly environmentService: EnvironmentService) {
    // Try to create Redis client, but allow service to work without it
    try {
      const redisUrl = this.environmentService.getRedisUrl();
      if (redisUrl) {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          retryStrategy: () => null, // Don't retry on connection failure
        });
        this.redis.on('error', (err) => {
          this.logger.warn('Redis connection error, falling back to in-memory rate limiting', err);
          this.redis = null;
        });
      }
    } catch (error) {
      this.logger.warn('Redis not available, using in-memory rate limiting');
      this.redis = null;
    }
  }

  /**
   * Check rate limit for AI chat requests
   * @param userId User ID
   * @param workspaceId Workspace ID
   * @param limit Maximum requests per window
   * @param windowMs Time window in milliseconds
   * @returns true if allowed, throws TooManyRequestsException if exceeded
   */
  async checkRateLimit(
    userId: string,
    workspaceId: string,
    limit: number = 30, // 30 requests
    windowMs: number = 60000, // per minute
  ): Promise<boolean> {
    const key = `ai-chat:${workspaceId}:${userId}`;
    const now = Date.now();

    try {
      if (this.redis && this.redis.status === 'ready') {
        // Use Redis for distributed rate limiting
        const count = await this.redis.incr(key);
        
        if (count === 1) {
          // Set expiration on first request
          await this.redis.expire(key, Math.ceil(windowMs / 1000));
        }

        if (count > limit) {
          const ttl = await this.redis.ttl(key);
          this.logger.warn(
            `Rate limit exceeded for user ${userId} in workspace ${workspaceId}. Retry after ${ttl}s`,
          );
          throw new HttpException(
            `Rate limit exceeded. Please try again in ${ttl} seconds.`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        return true;
      } else {
        // Fallback to in-memory rate limiting
        const record = this.inMemoryStore.get(key);

        if (!record || now > record.resetAt) {
          // Reset or create new record
          this.inMemoryStore.set(key, {
            count: 1,
            resetAt: now + windowMs,
          });
          return true;
        }

        if (record.count >= limit) {
          const retryAfter = Math.ceil((record.resetAt - now) / 1000);
          this.logger.warn(
            `Rate limit exceeded for user ${userId} in workspace ${workspaceId}. Retry after ${retryAfter}s`,
          );
          throw new HttpException(
            `Rate limit exceeded. Please try again in ${retryAfter} seconds.`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        record.count++;
        return true;
      }
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
        throw error;
      }
      // If Redis fails, allow the request but log the error
      this.logger.error('Rate limiter error, allowing request', error);
      return true;
    }
  }

  /**
   * Clean up expired in-memory entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.inMemoryStore.entries()) {
      if (now > record.resetAt) {
        this.inMemoryStore.delete(key);
      }
    }
  }
}

