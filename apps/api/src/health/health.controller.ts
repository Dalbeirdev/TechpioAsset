import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthResponse } from '@techpioasset/contracts';
import { HealthService } from './health.service.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({
    summary: 'Liveness probe',
    description: 'Returns ok while the process is running. Checks no dependencies.',
  })
  @ApiOkResponse({ description: 'The process is alive.' })
  live(): { status: 'ok'; uptimeSeconds: number } {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Reports database, cache and external-provider status. Providers running in ' +
      'mock mode report "mocked" so simulated dependencies are never mistaken for real ones.',
  })
  @ApiOkResponse({ description: 'Dependency report.' })
  ready(): Promise<HealthResponse> {
    return this.health.readiness();
  }
}
