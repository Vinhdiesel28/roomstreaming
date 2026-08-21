import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Ip,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { SessionService } from "./session/session.service";
import { RoomStore } from "./room/room.store";
import { RateLimiter } from "./room/rate-limiter";
import { YouTubeSearchService } from "./youtube/youtube-search.service";

@Controller()
export class AppController {
  constructor(
    @Inject(SessionService)
    private readonly sessions: SessionService,
    @Inject(RoomStore)
    private readonly rooms: RoomStore,
    @Inject(RateLimiter)
    private readonly limiter: RateLimiter,
    @Inject(YouTubeSearchService)
    private readonly youtubeSearch: YouTubeSearchService,
  ) {}

  @Get("health")
  health() {
    return { ok: true, rooms: this.rooms.size, now: Date.now() };
  }

  @Post("api/session")
  createSession() {
    return this.sessions.create();
  }

  @Get("api/youtube/search")
  async searchYouTube(@Query("q") input: unknown, @Ip() ip: string) {
    const query = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
    if (query.length < 2 || query.length > 100) {
      throw new BadRequestException("Từ khóa tìm kiếm cần từ 2 đến 100 ký tự.");
    }
    if (!this.limiter.allow(`youtube-search:${ip}`, 10, 60_000)) {
      throw new HttpException("Bạn tìm kiếm quá nhanh. Chờ một phút rồi thử lại.", HttpStatus.TOO_MANY_REQUESTS);
    }

    try {
      return { items: await this.youtubeSearch.search(query) };
    } catch (error) {
      const code = error instanceof Error ? error.message : "YOUTUBE_SEARCH_UNAVAILABLE";
      if (code === "YOUTUBE_API_KEY_MISSING") {
        throw new ServiceUnavailableException(
          "Tìm kiếm chưa được cấu hình. Chủ web cần đặt YOUTUBE_API_KEY trên backend.",
        );
      }
      if (code === "YOUTUBE_SEARCH_QUOTA") {
        throw new HttpException(
          "Hôm nay đã hết lượt tìm kiếm YouTube miễn phí. Bạn vẫn có thể dán link video.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new ServiceUnavailableException(
        "YouTube đang không phản hồi tìm kiếm. Bạn vẫn có thể dán link video.",
      );
    }
  }
}
