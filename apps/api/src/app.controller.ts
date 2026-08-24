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
    return {
      ok: true,
      rooms: this.rooms.size,
      features: {
        profiles: true,
        roomRecovery: true,
        youtubeSimilar: true,
        musicRecommendations: Boolean(process.env.LASTFM_API_KEY?.trim()),
      },
      revision: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "local",
      now: Date.now(),
    };
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

  @Get("api/youtube/similar")
  async similarYouTube(
    @Query("videoId") input: unknown,
    @Query("context") contextInput: unknown,
    @Query("exclude") excludeInput: unknown,
    @Ip() ip: string,
  ) {
    const videoId = typeof input === "string" ? input.trim() : "";
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      throw new BadRequestException("Video YouTube không hợp lệ.");
    }
    const contextVideoIds = parseVideoIdList(contextInput, 4).filter((id) => id !== videoId);
    const excludedVideoIds = parseVideoIdList(excludeInput, 20);
    if (!this.limiter.allow(`youtube-similar:${ip}`, 5, 60_000)) {
      throw new HttpException(
        "Bạn đang lấy gợi ý quá nhanh. Chờ một phút rồi thử lại.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      return {
        items: await this.youtubeSearch.similar(videoId, contextVideoIds, excludedVideoIds),
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : "YOUTUBE_SEARCH_UNAVAILABLE";
      if (code === "YOUTUBE_API_KEY_MISSING") {
        throw new ServiceUnavailableException(
          "Gợi ý video chưa được cấu hình. Chủ web cần đặt YOUTUBE_API_KEY trên backend.",
        );
      }
      if (code === "YOUTUBE_VIDEO_NOT_FOUND") {
        throw new BadRequestException("Không tìm thấy thông tin video đang phát.");
      }
      if (code === "YOUTUBE_SEARCH_QUOTA") {
        throw new HttpException(
          "Hôm nay đã hết lượt gợi ý YouTube miễn phí. Bạn vẫn có thể tự tìm hoặc dán link.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new ServiceUnavailableException(
        "YouTube đang không phản hồi gợi ý. Bạn vẫn có thể tự tìm hoặc dán link.",
      );
    }
  }
}

function parseVideoIdList(input: unknown, limit: number) {
  if (typeof input !== "string") return [];
  const seen = new Set<string>();
  return input.split(",").flatMap((value) => {
    const videoId = value.trim();
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || seen.has(videoId) || seen.size >= limit) return [];
    seen.add(videoId);
    return [videoId];
  });
}
