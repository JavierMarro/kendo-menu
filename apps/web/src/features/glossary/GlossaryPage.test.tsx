import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createTestStore, renderApp } from '../../test/test-utils';
import { GLOSSARY_ENTRIES, GLOSSARY_GROUP_TERMS } from './glossary-data';

describe('glossary', () => {
  it('keeps stable unique anchors and alphabetical collections', () => {
    const all = [...GLOSSARY_ENTRIES, ...GLOSSARY_GROUP_TERMS];
    expect(new Set(all.map((entry) => entry.id)).size).toBe(all.length);
    for (const entries of [GLOSSARY_ENTRIES, GLOSSARY_GROUP_TERMS]) {
      const terms = entries.map((entry) => entry.term);
      expect(terms).toEqual(
        [...terms].sort((left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' })),
      );
    }
  });
  it('renders semantic alphabetical definitions on the public route with metadata and focus', () => {
    renderApp(createTestStore(), { initialEntries: ['/app/glossary'] });
    const glossary = screen.getByRole('article', { name: 'Glossary' });
    expect(within(glossary).getByRole('heading', { level: 1 })).toHaveTextContent('Glossary');
    expect(glossary.querySelectorAll('dt')).toHaveLength(
      GLOSSARY_ENTRIES.length + GLOSSARY_GROUP_TERMS.length,
    );
    expect(glossary.querySelectorAll('dd')).toHaveLength(glossary.querySelectorAll('dt').length);
    expect(within(glossary).getByText('Kirikaeshi', { selector: 'dt' })).toBeVisible();
    expect(within(glossary).getByRole('heading', { name: 'Practice group labels' })).toBeVisible();
    const letters = within(screen.getByRole('navigation', { name: 'Glossary letters' }))
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(letters).toEqual([...letters].sort());
    expect(document.title).toBe('Glossary · KendoMenu');
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://www.kendomenu.com/app/glossary',
    );
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('filters names and spellings without accents or hyphens and recovers from no matches', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), { initialEntries: ['/app/glossary'] });
    const search = screen.getByRole('searchbox', { name: 'Find a term' });
    await user.type(search, 'KOTE MEN');
    expect(screen.getByText('Kote-men', { selector: 'dt' })).toBeVisible();
    expect(screen.queryByText('Jigeiko', { selector: 'dt' })).not.toBeInTheDocument();
    await user.clear(search);
    await user.type(search, 'zzzzzz');
    expect(screen.getByText(/No terms match/)).toBeVisible();
    expect(screen.queryAllByRole('term')).toHaveLength(0);
    await user.clear(search);
    await user.type(search, 'dō');
    expect(screen.getByText('Dō', { selector: 'dt' })).toBeVisible();
    await user.clear(search);
    expect(screen.getByText('Jigeiko', { selector: 'dt' })).toBeVisible();
  });

  it('navigates from the footer immediately after Cookies and from the experience-level FAQ', async () => {
    const user = userEvent.setup();
    renderApp(createTestStore(), { initialEntries: ['/app'] });
    const information = screen.getByRole('navigation', { name: 'Information' });
    const cookies = within(information).getByRole('link', { name: 'Cookies' });
    const glossary = within(information).getByRole('link', { name: 'Glossary' });
    expect(cookies.nextElementSibling).toBe(glossary);
    await user.click(glossary);
    expect(screen.getByRole('heading', { name: 'Glossary', level: 1 })).toBeVisible();
    await user.click(
      within(screen.getByRole('contentinfo')).getByRole('link', { name: 'KendoMenu home' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Is KendoMenu useful for all experience levels?' }),
    );
    const answer = screen.getByRole('region', {
      name: 'Is KendoMenu useful for all experience levels?',
    });
    const link = within(answer).getByRole('link', { name: 'Glossary' });
    expect(link).toHaveClass('landing-faq-source-link');
    await user.click(link);
    expect(screen.getByRole('heading', { name: 'Glossary', level: 1 })).toBeVisible();
  });
});
