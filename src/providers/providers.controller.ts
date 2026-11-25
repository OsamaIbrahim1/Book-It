import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { AuthUser, CurrentUser, Public, Roles } from '../common/decorators';
import {
  ProviderProfileDto,
  PublicProviderDto,
  SetAvailabilityDto,
  SlotsQueryDto,
  SlotsResponseDto,
  UpdateProviderDto,
} from './dto/provider.dto';
import { ProvidersService } from './providers.service';

// Routes under /providers/me are declared before /providers/:id so "me" is never read as an id.
@ApiTags('providers')
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @ApiBearerAuth()
  @Roles(Role.PROVIDER)
  @Get('me')
  @ApiOperation({ summary: 'My provider profile' })
  @ApiOkResponse({ type: ProviderProfileDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
  @ApiForbiddenResponse({ description: 'Only providers have a provider profile' })
  getMine(@CurrentUser() user: AuthUser) {
    return this.providers.getMine(user.id);
  }

  @ApiBearerAuth()
  @Roles(Role.PROVIDER)
  @Patch('me')
  @ApiOperation({ summary: 'Update my profile (bio, city, time zone)' })
  @ApiOkResponse({ type: ProviderProfileDto })
  @ApiBadRequestResponse({ description: 'Invalid time zone' })
  updateMine(@CurrentUser() user: AuthUser, @Body() dto: UpdateProviderDto) {
    return this.providers.updateMine(user.id, dto);
  }

  @ApiBearerAuth()
  @Roles(Role.PROVIDER)
  @Get('me/availability')
  @ApiOperation({ summary: 'My weekly availability' })
  @ApiOkResponse({ type: SetAvailabilityDto })
  getMyAvailability(@CurrentUser() user: AuthUser) {
    return this.providers.getMyAvailability(user.id);
  }

  @ApiBearerAuth()
  @Roles(Role.PROVIDER)
  @Put('me/availability')
  @ApiOperation({
    summary: 'Replace my weekly availability',
    description:
      'Sends the complete schedule. Days are 0 (Sunday) to 6 (Saturday), times are minutes since midnight in your time zone.',
  })
  @ApiOkResponse({ type: SetAvailabilityDto })
  @ApiBadRequestResponse({ description: 'A window ends before it starts, or windows overlap' })
  setMyAvailability(@CurrentUser() user: AuthUser, @Body() dto: SetAvailabilityDto) {
    return this.providers.setMyAvailability(user.id, dto);
  }

  @Public()
  @Get(':id')
  @ApiOperation({ summary: 'Public provider profile with active services' })
  @ApiOkResponse({ type: PublicProviderDto })
  @ApiNotFoundResponse({ description: 'Provider not found' })
  getPublic(@Param('id', ParseUUIDPipe) id: string) {
    return this.providers.getPublic(id);
  }

  @Public()
  @Get(':id/slots')
  @ApiOperation({
    summary: 'Free booking slots for one day',
    description:
      'Slots are generated from the provider weekly availability, sized by the service duration, and exclude past times and times already booked.',
  })
  @ApiOkResponse({ type: SlotsResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid date, or more than 90 days ahead' })
  @ApiNotFoundResponse({ description: 'Provider or service not found' })
  slots(@Param('id', ParseUUIDPipe) id: string, @Query() query: SlotsQueryDto) {
    return this.providers.slots(id, query);
  }
}
