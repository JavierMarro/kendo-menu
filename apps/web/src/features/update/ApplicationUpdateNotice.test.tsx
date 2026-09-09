import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RegisterSWOptions } from 'vite-plugin-pwa/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pwaModule = vi.hoisted(() => ({ useRegisterSW: vi.fn() }));
const reloadModule = vi.hoisted(() => ({ reloadApplication: vi.fn() }));

vi.mock('virtual:pwa-register/react', () => pwaModule);
vi.mock('../../lib/application-reload', () => reloadModule);

import { ApplicationUpdateNotice } from './ApplicationUpdateNotice';

interface MockPwaState {
  needRefresh: boolean;
  updateServiceWorker: () => Promise<void>;
}

let pwaState: MockPwaState;
let registerOptions: RegisterSWOptions | undefined;

function useMockRegisterSW(options: RegisterSWOptions = {}) {
  const [needRefresh, setNeedRefresh] = useState(pwaState.needRefresh);
  useEffect(() => {
    registerOptions = options;
  }, [options]);

  return {
    needRefresh: [needRefresh, setNeedRefresh] as [boolean, Dispatch<SetStateAction<boolean>>],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: pwaState.updateServiceWorker,
  };
}

function renderNotice(): void {
  render(<ApplicationUpdateNotice />);
}

describe('application update notice', () => {
  beforeEach(() => {
    registerOptions = undefined;
    const updateServiceWorker = vi.fn<() => Promise<void>>(() => Promise.resolve());
    pwaState = {
      needRefresh: false,
      updateServiceWorker,
    };
    pwaModule.useRegisterSW.mockReset();
    pwaModule.useRegisterSW.mockImplementation(useMockRegisterSW);
    reloadModule.reloadApplication.mockReset();
  });

  it('does not render update actions when no update is available', () => {
    renderNotice();

    expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Later' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('announces an available update and keeps both actions keyboard accessible', async () => {
    const user = userEvent.setup();
    pwaState.needRefresh = true;
    renderNotice();

    const notice = screen.getByRole('complementary', { name: 'Application update' });
    expect(notice).toHaveTextContent('A new version of KendoMenu is available.');
    expect(notice).toHaveTextContent(
      'Updating reloads this page. Save any unfinished session work first.',
    );

    const update = screen.getByRole('button', { name: 'Update now' });
    const later = screen.getByRole('button', { name: 'Later' });
    update.focus();
    await user.tab();
    expect(later).toHaveFocus();
  });

  it('dismisses with Later without activating or reloading the worker', async () => {
    const user = userEvent.setup();
    pwaState.needRefresh = true;
    renderNotice();

    await user.click(screen.getByRole('button', { name: 'Later' }));

    expect(screen.queryByRole('button', { name: 'Update now' })).not.toBeInTheDocument();
    expect(pwaState.updateServiceWorker).not.toHaveBeenCalled();
    expect(reloadModule.reloadApplication).not.toHaveBeenCalled();
  });

  it('activates and reloads only after explicit confirmation', async () => {
    const user = userEvent.setup();
    pwaState.needRefresh = true;
    renderNotice();

    await user.click(screen.getByRole('button', { name: 'Update now' }));
    expect(pwaState.updateServiceWorker).toHaveBeenCalledOnce();
    expect(reloadModule.reloadApplication).not.toHaveBeenCalled();

    registerOptions?.onNeedReload?.();
    expect(reloadModule.reloadApplication).toHaveBeenCalledOnce();
  });

  it('does not reload this tab when another tab activates the worker', async () => {
    const user = userEvent.setup();
    pwaState.needRefresh = true;
    renderNotice();

    await user.click(screen.getByRole('button', { name: 'Later' }));
    registerOptions?.onNeedReload?.();

    expect(reloadModule.reloadApplication).not.toHaveBeenCalled();
  });
});
