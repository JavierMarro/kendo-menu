import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ServiceWorkerUpdateNotice } from './ServiceWorkerUpdateNotice';

describe('service worker update notice', () => {
  it('keeps a failed update retryable', async () => {
    const user = userEvent.setup();
    const onUpdate = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Update failed'))
      .mockResolvedValue(undefined);
    render(<ServiceWorkerUpdateNotice onUpdate={onUpdate} onLater={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(screen.getByRole('region')).toHaveTextContent('The update could not start');
    await user.click(screen.getByRole('button', { name: 'Update' }));
    expect(screen.getByRole('region')).not.toHaveTextContent('The update could not start');
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('offers an update and a way to defer it', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const onLater = vi.fn();
    render(<ServiceWorkerUpdateNotice onUpdate={onUpdate} onLater={onLater} />);

    expect(screen.getByRole('region', { name: 'Update available' })).toHaveTextContent(
      'Save any changes before updating',
    );
    await user.click(screen.getByRole('button', { name: 'Later' }));
    await user.click(screen.getByRole('button', { name: 'Update' }));

    expect(onLater).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledOnce();
  });
});
