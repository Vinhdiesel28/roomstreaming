import { Injectable } from "@nestjs/common";

interface WindowCounter {
  count: number;
  resetsAt: number;
}

@Injectable()
export class RateLimiter {
  private readonly counters = new Map<string, WindowCounter>();

  allow(key: string, limit: number, windowMs: number) {
    const now = Date.now();
    const current = this.counters.get(key);
    if (!current || current.resetsAt <= now) {
      this.counters.set(key, { count: 1, resetsAt: now + windowMs });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }
}
