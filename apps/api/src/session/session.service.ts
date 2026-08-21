import { Injectable } from "@nestjs/common";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

interface SessionPayload {
  sessionId: string;
  token: string;
  expiresAt: number;
}

@Injectable()
export class SessionService {
  private readonly secret =
    process.env.SESSION_SECRET ?? "local-development-secret-change-before-deploy";

  create(): SessionPayload {
    const sessionId = randomUUID();
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000;
    return { sessionId, expiresAt, token: this.sign(sessionId, expiresAt) };
  }

  verify(token: unknown): string | null {
    if (typeof token !== "string") return null;
    const [sessionId, expiresAtRaw, signature] = token.split(".");
    if (!sessionId || !expiresAtRaw || !signature) return null;
    const expiresAt = Number(expiresAtRaw);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

    const expected = this.signature(sessionId, expiresAt);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length) return null;
    return timingSafeEqual(actualBuffer, expectedBuffer) ? sessionId : null;
  }

  private sign(sessionId: string, expiresAt: number) {
    return `${sessionId}.${expiresAt}.${this.signature(sessionId, expiresAt)}`;
  }

  private signature(sessionId: string, expiresAt: number) {
    return createHmac("sha256", this.secret)
      .update(`${sessionId}.${expiresAt}`)
      .digest("base64url");
  }
}
