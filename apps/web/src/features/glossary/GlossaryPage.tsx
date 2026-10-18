import { useState, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { GLOSSARY_ENTRIES, GLOSSARY_GROUP_TERMS, type GlossaryEntry } from './glossary-data';
import { filterGlossary, groupGlossary } from './glossary-search';

function Definitions({ entries }: { readonly entries: readonly GlossaryEntry[] }): ReactElement {
  return (
    <dl className="glossary-definitions">
      {entries.map((entry) => (
        <div className="glossary-entry" key={entry.id}>
          <dt id={entry.id}>{entry.term}</dt>
          <dd>
            {entry.aliases === undefined ? null : (
              <p className="glossary-aliases">Also written: {entry.aliases.join(' · ')}</p>
            )}
            <p>{entry.definition}</p>
            {entry.note === undefined ? null : <p className="glossary-note">{entry.note}</p>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function GlossaryPage({ embedded = false }: { readonly embedded?: boolean }): ReactElement {
  const PageHeading = embedded ? 'h2' : 'h1';
  const SectionHeading = embedded ? 'h3' : 'h2';
  const location = useLocation();
  const [query, setQuery] = useState('');
  const entries = filterGlossary(GLOSSARY_ENTRIES, query);
  const groupTerms = filterGlossary(GLOSSARY_GROUP_TERMS, query);
  const groups = groupGlossary(entries);
  const count = entries.length + groupTerms.length;

  return (
    <article
      className={`glossary-page${embedded ? ' glossary-page--embedded' : ''}`}
      aria-labelledby="glossary-title"
    >
      <header className="page-header">
        <div>
          <PageHeading id="glossary-title">Glossary</PageHeading>
          <p className="page-intro">
            A quick refresher on the strikes, footwork and practice formats in KendoMenu’s 10 dojo
            menus.
          </p>
          <p className="glossary-context">
            Combination arrows show the order of techniques; look up each part individually. Group
            labels have their own section below.
          </p>
        </div>
      </header>

      <div className="glossary-search">
        <label htmlFor="glossary-search">Find a term</label>
        <input
          id="glossary-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try kote, kirikaeshi or a menu spelling"
          aria-describedby="glossary-search-hint"
        />
        <p id="glossary-search-hint">
          Search names and alternative spellings, with or without accents or hyphens.
        </p>
        <p role="status" aria-live="polite" aria-atomic="true">
          {count} {count === 1 ? 'term' : 'terms'} shown
        </p>
      </div>

      {groups.length === 0 ? null : (
        <nav className="glossary-alphabet" aria-label="Glossary letters">
          {groups.map(({ letter }) => (
            <a key={letter} href={`#glossary-${letter}`}>
              {letter}
            </a>
          ))}
        </nav>
      )}
      {count === 0 ? (
        <p className="glossary-empty">
          No terms match “{query}”. Try a shorter name or clear the search.
        </p>
      ) : null}
      {groups.map(({ letter, entries: letterEntries }) => (
        <section className="glossary-section" key={letter} aria-labelledby={`glossary-${letter}`}>
          <SectionHeading id={`glossary-${letter}`} tabIndex={-1}>
            {letter}
          </SectionHeading>
          <Definitions entries={letterEntries} />
        </section>
      ))}
      {groupTerms.length === 0 ? null : (
        <section
          className="glossary-section glossary-group-terms"
          aria-labelledby="glossary-groups-title"
        >
          <div>
            <SectionHeading id="glossary-groups-title">Practice group labels</SectionHeading>
            <p>Umbrella terms used to organise named exercises in the menus.</p>
          </div>
          <Definitions entries={groupTerms} />
        </section>
      )}
      <section className="glossary-references" aria-labelledby="glossary-references-title">
        <p>
          For the articles and filmed sessions behind the menus, visit{' '}
          <Link
            to={
              embedded
                ? {
                    pathname: location.pathname,
                    search: '?tab=resources',
                  }
                : '/app/sources'
            }
          >
            {embedded ? 'Resources' : 'Sources'}
          </Link>
          .
        </p>
      </section>
    </article>
  );
}
