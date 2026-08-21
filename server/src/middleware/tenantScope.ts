// Compat shim: las rutas existentes importan desde tenantScope.
// Se redirige a workspaceScope (nuevo modelo multi-workspace).
export {
  getUserScope as getUserTenantScope,
  invalidateUserScope,
  isAdmin,
  shareWorkspace,
  belongsToWorkspace,
  activeScopeFilter,
  workspaceIdFromParam,
  type WorkspaceScope as TenantScope,
} from './workspaceScope';

import { getUserScope, shareWorkspace, type WorkspaceScope } from './workspaceScope';

/** Alias de compat: sameTenant → ¿comparten algún workspace? */
export async function sameTenant(userIdA: number, userIdB: number): Promise<boolean> {
  return shareWorkspace(userIdA, userIdB);
}

/** Compat: devolver el scope activo (para rutas que esperan el shape viejo) */
export async function getUserTenantScopeLegacy(userId: number): Promise<WorkspaceScope> {
  return getUserScope(userId);
}
