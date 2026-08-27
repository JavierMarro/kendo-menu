export const primaryNavigationItems = [
  { id: 'library', label: 'Keiko library', to: '/app/library', showsCount: true },
  { id: 'dashboard', label: 'Dashboard', to: '/app/dashboard', showsCount: false },
  { id: 'create-drill', label: 'Create session', to: '/app/drills/new', showsCount: false },
] as const;
