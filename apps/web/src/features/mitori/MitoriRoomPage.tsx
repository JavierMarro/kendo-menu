import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { GlossaryPage } from '../glossary/GlossaryPage';
import { SourcesPage } from '../sources/SourcesPage';
import {
  persistMitoriSeenIds,
  readMitoriSeenState,
  type MitoriSeenState,
} from '../../lib/mitori-seen';
import {
  MITORI_EQUIPMENT_CATEGORIES,
  MITORI_EQUIPMENT_CATEGORY_LABELS,
  MITORI_EQUIPMENT_VIDEOS,
  MITORI_VIDEOS,
  type MitoriEquipmentCategory,
} from './mitori-videos';
import type { MitoriVideo } from './mitori-videos';

const MITORI_TABS = [
  'techniques',
  'competitions',
  'documentaries',
  'kata',
  'equipment',
  'resources',
  'glossary',
] as const;
type MitoriTab = (typeof MITORI_TABS)[number];
const COMPETITION_COLLECTIONS = ['2026', 'ajkc-finals', 'ajkc-finals-womens'] as const;
type CompetitionCollection = (typeof COMPETITION_COLLECTIONS)[number];
const MITORI_VIDEO_IDS: ReadonlySet<string> = new Set(
  [...Object.values(MITORI_VIDEOS).flat(), ...Object.values(MITORI_EQUIPMENT_VIDEOS).flat()].map(
    ({ id }) => id,
  ),
);

const TAB_LABELS: Readonly<Record<MitoriTab, string>> = {
  techniques: 'General',
  competitions: 'Competitions',
  documentaries: 'Documentaries',
  kata: 'Kata',
  equipment: 'Equipment',
  resources: 'Resources',
  glossary: 'Glossary',
};

const COMPETITION_LABELS: Readonly<Record<CompetitionCollection, string>> = {
  '2026': '2026',
  'ajkc-finals': 'AJKC finals (mens)',
  'ajkc-finals-womens': 'AJKC finals (womens)',
};

function isMitoriTab(value: string | null): value is MitoriTab {
  return value !== null && MITORI_TABS.some((tab) => tab === value);
}

function isCompetitionCollection(value: string | null): value is CompetitionCollection {
  return value !== null && COMPETITION_COLLECTIONS.some((collection) => collection === value);
}

function isMitoriEquipmentCategory(value: string | null): value is MitoriEquipmentCategory {
  return value !== null && MITORI_EQUIPMENT_CATEGORIES.some((category) => category === value);
}

