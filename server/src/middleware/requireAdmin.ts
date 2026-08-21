import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { getUserTenantScope, invalidateUserScope, TenantScope } from './tenantScope';
import type { components } from '../types/openapi';

type ErrorResponse = components['schemas']['Error'];

/**
 * Requiere ser admin del workspace activo.
 * En el modelo actual todos los miembros de un workspace son admin, así que
 * basta con que el usuario pertenezca al workspace activo.
 */
export async function requireTenantAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = await getUserTenantScope(req.userId!);
    if (scope.activeWorkspaceId == null || !scope.workspaceIds.includes(scope.activeWorkspaceId)) {
      res.status(403).json({ error: 'No perteneces al workspace activo' } satisfies ErrorResponse);
      return;
    }
    (req as any).tenantScope = scope;
    next();
  } catch {
    res.status(500).json({ error: 'Error al verificar permisos de admin' } satisfies ErrorResponse);
  }
}

export async function tenantBelongsToScope(workspaceId: number, scope: TenantScope): Promise<boolean> {
  return scope.workspaceIds.includes(workspaceId);
}

export { invalidateUserScope };
