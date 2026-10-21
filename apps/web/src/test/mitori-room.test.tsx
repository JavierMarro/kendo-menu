import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MITORI_VIDEOS } from '../features/mitori/mitori-videos';
import { MITORI_SEEN_STORAGE_KEY } from '../lib/mitori-seen';
import { createTestStore, renderApp } from './test-utils';

describe('Mitori room', () => {
  it('loads only the chosen player and removes it when closed or changing sections', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), { initialEntries: ['/app/guest/mitori-room'] });
    const sections = screen.getByRole('navigation', { name: 'Mitori room sections' });
    expect(within(sections).getByRole('link', { name: 'Mitori' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(document.querySelector('iframe')).toBeNull();
    const first = screen.getByRole('button', { name: /Oikomi/ });
    await user.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/ZyJiUitoZZE',
    );
    await user.click(screen.getByRole('button', { name: /Naoki Eiga Sensei/ }));
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/sAYGaJb2aRg',
    );
    await user.click(within(sections).getByRole('link', { name: 'Kata' }));
    expect(document.querySelector('iframe')).toBeNull();
    const kata = screen.getByRole('button', { name: /Nippon Kendo Kata/ });
    await user.click(kata);
    expect(document.querySelector('iframe')).toHaveAttribute(
      'referrerpolicy',
      'strict-origin-when-cross-origin',
    );
    expect(screen.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=QIpPUdTCv-Y',
    );
    await user.click(kata);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('supports direct section links and keeps glossary search and resources inside the workspace', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), { initialEntries: ['/app/guest/mitori-room?tab=glossary'] });
    expect(screen.getByRole('heading', { name: 'Mitori room', level: 1 })).toBeVisible();
    await user.type(screen.getByRole('searchbox', { name: 'Find a term' }), 'not-a-kendo-term');
    expect(screen.getByText(/No terms match/)).toBeVisible();
    await user.click(
      within(screen.getByRole('navigation', { name: 'Mitori room sections' })).getByRole('link', {
        name: 'Resources',
      }),
    );
    expect(screen.getByRole('heading', { name: 'Resources', level: 2 })).toBeVisible();
    expect(screen.getByRole('navigation', { name: 'Workspace navigation' })).toBeVisible();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('falls back to Mitori for an unknown section', () => {
    renderApp(createTestStore(), { initialEntries: ['/app/guest/mitori-room?tab=unknown'] });
    expect(screen.getByRole('heading', { name: 'Mitori', level: 2 })).toBeVisible();
  });

  it('remembers Seen marks across video sections and lets the user clear them', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), { initialEntries: ['/app/guest/mitori-room'] });
    const sections = screen.getByRole('navigation', { name: 'Mitori room sections' });
    const firstSeen = screen.getByRole('checkbox', {
      name: /Kendo Training Boot Camp — by Hidehisa Nishimura$/,
    });
    const firstVideoId = MITORI_VIDEOS.techniques[0]?.id;
    if (firstVideoId === undefined) throw new Error('Expected a Mitori video fixture.');

    await user.click(firstSeen);
    expect(firstSeen).toBeChecked();
    expect(firstSeen.closest('.mitori-video-item')).toHaveClass('mitori-video-item--seen');
    expect(window.localStorage.getItem(MITORI_SEEN_STORAGE_KEY)).toContain(firstVideoId);

    await user.click(within(sections).getByRole('link', { name: 'Documentaries' }));
    const documentarySeen = screen.getByRole('checkbox', { name: /Naoki Eiga/ });
    await user.click(documentarySeen);
    await user.click(within(sections).getByRole('link', { name: 'Mitori' }));
    expect(
      screen.getByRole('checkbox', { name: /Kendo Training Boot Camp — by Hidehisa Nishimura$/ }),
    ).toBeChecked();
    await user.click(within(sections).getByRole('link', { name: 'Documentaries' }));
    expect(screen.getByRole('checkbox', { name: /Naoki Eiga/ })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: /Naoki Eiga/ }));
    expect(screen.getByRole('checkbox', { name: /Naoki Eiga/ })).not.toBeChecked();
    expect(screen.getByText(/stay in this browser and don’t sync/)).toBeVisible();
  });

  it('keeps marking available in memory when browser storage is unavailable', async () => {
    const user = userEvent.setup();
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Storage is unavailable.');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('Storage is unavailable.');
    });
    renderApp(createTestStore(), { initialEntries: ['/app/guest/mitori-room'] });
    const seen = screen.getByRole('checkbox', {
      name: /Kendo Training Boot Camp — by Hidehisa Nishimura$/,
    });
    await user.click(seen);
    expect(seen).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent(/last until you leave this room/);
  });

  it('opens a video series with playlist controls and omits documentary uploader credits', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), { initialEntries: ['/app/guest/mitori-room?tab=techniques'] });
    await user.click(screen.getByRole('button', { name: /ArigaToKendo/ }));
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/L3VNp4oe8kw?list=PLo-0mQzBLAedFJd50atliNPH3F7pZyLIx',
    );
    expect(screen.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=L3VNp4oe8kw&list=PLo-0mQzBLAedFJd50atliNPH3F7pZyLIx',
    );
    await user.click(screen.getByRole('link', { name: 'Documentaries' }));
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelectorAll('.mitori-video-author')).toHaveLength(0);
    const videos = screen.getAllByRole('button', { name: /Open video/ });
    expect(videos).toHaveLength(6);
    expect(videos[0]).toHaveTextContent('Naoki Eiga — A Single Blow');
    expect(screen.queryByText(/Selecting a title loads/)).not.toBeInTheDocument();
  });
});
