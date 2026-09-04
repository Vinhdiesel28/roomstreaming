import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { SessionService } from "./session/session.service";
import { RoomGateway } from "./room/room.gateway";
import { RoomStore } from "./room/room.store";
import { RateLimiter } from "./room/rate-limiter";
import { YouTubeSearchService } from "./youtube/youtube-search.service";
import { VoiceRegistry } from "./voice/voice.registry";
import { LastFmRecommendationService } from "./recommendation/lastfm-recommendation.service";
import { InvidiousRecommendationService } from "./recommendation/invidious-recommendation.service";

@Module({
  controllers: [AppController],
  providers: [
    SessionService,
    RoomGateway,
    RoomStore,
    RateLimiter,
    YouTubeSearchService,
    LastFmRecommendationService,
    InvidiousRecommendationService,
    VoiceRegistry,
  ],
})
export class AppModule {}
