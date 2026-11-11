import type { SharedMenuV1 } from '@kendo-menu/domain/menu-sharing';
import type { DashboardEntry } from '@kendo-menu/domain';
import type { CreatedMenuShare } from './account-api';
/**
 * Carries the route owner's workspace kind, path, editability, and transition callbacks to shared
 * pages. It is UI coordination only: identity proof, persistence, and authorization remain with
 * the account and guest providers.
 */
import { createContext, useContext } from 'react';
import { matchRoutes } from 'react-router-dom';

export type WorkspaceKind = 'guest' | 'account';

export interface WorkspaceContextValue {
  readonly kind: WorkspaceKind;
  readonly basePath: '/app/guest' | '/app/account';
  readonly canEdit: boolean;
  readonly canShare?: boolean;
  readonly importSharedMenu?: (menu: SharedMenuV1, isSender: boolean) => string;
  readonly getSavedEntry?: (entryId: string) => DashboardEntry | null;
  readonly createMenuShare?: (entryId: string, signal?: AbortSignal) => Promise<CreatedMenuShare>;
  readonly accountEmail: string | null;
  readonly saveToAccount?: () => Promise<void>;
  readonly retrySave?: () => Promise<void>;
  readonly reloadAccount?: () => Promise<void>;
  readonly downloadAccountDraft?: () => void;
  readonly saveLabel?: string;
  readonly saveError?: string | null;
  readonly isDirty?: boolean;
  readonly builderDirty?: (dirty: boolean) => void;
  readonly hasUncommittedEditorDraft?: boolean;
  readonly onEditorDraftDirtyChange?: (dirty: boolean) => void;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useOptionalWorkspace(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useOptionalWorkspace();
  if (value === null) throw new Error('This page must be inside a workspace route.');
  return value;
}

export function workspacePath(
  basePath: WorkspaceContextValue['basePath'],
  page: 'dashboard' | 'library' | 'drills/new' | `drills/${string}/edit` | `library/${string}`,
): string {
  return `${basePath}/${page}`;
}

export const workspaceBuilderPaths = {
  create: 'drills/new',
  edit: 'drills/:entryId/edit',
} as const;

export function isWorkspaceBuilderPath(
  basePath: WorkspaceContextValue['basePath'],
  pathname: string,
): boolean {
  return (
    matchRoutes(
      [
        { path: workspacePath(basePath, workspaceBuilderPaths.create) },
        { path: workspacePath(basePath, workspaceBuilderPaths.edit) },
      ],
      pathname,
    ) !== null
  );
}
