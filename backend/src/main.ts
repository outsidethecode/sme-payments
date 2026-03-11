import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: true,
  });

  // Increase JSON body limit for large evidence packs
  // (default 100 KB is too small for multi-event packs)
  const expressApp = app.getHttpAdapter().getInstance();
  const bodyParser = require("body-parser");
  expressApp.use(bodyParser.json({ limit: "5mb" }));

  // Security headers
  app.use(helmet());

  // Global prefix
  app.setGlobalPrefix("api");

  // CORS — origins from env, no hardcoded values
  const allowedOrigins = (process.env.WEBAUTHN_ORIGIN || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger
  const config = new DocumentBuilder()
    .setTitle("Programmable SME Settlement API")
    .setDescription(
      "Event-Driven B2B Payments with Embedded Liquidity and Verifiable Digital Trust",
    )
    .setVersion("0.1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  const port = process.env.BACKEND_PORT || 3001;
  await app.listen(port);
  console.log(`🚀 Backend running on http://localhost:${port}`);
  console.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
}
bootstrap();
