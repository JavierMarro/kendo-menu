export const primaryNavigationItems = [
  { id: 'library', label: 'Drill library', to: '/app/library', showsCount: true },
  { id: 'dashboard', label: 'Dashboard', to: '/app/dashboard', showsCount: false },
  { id: 'create-drill', label: 'Create drill', to: '/app/drills/new', showsCount: false },
] as const;
