import pool from '../db/connection';

export type WorkspaceRole = 'admin' | 'member';

export interface WorkspaceScope {
  userId: number;
  /** workspace activo (seleccionado) */
  activeWorkspaceId: number | null;
  /** todos los workspaces a los que pertenece el usuario (N:N) */
  workspaceIds: number[];
}

const cache = new Map<number, WorkspaceScope>();

export async function getUserScope(userId: number): Promise<WorkspaceScope> {
  const cached = cache.get(userId);
  if (cached) return cached;

  const [rows] = await pool.query(
    `SELECT u.workspace_id, u.active_workspace_id,
            COALESCE(ARRAY(
              SELECT wm.workspace_id
              FROM workspace_members wm
              JOIN workspaces w ON w.id = wm.workspace_id
              WHERE wm.user_id = u.id AND w.deleted_at IS NULL
            ), '{}') AS ws_ids
       FROM users u WHERE u.id = ?`,
    [userId]
  );
  const row = (rows as any[])[0];
  if (!row) {
    return { userId, activeWorkspaceId: null, workspaceIds: [] };
  }

  let wsIds: number[] = [];
  try {
    if (Array.isArray(row.ws_ids)) wsIds = row.ws_ids.map(Number).filter((n: any) => !isNaN(n));
    else if (typeof row.ws_ids === 'string') wsIds = JSON.parse(row.ws_ids).map(Number);
  } catch {
    wsIds = [];
  }
  // Asegurar que el workspace_id directo esté incluido (compat con datos pre-migración)
  if (row.workspace_id != null && !wsIds.includes(Number(row.workspace_id))) {
    wsIds.push(Number(row.workspace_id));
  }

  const scope: WorkspaceScope = {
    userId,
    activeWorkspaceId: row.active_workspace_id != null ? Number(row.active_workspace_id) : (wsIds[0] ?? null),
    workspaceIds: wsIds,
  };
  if (!scope.activeWorkspaceId && row.workspace_id != null) {
    scope.activeWorkspaceId = Number(row.workspace_id);
  }
  cache.set(userId, scope);
  return scope;
}

export function invalidateUserScope(userId: number): void {
  cache.delete(userId);
}

/** Todos los usuarios son admin de los workspaces a los que pertenecen */
export function isAdmin(scope: WorkspaceScope): boolean {
  return scope.workspaceIds.length > 0;
}

/** ¿userB comparte al menos un workspace con userA? */
export async function shareWorkspace(userIdA: number, userIdB: number): Promise<boolean> {
  const [a, b] = await Promise.all([getUserScope(userIdA), getUserScope(userIdB)]);
  if (!a.workspaceIds.length || !b.workspaceIds.length) return false;
  return a.workspaceIds.some(id => b.workspaceIds.includes(id));
}

/** ¿el usuario pertenece al workspace dado? */
export async function belongsToWorkspace(userId: number, workspaceId: number): Promise<boolean> {
  const scope = await getUserScope(userId);
  return scope.workspaceIds.includes(workspaceId);
}

/** Scoping por workspace activo: para queries que deben aislar por el workspace seleccionado */
export function activeScopeFilter(scope: WorkspaceScope): { workspaceId: number | null } {
  return { workspaceId: scope.activeWorkspaceId };
}

export async function workspaceIdFromParam(scope: WorkspaceScope, params: { workspaceId?: string } | string): Promise<number | null> {
  let raw: string | undefined;
  if (typeof params === 'string') {
    raw = params;
  } else {
    raw = params?.workspaceId;
  }
  const id = raw ? Number(raw) : null;
  if (!id || Number.isNaN(id)) return null;
  return scope.workspaceIds.includes(id) ? id : null;
}
