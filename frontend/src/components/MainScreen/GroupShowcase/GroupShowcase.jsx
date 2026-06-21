/* GroupShowcase — cinematic carousel for community groups.
   Supports auto-play, swipe, arrows, thumbnails, fullscreen and reduced motion. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import './GroupShowcase.css';

import {
  getGroupDescription,
  getGroupGradient,
  getGroupName,
  getInitial,
  getImageUrl,
  isNearActiveSlide,
} from './showcaseHelpers';


const AUTO_MS = 8000;
const SWIPE_THRESHOLD = 45;


// Guards so the component is safe outside a browser (tests, SSR, build tools).
function canUseDOM() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}


function getReducedMotionQuery() {
  if (!canUseDOM() || typeof window.matchMedia !== 'function') {
    return null;
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)');
}


// Subscribe to a media query, falling back to the legacy addListener API.
function subscribeToMediaQuery(query, listener) {
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }

  query.addListener(listener);
  return () => query.removeListener(listener);
}


function toCssUrl(value) {
  return `url(${JSON.stringify(value)})`;
}


function ShowcaseSlide({ group, gradient, isActive, isNear }) {
  const imageUrl = getImageUrl(group);
  const description = getGroupDescription(group);
  const showImage = Boolean(imageUrl && isNear);

  return (
    <div
      className={`showcase-slide${isActive ? ' is-active' : ''}`}
      aria-hidden={!isActive}
    >
      <div
        className="showcase-bg"
        aria-hidden="true"
        style={
          showImage
            ? { backgroundImage: toCssUrl(imageUrl) }
            : { backgroundImage: gradient }
        }
      >
        {!showImage && (
          <>
            <span className="showcase-orb showcase-orb-1" />
            <span className="showcase-orb showcase-orb-2" />
            <span className="showcase-monogram">{getInitial(group)}</span>
          </>
        )}
      </div>

      <div className="showcase-scrim" aria-hidden="true" />

      <div className="showcase-content">
        <h3 className="showcase-name">{getGroupName(group)}</h3>

        {description && (
          <p
            className="showcase-desc"
            style={{
              display: 'block',
              overflow: 'visible',
              WebkitLineClamp: 'unset',
              lineClamp: 'unset',
              maxWidth: '800px',
              fontSize: 'clamp(16px, 2.2vw, 21px)',
            }}
          >
            {description}
          </p>
        )}
      </div>

    </div>
  );
}


function ShowcaseThumb({ group, gradient, isActive, onSelect }) {
  const thumbImage = getImageUrl(group);
  const groupName = getGroupName(group);

  return (
    <button
      type="button"
      className={`showcase-thumb${isActive ? ' is-active' : ''}`}
      style={{
        backgroundImage: thumbImage ? toCssUrl(thumbImage) : gradient,
      }}
      onClick={onSelect}
      aria-current={isActive ? 'true' : undefined}
      aria-label={`הצגת ${groupName}`}
    >
      <span className="showcase-thumb-name">{groupName}</span>
    </button>
  );
}


function GroupShowcase({ groups = [], variant = '' }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const touchStartX = useRef(null);
  const didSwipe = useRef(false);
  const activeSlideIndex = groups.length === 0
    ? 0
    : Math.min(Math.max(activeIndex, 0), groups.length - 1);

  // Keep reduced-motion behavior aligned with the visitor's OS preference.
  useEffect(() => {
    const query = getReducedMotionQuery();

    if (!query) {
      return undefined;
    }

    const sync = () => setReduceMotion(query.matches);
    sync();

    return subscribeToMediaQuery(query, sync);
  }, []);

  const goTo = useCallback(
    (index) => {
      const count = groups.length;

      if (count === 0) {
        return;
      }

      setActiveIndex(((index % count) + count) % count);
    },
    [groups.length],
  );

  const goNext = useCallback(() => goTo(activeSlideIndex + 1), [goTo, activeSlideIndex]);
  const goPrev = useCallback(() => goTo(activeSlideIndex - 1), [goTo, activeSlideIndex]);

  // If the list changes, keep the active slide inside the valid range.
  useEffect(() => {
    setActiveIndex((current) =>
      groups.length === 0 ? 0 : Math.min(current, groups.length - 1),
    );
  }, [groups.length]);

  const handleTouchStart = (event) => {
    touchStartX.current = event.touches[0].clientX;
    didSwipe.current = false;
  };

  const handleTouchEnd = (event) => {
    if (touchStartX.current === null) {
      return;
    }

    const deltaX = event.changedTouches[0].clientX - touchStartX.current;

    if (deltaX < -SWIPE_THRESHOLD) {
      didSwipe.current = true;
      goNext();
    } else if (deltaX > SWIPE_THRESHOLD) {
      didSwipe.current = true;
      goPrev();
    }

    touchStartX.current = null;
  };

  // Manual navigation restarts the wait because goNext changes with the active slide.
  useEffect(() => {
    if (!canUseDOM() || groups.length <= 1 || reduceMotion || isPaused) {
      return undefined;
    }

    const timer = window.setTimeout(goNext, AUTO_MS);
    return () => window.clearTimeout(timer);
  }, [groups.length, reduceMotion, isPaused, goNext]);

  const toggleFullscreen = () => {
    if (didSwipe.current) {
      didSwipe.current = false;
      return;
    }

    setIsFullscreen((open) => !open);
  };

  // Fullscreen freezes the page behind the stage and Escape closes it.
  useEffect(() => {
    if (!isFullscreen || !canUseDOM()) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isFullscreen]);

  const gradients = useMemo(
    () => groups.map((group, index) => getGroupGradient(group, index)),
    [groups],
  );

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goNext();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      goPrev();
    } else if (
      // Enter / Space toggle fullscreen — but only when the stage itself is
      // focused, so a key press inside an inner button doesn't double-fire.
      event.currentTarget === event.target &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault();
      toggleFullscreen();
    }
  };

  if (groups.length === 0) {
    return null;
  }

  const showcaseClassName = [
    'showcase',
    variant ? `showcase--${variant}` : '',
    isFullscreen ? 'is-fullscreen' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={showcaseClassName}>
      <div
        className="showcase-stage"
        role="group"
        aria-roledescription="carousel"
        aria-label="חלון ראווה של תוכניות הקהילה"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onClick={toggleFullscreen}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {groups.map((group, index) => (
          <ShowcaseSlide
            key={group.id || index}
            group={group}
            gradient={gradients[index]}
            isActive={index === activeSlideIndex}
            isNear={isNearActiveSlide(index, activeSlideIndex, groups.length)}
          />
        ))}

        {groups.length > 1 && (
          <>
            <button
              type="button"
              className="showcase-nav showcase-nav-prev"
              onClick={(event) => {
                event.stopPropagation();
                goPrev();
              }}
              aria-label="התוכנית הקודמת"
            >
              ›
            </button>

            <button
              type="button"
              className="showcase-nav showcase-nav-next"
              onClick={(event) => {
                event.stopPropagation();
                goNext();
              }}
              aria-label="התוכנית הבאה"
            >
              ‹
            </button>
          </>
        )}

        {groups.length > 1 && !reduceMotion && (
          <button
            type="button"
            className="showcase-playpause"
            onClick={(event) => {
              event.stopPropagation();
              setIsPaused((paused) => !paused);
            }}
            aria-pressed={isPaused}
            aria-label={isPaused ? 'הפעלת החלפה אוטומטית' : 'עצירת החלפה אוטומטית'}
          >
            {isPaused ? (
              <svg
                className="showcase-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="#ffffff"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg
                className="showcase-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="#ffffff"
                aria-hidden="true"
              >
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="15" y="5" width="4" height="14" rx="1" />
              </svg>
            )}
          </button>
        )}

        {!isFullscreen && (
          <button
            type="button"
            className="showcase-fullscreen"
            onClick={(event) => {
              event.stopPropagation();
              setIsFullscreen(true);
            }}
            aria-label="פתיחת תצוגה במסך מלא"
          >
            ⛶
          </button>
        )}

        {isFullscreen && (
          <button
            type="button"
            className="showcase-close"
            onClick={(event) => {
              event.stopPropagation();
              setIsFullscreen(false);
            }}
            aria-label="סגירת מסך מלא"
          >
            ✕
          </button>
        )}
      </div>

      {groups.length > 1 && (
        <div className="showcase-thumbs" role="group" aria-label="בחירת תוכנית">
          {groups.map((group, index) => (
            <ShowcaseThumb
              key={group.id || index}
              group={group}
              gradient={gradients[index]}
              isActive={index === activeSlideIndex}
              onSelect={() => goTo(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default GroupShowcase;
