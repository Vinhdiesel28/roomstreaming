import "reflect-metadata";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { NestFactory } from "@nestjs/core";
import helmet from "helmet";

function loadLocalEnvironment() {
  const candidates = [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")];
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (envPath) loadEnvFile(envPath);
}

async function bootstrap() {
  loadLocalEnvironment();
  const { AppModule } = await import("./app.module");
  const app = await NestFactory.create(AppModule, { cors: false });
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.enableCors({
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: false,
  });

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, "0.0.0.0");
  console.log(`Roomstreaming API listening on ${port}`);
}

void bootstrap();
