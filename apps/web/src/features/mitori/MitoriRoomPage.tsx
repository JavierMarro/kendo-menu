import { useState, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { GlossaryPage } from '../glossary/GlossaryPage';
import { SourcesPage } from '../sources/SourcesPage';
import {
  persistMitoriSeenIds,
  readMitoriSeenState,
  type MitoriSeenState,
} from '../../lib/mitori-seen';
import { MITORI_VIDEOS } from './mitori-videos';
import type { MitoriVideo } from './mitori-videos';

const MITORI_TABS = ['techniques', 'documentaries', 'kata', 'resources', 'glossary'] as const;
type MitoriTab = (typeof MITORI_TABS)[number];
const MITORI_VIDEO_IDS: ReadonlySet<string> = new Set(
  Object.values(MITORI_VIDEOS)
    .flat()
    .map(({ id }) => id),
);

const TAB_LABELS: Readonly<Record<MitoriTab, string>> = {
  techniques: 'Mitori',
  documentaries: 'Documentaries',
  kata: 'Kata',
  resources: 'Resources',
  glossary: 'Glossary',
};

function isMitoriTab(value: string | null): value is MitoriTab {
  return value !== null && MITORI_TABS.some((tab) => tab === value);
}

function VideoList({
  videos,
  section,
  seenVideoIds,
  onSeenChange,
  canPersist,
}: {
  readonly videos: readonly MitoriVideo[];
  readonly section: MitoriTab;
  readonly seenVideoIds: ReadonlySet<string>;
  readonly onSeenChange: (videoId: string, seen: boolean) => void;
  readonly canPersist: boolean;
}): ReactElement {
  const [openVideoId, setOpenVideoId] = useState<string | null>(null);

  return (
    <section className="mitori-video-section" aria-labelledby="mitori-video-heading">
      <h2 id="mitori-video-heading">{TAB_LABELS[section]}</h2>
      <p className="mitori-seen-note" id="mitori-seen-note">
        Seen marks stay in this browser and don’t sync across devices.
      </p>
      {!canPersist ? (
        <p className="mitori-seen-note" role="status">
          Seen marks can’t be saved in this browser; they will last until you leave this room.
        </p>
      ) : null}
      <div className="mitori-video-list">
        {videos.map((video) => {
          const isOpen = openVideoId === video.id;
          const isSeen = seenVideoIds.has(video.id);
          const playerId = `mitori-player-${video.id}`;
          const playlistQuery = video.playlistId === undefined ? '' : `?list=${video.playlistId}`;
          const youtubePlaylist = video.playlistId === undefined ? '' : `&list=${video.playlistId}`;

          return (
            <article
              className={`mitori-video-item${isSeen ? ' mitori-video-item--seen' : ''}`}
              key={video.id}
            >
              <div className="mitori-video-row">
                <button
                  className="mitori-video-toggle"
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={playerId}
                  onClick={() => setOpenVideoId(isOpen ? null : video.id)}
                >
                  <span className="mitori-video-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" focusable="false">
                      {isOpen ? <path d="M6 12h12" /> : <path d="m9 6 9 6-9 6Z" />}
                    </svg>
                  </span>
                  <span className="mitori-video-copy">
                    <span className="mitori-video-title">{video.title}</span>
                    {video.author === undefined ? null : (
                      <span className="mitori-video-author">
                        {video.playlistId === undefined ? '' : 'Video series · '}
                        {video.author}
                      </span>
                    )}
                  </span>
                  <span className="mitori-video-action">
                    {isOpen
                      ? 'Close'
                      : video.playlistId === undefined
                        ? 'Open video'
                        : 'Open series'}
                  </span>
                </button>
                <label className="mitori-seen-control">
                  <input
                    type="checkbox"
                    checked={isSeen}
                    aria-label={`Seen: ${video.title}`}
                    aria-describedby="mitori-seen-note"
                    onChange={(event) => onSeenChange(video.id, event.currentTarget.checked)}
                  />
                  <span>Seen</span>
                </label>
              </div>
              <div id={playerId} className="mitori-video-player" hidden={!isOpen}>
                {isOpen ? (
                  <>
                    <div className="mitori-video-frame">
                      <iframe
                        src={`https://www.youtube-nocookie.com/embed/${video.id}${playlistQuery}`}
                        title={video.title}
                        referrerPolicy="strict-origin-when-cross-origin"
                        allow="encrypted-media; picture-in-picture; web-share"
                        allowFullScreen
                      />
                    </div>
                    <a
                      className="mitori-youtube-link"
                      href={`https://www.youtube.com/watch?v=${video.id}${youtubePlaylist}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Watch on YouTube
                    </a>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function MitoriRoomPage(): ReactElement {
  const location = useLocation();
  const [seenState, setSeenState] = useState<MitoriSeenState>(() =>
    readMitoriSeenState(() => window.localStorage, MITORI_VIDEO_IDS),
  );
  const rawTab = new URLSearchParams(location.search).get('tab');
  const selectedTab: MitoriTab = isMitoriTab(rawTab) ? rawTab : 'techniques';
  const handleSeenChange = (videoId: string, seen: boolean): void => {
    const seenVideoIds = new Set(seenState.seenVideoIds);
    if (seen) {
      seenVideoIds.add(videoId);
    } else {
      seenVideoIds.delete(videoId);
    }
    setSeenState({
      seenVideoIds,
      canPersist: persistMitoriSeenIds(() => window.localStorage, seenVideoIds, MITORI_VIDEO_IDS),
    });
  };

  return (
    <article className="mitori-room-page" aria-labelledby="mitori-room-title">
      <header className="mitori-room-header">
        <h1 id="mitori-room-title">Mitori room</h1>
        <p className="page-intro">Learn through observation.</p>
      </header>
      <nav className="mitori-tabs" aria-label="Mitori room sections">
        {MITORI_TABS.map((tab) => {
          const search = new URLSearchParams(location.search);
          search.set('tab', tab);

          return (
            <Link
              className="mitori-tab"
              key={tab}
              to={{ pathname: location.pathname, search: `?${search.toString()}` }}
              aria-current={selectedTab === tab ? 'page' : undefined}
            >
              {TAB_LABELS[tab]}
            </Link>
          );
        })}
      </nav>
      <section className="mitori-content" aria-label={`${TAB_LABELS[selectedTab]} content`}>
        {selectedTab === 'techniques' ||
        selectedTab === 'documentaries' ||
        selectedTab === 'kata' ? (
          <VideoList
            key={selectedTab}
            videos={MITORI_VIDEOS[selectedTab]}
            section={selectedTab}
            seenVideoIds={seenState.seenVideoIds}
            onSeenChange={handleSeenChange}
            canPersist={seenState.canPersist}
          />
        ) : null}
        {selectedTab === 'resources' ? <SourcesPage embedded /> : null}
        {selectedTab === 'glossary' ? <GlossaryPage embedded /> : null}
      </section>
    </article>
  );
}
