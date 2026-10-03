import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AdoptionDialog } from './AdoptionDialog';

describe('guest adoption choice dialog', () => {
  it('traps focus, ignores Escape and backdrop dismissal, and reports the selected choice', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onRetry = vi.fn();
    render(
      <AdoptionDialog
        state={{ status: 'offer', entryCount: 2 }}
        onChoose={onChoose}
        onRetry={onRetry}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Copy your guest menus to your account' });
    const yes = screen.getByRole('button', { name: 'Yes, copy menus' });
    const no = screen.getByRole('button', { name: 'No, keep dashboards separate' });
    expect(yes).toHaveFocus();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Your guest dashboard has 2 entries.')).toBeVisible();

    await user.tab({ shift: true });
    expect(no).toHaveFocus();
    await user.tab();
    expect(yes).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const backdrop = document.querySelector('.adoption-dialog-backdrop');
    if (!(backdrop instanceof HTMLElement)) throw new Error('Expected adoption backdrop');
    fireEvent.click(backdrop);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(no);
    expect(onChoose).toHaveBeenCalledExactlyOnceWith('no');
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('traps focus during submission and leaves only a retry for a saved pending decision', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onRetry = vi.fn();
    const view = render(
      <AdoptionDialog
        state={{ status: 'submitting', decision: 'yes' }}
        onChoose={onChoose}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saving your choice');
    const submittingDialog = screen.getByRole('dialog');
    expect(submittingDialog).toHaveFocus();
    await user.tab();
    expect(submittingDialog).toHaveFocus();
    await user.tab({ shift: true });
    expect(submittingDialog).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Yes, copy menus' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'No, keep dashboards separate' }),
    ).not.toBeInTheDocument();

    view.rerender(
      <AdoptionDialog
        state={{ status: 'retryable', decision: 'yes' }}
        onChoose={onChoose}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Your choice is saved for recovery');
    expect(screen.getByRole('button', { name: 'Retry saved choice' })).toHaveFocus();
    expect(
      screen.queryByRole('button', { name: 'No, keep dashboards separate' }),
    ).not.toBeInTheDocument();
  });

  it('isolates the app from assistive technology and restores its previous attributes exactly', () => {
    const appRoot = document.createElement('div');
    appRoot.id = 'root';
    appRoot.setAttribute('inert', 'previous-inert');
    appRoot.setAttribute('aria-hidden', 'false');
    appRoot.textContent = 'Application content';
    document.body.prepend(appRoot);

    const view = render(
      <AdoptionDialog
        state={{ status: 'offer', entryCount: 1 }}
        onChoose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    try {
      expect(appRoot).toHaveAttribute('inert', '');
      expect(appRoot).toHaveAttribute('aria-hidden', 'true');
      const dialog = screen.getByRole('dialog', { name: 'Copy your guest menus to your account' });
      expect(appRoot.contains(dialog)).toBe(false);
      expect(dialog).toBeInTheDocument();
    } finally {
      view.unmount();
      appRoot.remove();
    }

    expect(appRoot).toHaveAttribute('inert', 'previous-inert');
    expect(appRoot).toHaveAttribute('aria-hidden', 'false');
  });

  it('removes isolation attributes it added when the app had none before the dialog', () => {
    const appRoot = document.createElement('div');
    appRoot.id = 'root';
    document.body.prepend(appRoot);
    const view = render(
      <AdoptionDialog
        state={{ status: 'offer', entryCount: 1 }}
        onChoose={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(appRoot).toHaveAttribute('inert');
    expect(appRoot).toHaveAttribute('aria-hidden', 'true');
    view.unmount();
    expect(appRoot).not.toHaveAttribute('inert');
    expect(appRoot).not.toHaveAttribute('aria-hidden');
    appRoot.remove();
  });
});
