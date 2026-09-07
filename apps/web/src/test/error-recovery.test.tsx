import { Component, useState } from 'react';
import { DEFAULT_TRAINING_SETS } from '@kendo-menu/domain';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { appRoutes } from '../app/app-routes';
import { AppErrorBoundary } from '../features/errors/AppErrorBoundary';
import { ApplicationRecovery } from '../features/errors/ApplicationRecovery';
import { createErrorDiagnostics } from '../lib/error-diagnostics';
import { useTrainingStoreApi } from '../lib/training-store-context';
import * as trainingPersistence from '../lib/training-persistence';

const privateValue = 'Private menu, exercise and notes https://example.test/?share=secret#token';

function BrokenChild(): never {
  throw new Error(privateValue);
}

class BrokenLifecycle extends Component {
  override componentDidMount(): void {
    throw new Error(privateValue);
  }
  override render() {
    return <p>Mounting</p>;
  }
}

function EditThenFail() {
  const store = useTrainingStoreApi();
  const [failed, setFailed] = useState(false);
  if (failed) throw new Error(privateValue);
  return (
    <button
      onClick={() => {
        const trainingSet = DEFAULT_TRAINING_SETS[0];
        if (trainingSet === undefined) throw new Error('Missing built-in fixture.');
        const id = store.getState().addToDashboard(trainingSet.id);
        store.getState().updateDashboardEntry(id, { notes: 'Latest unsaved notes' });
        setFailed(true);
      }}
    >
      Edit then fail
    </button>
  );
}

describe('application error recovery', () => {
  it.each([<BrokenChild key="render" />, <BrokenLifecycle key="lifecycle" />])(
    'contains unexpected failures and focuses the fallback heading',
    (child) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      render(<AppErrorBoundary>{child}</AppErrorBoundary>);
      expect(screen.getByRole('heading', { name: 'KendoMenu couldn’t continue.' })).toHaveFocus();
      expect(screen.queryByText(privateValue)).not.toBeInTheDocument();
    },
  );

  it('keeps reload and recovery independent of router and storage access', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const onReload = vi.fn();
    const onRecovery = vi.fn();
    const getItem = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error(privateValue);
    });
    render(
      <AppErrorBoundary onReload={onReload} onRecovery={onRecovery}>
        <BrokenChild />
      </AppErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'Reload KendoMenu' }));
    await user.click(screen.getByRole('button', { name: 'Open data recovery' }));
    expect(onReload).toHaveBeenCalledOnce();
    expect(onRecovery).toHaveBeenCalledOnce();
    expect(getItem).not.toHaveBeenCalled();
  });

  it('copies only the diagnostic allowlist after an explicit click', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    window.localStorage.setItem('kendo-menu', privateValue);
    window.history.replaceState(null, '', '/app?share=secret#token');
    render(
      <AppErrorBoundary>
        <BrokenChild />
      </AppErrorBoundary>,
    );
    expect(writeText).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    expect(writeText).toHaveBeenCalledExactlyOnceWith(
      '{"errorCode":"KENDOMENU_UNEXPECTED_UI_ERROR","recoveryAvailable":false}',
    );
    expect(createErrorDiagnostics(true)).toBe(
      '{"errorCode":"KENDOMENU_UNEXPECTED_UI_ERROR","recoveryAvailable":true}',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Diagnostics copied.');
    window.history.replaceState(null, '', '/');
  });

  it('announces clipboard rejection without exposing the exception', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error(privateValue));
    render(
      <AppErrorBoundary>
        <BrokenChild />
      </AppErrorBoundary>,
    );
    await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Diagnostics could not be copied.');
    expect(screen.queryByText(privateValue)).not.toBeInTheDocument();
  });

  it('handles an unavailable clipboard and a failed reload action accessibly', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    try {
      render(
        <AppErrorBoundary
          onReload={() => {
            throw new Error(privateValue);
          }}
        >
          <BrokenChild />
        </AppErrorBoundary>,
      );
      await user.click(screen.getByRole('button', { name: 'Copy diagnostics' }));
      expect(screen.getByRole('alert')).toHaveTextContent('Diagnostics could not be copied.');
      await user.click(screen.getByRole('button', { name: 'Reload KendoMenu' }));
      expect(screen.getByText(/That action could not be completed/)).toHaveAttribute(
        'role',
        'alert',
      );
      expect(screen.queryByText(privateValue)).not.toBeInTheDocument();
    } finally {
      if (clipboard !== undefined) Object.defineProperty(navigator, 'clipboard', clipboard);
    }
  });

  it('routes unexpected router failures into the external boundary', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const rootRoute = appRoutes[0];
    if (rootRoute === undefined) throw new Error('Expected the root route.');
    const router = createMemoryRouter([
      { path: '/', errorElement: rootRoute.errorElement, element: <BrokenChild /> },
    ]);
    render(
      <ApplicationRecovery>
        <RouterProvider router={router} />
      </ApplicationRecovery>,
    );
    expect(screen.getByRole('heading', { name: 'KendoMenu couldn’t continue.' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Open data recovery' })).toBeEnabled();
  });

  it('keeps the live store available for backup after a write failure and render failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    const download = vi
      .spyOn(trainingPersistence, 'downloadCurrentTrainingBackup')
      .mockImplementation(() => undefined);
    render(
      <ApplicationRecovery>
        <EditThenFail />
      </ApplicationRecovery>,
    );
    await user.click(screen.getByRole('button', { name: 'Edit then fail' }));
    await user.click(screen.getByRole('button', { name: 'Open data recovery' }));
    await user.click(screen.getByRole('button', { name: 'Download current backup' }));
    expect(download).toHaveBeenCalledWith([
      expect.objectContaining({ notes: 'Latest unsaved notes' }),
    ]);
  });

  it('opens existing recovery from a failed session without router or storage access', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <ApplicationRecovery>
        <BrokenChild />
      </ApplicationRecovery>,
    );
    await user.click(screen.getByRole('button', { name: 'Continue without saving' }));
    expect(screen.getByRole('heading', { name: 'KendoMenu couldn’t continue.' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open data recovery' }));
    expect(
      screen.getByRole('heading', { name: 'KendoMenu cannot access local data.' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Continue without saving' })).toBeEnabled();
  });
});
