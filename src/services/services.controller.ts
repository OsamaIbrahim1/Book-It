import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Public, Roles } from '../common/decorators';
import {
  CreateServiceDto,
  PaginatedServicesDto,
  SearchServicesDto,
  ServiceResponseDto,
  UpdateServiceDto,
} from './dto/service.dto';
import { ServicesService } from './services.service';

@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Search services',
    description:
      'Public. Filter by text, city and price range, sort and paginate. Results are cached in Redis for 60 seconds and invalidated whenever a service changes.',
  })
  @ApiOkResponse({ type: PaginatedServicesDto })
  search(@Query() dto: SearchServicesDto) {
    return this.services.search(dto);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Get one active service' })
  @ApiOkResponse({ type: ServiceResponseDto })
  @ApiNotFoundResponse({ description: 'Service not found or inactive' })
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.services.getOne(id);
  }

  @ApiBearerAuth()
  @Roles(Role.PROVIDER)
  @Post()
  @ApiOperation({ summary: 'Create a service (provider only)' })
  @ApiCreatedResponse({ type: ServiceResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Only providers can create services' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceDto) {
    return this.services.create(user.id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.PROVIDER)
  @Patch(':id')
  @ApiOperation({ summary: 'Update one of your services (provider only)' })
  @ApiOkResponse({ type: ServiceResponseDto })
  @ApiForbiddenResponse({ description: 'The service belongs to another provider' })
  @ApiNotFoundResponse({ description: 'Service not found' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.services.update(user.id, id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.PROVIDER)
  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Deactivate one of your services (provider only)',
    description: 'Soft delete: the service is hidden but existing bookings keep their reference.',
  })
  @ApiNoContentResponse({ description: 'Service deactivated' })
  @ApiForbiddenResponse({ description: 'The service belongs to another provider' })
  @ApiNotFoundResponse({ description: 'Service not found' })
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.services.remove(user.id, id);
  }
}
