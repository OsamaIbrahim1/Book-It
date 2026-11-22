import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

export interface AuthUser {
  id: string;
  role: Role;
}

// Routes are protected by default. Mark the few open ones with @Public().
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
