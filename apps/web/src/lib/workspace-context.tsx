import { createContext, useContext, type ReactNode } from 'react';

export type WorkspaceKind = 'guest' | 'account';

export interface WorkspaceContextValue {
  readonly kind: WorkspaceKind;
  readonly basePath: '/app/guest' | '/app/account';
  readonly canEdit: boolean;
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

export function WorkspaceContextProvider({
  value,
  children,
}: {
  readonly value: WorkspaceContextValue;
  readonly children: ReactNode;
}) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function workspacePath(
  basePath: WorkspaceContextValue['basePath'],
  page: 'dashboard' | 'library' | 'drills/new' | `library/${string}`,
): string {
  return `${basePath}/${page}`;
}
