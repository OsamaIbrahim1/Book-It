import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Redis } from 'ioredis';

// Cache-aside helper. Redis is an optimization, never a dependency:
// if Redis is down, every call falls back to the loader and the API keeps working.
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private down = false;

  constructor(config: ConfigService) {
    this.client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 1,
      // Fail fast instead of queueing commands while disconnected.
      enableOfflineQueue: false,
      retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
    });

    // Log the outage once, not on every reconnect attempt.
    this.client.on('error', (err) => {
      if (!this.down) this.logger.warn(`Redis unavailable, caching disabled: ${err.message}`);
      this.down = true;
    });
    this.client.on('ready', () => {
      if (this.down) this.logger.log('Redis reconnected, caching enabled');
      this.down = false;
    });
  }

  /**
   * Returns the cached value for (namespace, params) or runs `loader` and caches its result.
   * Keys contain a per-namespace version, so `bump(namespace)` invalidates every entry at once.
   */
  async cached<T>(
    namespace: string,
    params: Record<string, unknown>,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    let key: string | null = null;
    try {
      const version = (await this.client.get(`${namespace}:version`)) ?? '0';
      const digest = createHash('sha1').update(JSON.stringify(params)).digest('hex');
      key = `${namespace}:v${version}:${digest}`;
      const hit = await this.client.get(key);
      if (hit !== null) return JSON.parse(hit) as T;
    } catch {
      key = null; // cache unavailable: just load from the database
    }

    const value = await loader();

    if (key) {
      try {
        await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      } catch {
        // ignore: the next request will simply miss
      }
    }
    return value;
  }

  // Invalidates all cached entries of a namespace by moving to a new version.
  async bump(namespace: string): Promise<void> {
    try {
      await this.client.incr(`${namespace}:version`);
    } catch {
      // ignore: entries expire by TTL anyway
    }
  }

  onModuleDestroy() {
    this.client.disconnect();
  }
}
