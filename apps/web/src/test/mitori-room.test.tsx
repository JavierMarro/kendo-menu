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
    expect(within(sections).getByRole('link', { name: 'General' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(sections)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['General', 'Competitions', 'Documentaries', 'Kata', 'Resources', 'Glossary']);
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

  it('falls back to General for an unknown section', () => {
    renderApp(createTestStore(), { initialEntries: ['/app/guest/mitori-room?tab=unknown'] });
    expect(screen.getByRole('heading', { name: 'General', level: 2 })).toBeVisible();
  });

  it('remembers Seen marks across video sections and lets the user clear them', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), { initialEntries: ['/app/guest/mitori-room'] });
    const sections = screen.getByRole('navigation', { name: 'Mitori room sections' });
    const firstSeen = screen.getByRole('checkbox', {
      name: /Naoki Eiga Sensei’s Training at Home/,
    });
    const firstVideoId = MITORI_VIDEOS.techniques[0]?.id;
    if (firstVideoId === undefined) throw new Error('Expected a Mitori video fixture.');

    await user.click(firstSeen);
    expect(firstSeen).toBeChecked();
    expect(firstSeen).not.toHaveAttribute('aria-describedby');
    expect(firstSeen.closest('.mitori-video-item')).toHaveClass('mitori-video-item--seen');
    expect(window.localStorage.getItem(MITORI_SEEN_STORAGE_KEY)).toContain(firstVideoId);

    await user.click(within(sections).getByRole('link', { name: 'Documentaries' }));
    const documentarySeen = screen.getByRole('checkbox', {
      name: /Naoki Eiga — A Single Blow/,
    });
    await user.click(documentarySeen);
    await user.click(within(sections).getByRole('link', { name: 'General' }));
    expect(
      screen.getByRole('checkbox', { name: /Naoki Eiga Sensei’s Training at Home/ }),
    ).toBeChecked();
    await user.click(within(sections).getByRole('link', { name: 'Competitions' }));
    expect(screen.getByRole('checkbox', { name: /90th Waseda–Keio Kendo Match/ })).toBeVisible();
    expect(
      screen.queryByRole('checkbox', { name: /Naoki Eiga Sensei’s Training at Home/ }),
    ).not.toBeInTheDocument();
    await user.click(within(sections).getByRole('link', { name: 'Documentaries' }));
    expect(screen.getByRole('checkbox', { name: /Naoki Eiga — A Single Blow/ })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: /Naoki Eiga — A Single Blow/ }));
    expect(screen.getByRole('checkbox', { name: /Naoki Eiga — A Single Blow/ })).not.toBeChecked();
    expect(screen.queryByText(/stay in this browser and don’t sync/)).not.toBeInTheDocument();
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
      'https://www.youtube-nocookie.com/embed/videoseries?list=PLo-0mQzBLAedFJd50atliNPH3F7pZyLIx',
    );
    expect(screen.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/playlist?list=PLo-0mQzBLAedFJd50atliNPH3F7pZyLIx',
    );
    await user.click(screen.getByRole('link', { name: 'Documentaries' }));
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelectorAll('.mitori-video-author')).toHaveLength(0);
    const videos = screen.getAllByRole('button', { name: /Open video/ });
    expect(videos).toHaveLength(MITORI_VIDEOS.documentaries.length);
    expect(screen.getByRole('button', { name: /Naoki Eiga — A Single Blow/ })).toBeVisible();
    expect(screen.queryByText(/Selecting a title loads/)).not.toBeInTheDocument();
  });

  it('opens the requested competition collection from a direct URL and falls back for an unknown collection', async () => {
    const user = userEvent.setup();
    const app = renderApp(createTestStore(), {
      initialEntries: ['/app/guest/mitori-room?tab=competitions&collection=ajkc-finals'],
    });
    const collections = screen.getByRole('navigation', { name: 'Competition collections' });
    expect(within(collections).getByRole('link', { name: 'AJKC finals (mens)' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getAllByRole('button', { name: /Open video/ })).toHaveLength(
      MITORI_VIDEOS['ajkc-finals'].length,
    );
    await user.click(within(collections).getByRole('link', { name: '2026' }));
    expect(within(collections).getByRole('link', { name: '2026' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getAllByRole('button', { name: /Open video|Open series/ })).toHaveLength(
      MITORI_VIDEOS['competition-2026'].length,
    );
    expect(screen.getByRole('button', { name: /74th All Japan University Kendo/ })).toBeVisible();

    app.unmount();
    renderApp(createTestStore(), {
      initialEntries: ['/app/guest/mitori-room?tab=competitions&collection=unknown'],
    });
    expect(screen.getByRole('link', { name: '2026' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getAllByRole('button', { name: /Open video|Open series/ })).toHaveLength(
      MITORI_VIDEOS['competition-2026'].length,
    );
    expect(screen.getByRole('button', { name: /74th All Japan University Kendo/ })).toBeVisible();
  });

  it('clears an open player when changing competition collections and opens playlist-only entries', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), {
      initialEntries: ['/app/guest/mitori-room?tab=competitions&collection=2026'],
    });
    const firstVideo = screen.getByRole('button', { name: /74th All Japan University Kendo/ });
    await user.click(firstVideo);
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/shOjcAsUZ5M',
    );
    const collections = screen.getByRole('navigation', { name: 'Competition collections' });
    await user.click(within(collections).getByRole('link', { name: 'AJKC finals (mens)' }));
    expect(document.querySelector('iframe')).toBeNull();

    await user.click(within(collections).getByRole('link', { name: '2026' }));
    await user.click(screen.getByRole('button', { name: /68th All Japan Corporate Kendo/ }));
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/videoseries?list=PLTj3ptu6HjME',
    );
    expect(screen.getByRole('link', { name: 'Watch on YouTube' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/playlist?list=PLTj3ptu6HjME',
    );
  });

  it('opens women’s finals directly and retains Seen marks when switching collections', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), {
      initialEntries: ['/app/guest/mitori-room?tab=competitions&collection=ajkc-finals-womens'],
    });
    const collections = screen.getByRole('navigation', { name: 'Competition collections' });
    expect(
      within(collections)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['2026', 'AJKC finals (mens)', 'AJKC finals (womens)']);
    const womens = within(collections).getByRole('link', { name: 'AJKC finals (womens)' });
    expect(womens).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('checkbox', { name: /64th All Japan Women’s/ }));
    await user.click(screen.getByRole('button', { name: /64th All Japan Women’s/ }));
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/xWwnza7khAE',
    );
    await user.click(within(collections).getByRole('link', { name: 'AJKC finals (mens)' }));
    expect(document.querySelector('iframe')).toBeNull();
    await user.click(womens);
    expect(screen.getByRole('checkbox', { name: /64th All Japan Women’s/ })).toBeChecked();
    expect(window.localStorage.getItem(MITORI_SEEN_STORAGE_KEY)).toContain('xWwnza7khAE');
  });

  it('keeps the supplied video order in General and all competition collections', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), { initialEntries: ['/app/guest/mitori-room'] });
    const titles = (): (string | null)[] =>
      screen
        .getAllByRole('button', { name: /Open video|Open series/ })
        .map((button) => button.querySelector('.mitori-video-title')?.textContent ?? null);

    expect(titles()).toEqual(MITORI_VIDEOS.techniques.map((video) => video.title));

    await user.click(screen.getByRole('link', { name: 'Competitions' }));
    expect(titles()).toEqual(MITORI_VIDEOS['competition-2026'].map((video) => video.title));

    await user.click(screen.getByRole('link', { name: 'AJKC finals (mens)' }));
    expect(titles()).toEqual(MITORI_VIDEOS['ajkc-finals'].map((video) => video.title));

    await user.click(screen.getByRole('link', { name: 'AJKC finals (womens)' }));
    expect(titles()).toEqual(MITORI_VIDEOS['ajkc-finals-womens'].map((video) => video.title));
  });
});
