import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

/**
 * Redis-backed challenge store for WebAuthn.
 * Replaces the in-memory Map that was lost on restart.
 * Each challenge is stored with a TTL so it auto-expires.
 */
@Injectable()
export class RedisChallengeStore implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly logger = new Logger(RedisChallengeStore.name);
  private readonly prefix = "webauthn:challenge:";
  private readonly ttlSeconds: number;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>("REDIS_HOST", "localhost");
    const port = this.config.get<number>("REDIS_PORT", 6379);
    this.ttlSeconds = this.config.get<number>(
      "WEBAUTHN_CHALLENGE_TTL_SECONDS",
      300,
    ); // 5 minutes

    this.redis = new Redis({
      host,
      port,
      keyPrefix: this.prefix,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      lazyConnect: true,
    });

    this.redis.connect().catch((err) => {
      this.logger.warn(
        `Redis challenge store connection failed, falling back to in-memory: ${err.message}`,
      );
    });

    this.redis.on("error", (err) => {
      this.logger.warn(`Redis challenge store error: ${err.message}`);
    });
  }

  /**
   * Store a challenge for a given key (e.g. "userId:purpose").
   */
  async set(key: string, challenge: string): Promise<void> {
    try {
      if (this.redis.status === "ready") {
        await this.redis.set(key, challenge, "EX", this.ttlSeconds);
        return;
      }
    } catch {
      // fall through to in-memory
    }
    // Fallback: in-memory (for tests or Redis down)
    this.fallbackStore.set(key, {
      challenge,
      expiresAt: Date.now() + this.ttlSeconds * 1000,
    });
  }

  /**
   * Retrieve and delete a challenge (one-time use).
   */
  async getAndDelete(key: string): Promise<string | null> {
    try {
      if (this.redis.status === "ready") {
        const val = await this.redis.get(key);
        if (val) {
          await this.redis.del(key);
        }
        return val;
      }
    } catch {
      // fall through to in-memory
    }
    // Fallback
    const stored = this.fallbackStore.get(key);
    this.fallbackStore.delete(key);
    if (!stored || Date.now() > stored.expiresAt) return null;
    return stored.challenge;
  }

  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch {
      // ignore
    }
  }

  // In-memory fallback (for tests or when Redis is unavailable)
  private fallbackStore = new Map<
    string,
    { challenge: string; expiresAt: number }
  >();
}
