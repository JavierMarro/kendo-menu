import type { ReactElement } from 'react';

interface ExternalSource {
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly linkType: 'article' | 'video' | 'PDF';
  readonly status?: string;
}

const PRACTICE_MENU_SOURCES: readonly ExternalSource[] = [
  {
    title: 'Kendo practice menu introduction — Minaken',
    url: 'https://minaken3.com/kendo-practice/training-menu-introduction/',
    description:
      'A Japanese-language overview of a typical session flow, from warm-up and suburi through waza practice and jigeiko.',
    linkType: 'article',
  },
  {
    title: 'Building a school-club practice menu — Kendo Club',
    url: 'https://www.kendoubu.com/category22/entry71.html',
    description:
      'A Japanese-language guide that organises sample menus around available time, season and the area a club wants to strengthen.',
    linkType: 'article',
  },
  {
    title: 'Asageiko — kenshi 24/7',
    url: 'https://kenshi247.net/blog/2023/01/22/asageiko/',
    description:
      'George McCall outlines a 30-minute Osaka police morning session and a separate 45-minute personal morning routine.',
    linkType: 'article',
  },
  {
    title: 'Ushioda Junior High School practice — Sports Joutatsu',
    url: 'https://sportsjoutatsu.com/kendou-joutatsu-kyoukadvd/shiodachuugaku-renshuuhou.html',
    description:
      'A Japanese-language summary of the school’s autumn practice menu, from suburi and footwork to jigeiko and kakarigeiko.',
    linkType: 'article',
  },
  {
    title: 'Inside Sano Nihon University High School practice — LET’S KENDO',
    url: 'https://www.letskendo.com/posts/1693/',
    description:
      'A Japanese-language profile of the club’s weekly practice, basic work and original Ken-tore circuit.',
    linkType: 'article',
  },
  {
    title: 'Ritsumeikan Junior & Senior High School practice',
    url: 'https://www.ritsumei.ac.jp/nkc/student/club/kendo/rensyunaiyou2016new.html/',
    description:
      'The club’s Japanese-language outline of stretching, suburi, footwork, kihon and other regular practice.',
    linkType: 'article',
  },
];

const KIHON_SOURCES: readonly ExternalSource[] = [
  {
    title: 'Simply Bokuto ni Waza — Kaminarikan',
    url: 'https://www.kaminarikan.org/en/articles/bokuto_ni_waza',
    description:
      'An English step-by-step outline of the nine forms in Bokuto ni yoru Kendo Kihon Waza Keiko Ho.',
    linkType: 'article',
  },
  {
    title: 'Bokuto ni yoru Kendo Kihon Waza Keiko Ho — kenshi 24/7',
    url: 'https://kenshi247.net/blog/2010/06/28/bokuto-ni-yoru-kendo-kihon-waza-keikoho/',
    description:
      'A translated overview of the method’s aims, teaching points and nine waza, followed by personal commentary.',
    linkType: 'article',
  },
];

const KANOYA_VIDEO_SOURCES: readonly ExternalSource[] = [
  {
    title: 'This is Kanoya University keiko (English subtitles), part 1 of 4',
    url: 'https://www.youtube.com/watch?v=wVFUgb4PBhE',
    description:
      'The first supplied instalment in Kendo Jidai International’s Kanoya University keiko series.',
    linkType: 'video',
  },
  {
    title: 'This is Kanoya University keiko (English subtitles), part 2 of 4',
    url: 'https://www.youtube.com/watch?v=C5_rVSlroyQ',
    description:
      'The second supplied instalment in Kendo Jidai International’s Kanoya University keiko series.',
    linkType: 'video',
  },
  {
    title: 'This is Kanoya University keiko (English subtitles), part 3 of 4',
    url: 'https://www.youtube.com/watch?v=PUKn48yiFGg',
    description:
      'The third supplied instalment in Kendo Jidai International’s Kanoya University keiko series.',
    linkType: 'video',
  },
];

