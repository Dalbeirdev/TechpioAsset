import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AppConfig } from './config/config.module.js';
import { applySecurityMiddleware, applyCors } from './bootstrap/security.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(AppConfig);

  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });

  // Cookie parsing + security headers, shared with the test harness so the
  // integration suite exercises the same headers production serves.
  applySecurityMiddleware(app);
  applyCors(app, config);

  app.enableShutdownHooks();

  if (!config.isProduction) {
    const swagger = new DocumentBuilder()
      .setTitle('TechpioAsset API')
      .setDescription(
        'Asset management platform API. Manage Assets. Control Costs. Simplify Operations.',
      )
      .setVersion('0.1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'access-token')
      .addTag('Health', 'Liveness and readiness probes')
      .build();
    const document = SwaggerModule.createDocument(app, swagger);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log(`API documentation at ${config.get('API_URL')}/api/docs`);
  }

  const port = config.get('API_PORT');
  await app.listen(port, '0.0.0.0');
  logger.log(`TechpioAsset API listening on port ${port} (${config.get('NODE_ENV')})`);

  if (config.get('AI_PROVIDER') === 'mock') {
    logger.warn('AI provider is MOCK - extraction results are simulated, not real.');
  }
  if (config.get('STORAGE_PROVIDER') === 'local') {
    logger.warn('Storage provider is LOCAL - files are written to the local filesystem.');
  }
}

void bootstrap();