function VideoList({
  videos,
  title,
  seenVideoIds,
  onSeenChange,
  canPersist,
}: {
  readonly videos: readonly MitoriVideo[];
  readonly title: string;
  readonly seenVideoIds: ReadonlySet<string>;
  readonly onSeenChange: (videoId: string, seen: boolean) => void;
  readonly canPersist: boolean;
}): ReactElement {
  const [openVideoId, setOpenVideoId] = useState<string | null>(null);

  return (
    <section className="mitori-video-section" aria-labelledby="mitori-video-heading">
      <h2 id="mitori-video-heading">{title}</h2>
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
          const videoUrl =
            video.playlistId === undefined
              ? `https://www.youtube.com/watch?v=${video.id}`
              : `https://www.youtube.com/playlist?list=${video.playlistId}`;
          const embedUrl =
            video.playlistId === undefined
              ? `https://www.youtube-nocookie.com/embed/${video.id}`
              : `https://www.youtube-nocookie.com/embed/videoseries?list=${video.playlistId}`;

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
                        src={embedUrl}
                        title={video.title}
                        referrerPolicy="strict-origin-when-cross-origin"
                        allow="encrypted-media; picture-in-picture; web-share"
                        allowFullScreen
                      />
                    </div>
                    <a
                      className="mitori-youtube-link"
                      href={videoUrl}
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
  const navigate = useNavigate();
  const [seenState, setSeenState] = useState<MitoriSeenState>(() =>
    readMitoriSeenState(() => window.localStorage, MITORI_VIDEO_IDS),
  );
  const searchParams = new URLSearchParams(location.search);
  const rawTab = searchParams.get('tab');
  const selectedTab: MitoriTab = isMitoriTab(rawTab) ? rawTab : 'techniques';
  const rawCollection = searchParams.get('collection');
  const selectedCollection: CompetitionCollection = isCompetitionCollection(rawCollection)
    ? rawCollection
    : '2026';
  const rawEquipmentCategory = searchParams.get('category');
  const selectedEquipmentCategory: MitoriEquipmentCategory | null =
    selectedTab === 'equipment' && isMitoriEquipmentCategory(rawEquipmentCategory)
      ? rawEquipmentCategory
      : null;
  const equipmentCategoryLinks = useRef<Record<MitoriEquipmentCategory, HTMLAnchorElement | null>>({
    'wear-fold': null,
    'care-cleaning': null,
    'craft-manufacture': null,
  });
  const equipmentBackButton = useRef<HTMLButtonElement | null>(null);
  const previousEquipmentCategory = useRef<MitoriEquipmentCategory | null>(null);
  const equipmentSelectionPending = useRef(false);
  useEffect(() => {
    if (selectedTab !== 'equipment') {
      previousEquipmentCategory.current = null;
      return;
    }
    if (selectedEquipmentCategory !== null) {
      if (equipmentSelectionPending.current) equipmentBackButton.current?.focus();
      equipmentSelectionPending.current = false;
      previousEquipmentCategory.current = selectedEquipmentCategory;
      return;
    }
    const previousCategory = previousEquipmentCategory.current;
    if (previousCategory !== null) {
      equipmentCategoryLinks.current[previousCategory]?.focus();
      previousEquipmentCategory.current = null;
    }
  }, [selectedEquipmentCategory, selectedTab]);
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
          if (
            tab !== 'equipment' ||
            selectedTab !== 'equipment' ||
            selectedEquipmentCategory !== null
          ) {
            search.delete('category');
          }

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
        {selectedTab === 'competitions' ? (
          <>
            <nav className="mitori-tabs mitori-subtabs" aria-label="Competition collections">
              {COMPETITION_COLLECTIONS.map((collection) => {
                const search = new URLSearchParams(location.search);
                search.set('tab', 'competitions');
                search.set('collection', collection);

                return (
                  <Link
                    className="mitori-tab"
                    key={collection}
                    to={{ pathname: location.pathname, search: `?${search.toString()}` }}
                    aria-current={selectedCollection === collection ? 'page' : undefined}
                  >
                    {COMPETITION_LABELS[collection]}
                  </Link>
                );
              })}
            </nav>
            <VideoList
              key={selectedCollection}
              videos={
                MITORI_VIDEOS[
                  selectedCollection === '2026' ? 'competition-2026' : selectedCollection
                ]
              }
              title={COMPETITION_LABELS[selectedCollection]}
              seenVideoIds={seenState.seenVideoIds}
              onSeenChange={handleSeenChange}
              canPersist={seenState.canPersist}
            />
          </>
        ) : null}
        {selectedTab === 'techniques' ||
        selectedTab === 'documentaries' ||
        selectedTab === 'kata' ? (
          <VideoList
            key={selectedTab}
            videos={MITORI_VIDEOS[selectedTab]}
            title={TAB_LABELS[selectedTab]}
            seenVideoIds={seenState.seenVideoIds}
            onSeenChange={handleSeenChange}
            canPersist={seenState.canPersist}
          />
        ) : null}
        {selectedTab === 'equipment' && selectedEquipmentCategory === null ? (
          <nav className="mitori-equipment-picker" aria-label="Equipment categories">
            {MITORI_EQUIPMENT_CATEGORIES.map((category, index) => {
              const search = new URLSearchParams(location.search);
              search.set('tab', 'equipment');
              search.set('category', category);

              return (
                <Link
                  className={`mitori-equipment-bubble mitori-equipment-bubble--${index + 1}`}
                  key={category}
                  ref={(element) => {
                    equipmentCategoryLinks.current[category] = element;
                  }}
                  onClick={(event) => {
                    if (
                      event.button === 0 &&
                      !event.metaKey &&
                      !event.ctrlKey &&
                      !event.shiftKey &&
                      !event.altKey
                    ) {
                      equipmentSelectionPending.current = true;
                    }
                  }}
                  to={{ pathname: location.pathname, search: `?${search.toString()}` }}
                >
                  {MITORI_EQUIPMENT_CATEGORY_LABELS[category]}
                </Link>
              );
            })}
          </nav>
        ) : null}
        {selectedTab === 'equipment' && selectedEquipmentCategory !== null ? (
          <div className="mitori-equipment-detail" key={selectedEquipmentCategory}>
            <button
              className="mitori-equipment-back"
              type="button"
              ref={equipmentBackButton}
              onClick={() => {
                const search = new URLSearchParams(location.search);
                search.set('tab', 'equipment');
                search.delete('category');
                void navigate(
                  { pathname: location.pathname, search: `?${search.toString()}` },
                  { replace: true },
                );
              }}
            >
              Back to Equipment
            </button>
            <VideoList
              key={selectedEquipmentCategory}
              videos={MITORI_EQUIPMENT_VIDEOS[selectedEquipmentCategory]}
              title={MITORI_EQUIPMENT_CATEGORY_LABELS[selectedEquipmentCategory]}
              seenVideoIds={seenState.seenVideoIds}
              onSeenChange={handleSeenChange}
              canPersist={seenState.canPersist}
            />
          </div>
        ) : null}
        {selectedTab === 'resources' ? <SourcesPage embedded /> : null}
        {selectedTab === 'glossary' ? <GlossaryPage embedded /> : null}
      </section>
    </article>
  );
}