const TAKACHIHO_VIDEO_SOURCES: readonly ExternalSource[] = [
  {
    title: 'Elite High School kendo club training: Takachiho High School, volume 1',
    url: 'https://www.youtube.com/watch?v=zAW4i2ThTLo',
    description:
      'The first of two supplied Kendo Jidai International videos showing Takachiho High School training.',
    linkType: 'video',
  },
  {
    title: 'Elite High School kendo club training: Takachiho High School, volume 2',
    url: 'https://www.youtube.com/watch?v=egkw-tg_Twk',
    description:
      'The second supplied Kendo Jidai International video showing Takachiho High School training.',
    linkType: 'video',
  },
];

const REFERENCE_SOURCES: readonly ExternalSource[] = [
  {
    title: 'Safe and effective junior-high-school kendo lessons — AJKF digest, fourth edition',
    url: 'https://www.kendo.or.jp/wp/wp-content/uploads/2022/06/kendojugyonotenkai_digest_04_all.pdf',
    description:
      'An official AJKF teaching guide for safe and effective junior-high-school kendo lessons under Japan’s curriculum guidelines.',
    linkType: 'PDF',
    status: 'Useful reference — not currently used by KendoMenu.',
  },
];

interface SourceListProps {
  readonly sources: readonly ExternalSource[];
}

function SourceList({ sources }: SourceListProps): ReactElement {
  return (
    <ul className="sources-list">
      {sources.map((source) => (
        <li className="source-item" key={source.url}>
          <a
            className="source-link"
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${source.title} (external ${source.linkType}, opens in a new tab)`}
          >
            <span className="source-link-title">{source.title}</span>
            <span className="source-link-meta">
              External {source.linkType} · opens in a new tab
            </span>
          </a>
          <p className="source-description">{source.description}</p>
          {source.status === undefined ? null : <p className="source-status">{source.status}</p>}
        </li>
      ))}
    </ul>
  );
}

export function SourcesPage(): ReactElement {
  return (
    <article className="sources-page" aria-labelledby="sources-title">
      <header className="page-header sources-header">
        <div>
          <p className="eyebrow">Research and reference</p>
          <h1 id="sources-title">Sources</h1>
          <p className="page-intro">
            Publicly available articles and videos used to research KendoMenu’s curated keiko menus,
            followed by an additional official reference.
          </p>
        </div>
      </header>

      <div className="sources-groups">
        <section className="sources-group" aria-labelledby="practice-menu-sources-title">
          <div className="sources-group-heading">
            <h2 id="practice-menu-sources-title">Practice menus and training context</h2>
            <p>Articles describing real session structures and school or dojo practice.</p>
          </div>
          <SourceList sources={PRACTICE_MENU_SOURCES} />
        </section>

        <section className="sources-group" aria-labelledby="kihon-sources-title">
          <div className="sources-group-heading">
            <h2 id="kihon-sources-title">Bokuto kihon waza</h2>
            <p>English-language explanations of the nine-part basic-waza method.</p>
          </div>
          <SourceList sources={KIHON_SOURCES} />
        </section>

        <section className="sources-group" aria-labelledby="video-sources-title">
          <div className="sources-group-heading">
            <h2 id="video-sources-title">Kendo Jidai International videos</h2>
            <p>Filmed university and high-school keiko published on YouTube.</p>
          </div>
          <div className="sources-series-list">
            <section className="sources-series" aria-labelledby="kanoya-series-title">
              <h3 id="kanoya-series-title">Kanoya University YouTube series</h3>
              <SourceList sources={KANOYA_VIDEO_SOURCES} />
            </section>
            <section className="sources-series" aria-labelledby="takachiho-series-title">
              <h3 id="takachiho-series-title">Takachiho High School YouTube series</h3>
              <SourceList sources={TAKACHIHO_VIDEO_SOURCES} />
            </section>
          </div>
        </section>

        <section className="sources-group" aria-labelledby="reference-sources-title">
          <div className="sources-group-heading">
            <h2 id="reference-sources-title">Further official reference</h2>
            <p>A useful teaching resource listed separately from KendoMenu’s current sources.</p>
          </div>
          <SourceList sources={REFERENCE_SOURCES} />
        </section>
      </div>
    </article>
  );
}
