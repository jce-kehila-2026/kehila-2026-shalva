// GroupShowcase — a cinematic, Apple-style presentation of the community
// groups for the public landing page. Instead of a plain grid of cards, it
// shows ONE group at a time on a large "stage". It glides to the next group on
// its own after a few seconds (with no on-screen countdown), and visitors can
// also drive it themselves: swipe sideways on a phone, or use the arrows /
// thumbnails on a computer. Any manual move restarts the wait. Each change
// cross-fades and plays a slow background zoom (the "Ken Burns" effect).
//
// Groups today have no image, so each group gets a rich, deterministic
// gradient "scene" (same group -> same colours every time). If a group ever
// gains an `imageUrl` / `image` / `photoURL` field, the stage uses that photo
// automatically — no code change needed.

// React hooks for state, side effects, stable callbacks, a memo, and a ref.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Styles for this component.
import './GroupShowcase.css';


// How long (ms) a group stays on screen before the showcase advances by
// itself. There is no visible countdown — it just moves on quietly.
const AUTO_MS = 8000;


// A curated set of deep, on-brand gradient "scenes". They lean on Shalva's
// purple + cyan but add tasteful variety, and all are dark enough for the
// white overlay text to stay readable.
const GRADIENTS = [
  'linear-gradient(135deg, #9E2188 0%, #5b1370 55%, #2b0a3d 100%)',
  'linear-gradient(135deg, #52A7DD 0%, #2f6fae 55%, #142f57 100%)',
  'linear-gradient(135deg, #b5379b 0%, #7a1d86 50%, #3a1456 100%)',
  'linear-gradient(135deg, #2bb3a3 0%, #1f7aa6 55%, #143a66 100%)',
  'linear-gradient(135deg, #e0608f 0%, #9e2188 55%, #4a1257 100%)',
  'linear-gradient(135deg, #6a5acd 0%, #4b2c8f 55%, #221349 100%)',
  'linear-gradient(135deg, #f0a35e 0%, #c45b7c 55%, #6a1f6f 100%)',
  'linear-gradient(135deg, #3fa7c4 0%, #4a4fbf 55%, #2a1a66 100%)',
];


// Turn any string into a small, stable number. Used so each group always maps
// to the same gradient (a group's "scene" never changes between visits).
function hashString(text) {
  let hash = 0;

  for (let i = 0; i < text.length; i += 1) {
    // Classic rolling hash; the bit-shift keeps it inside a 32-bit integer.
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  // Always return a non-negative number.
  return Math.abs(hash);
}


// Read a group's display name, tolerating the two field names used elsewhere.
function getGroupName(group) {
  return group.groupName || group.name || 'קבוצה ללא שם';
}


// First visible character of the name, used as the big "monogram" on gradient
// scenes that have no photo.
function getInitial(group) {
  const name = getGroupName(group).trim();
  return name ? name[0] : '◍';
}


// A group's uploaded photo, if it has one. Returns null when there is none —
// the showcase then shows the group's gradient "scene" with its monogram.
function getImageUrl(group) {
  return group.imageUrl || group.image || group.photoURL || null;
}


function GroupShowcase({ groups }) {
  // Which group is currently centre stage.
  const [activeIndex, setActiveIndex] = useState(0);

  // When true, the stage expands to fill the whole screen (a "lightbox") while
  // the images keep cycling. Tapping the stage toggles it on and off.
  const [isFullscreen, setIsFullscreen] = useState(false);

  // When true, the automatic image switching is paused so a visitor can dwell
  // on one group for as long as they like. Manual navigation still works.
  const [isPaused, setIsPaused] = useState(false);

  // Whether the visitor asked the OS to "reduce motion". When true we leave the
  // showcase still and let them advance it by hand (no auto-glide, no zoom).
  const [reduceMotion, setReduceMotion] = useState(false);

  // Keep our reduce-motion flag in sync with the OS setting.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');

    const sync = () => setReduceMotion(query.matches);
    sync();

    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  // Move to a specific group, wrapping around at both ends.
  const goTo = useCallback(
    (index) => {
      const count = groups.length;
      if (count === 0) {
        return;
      }

      // Modulo keeps the index inside [0, count) even for negative numbers.
      setActiveIndex(((index % count) + count) % count);
    },
    [groups.length],
  );

  // Convenience wrappers for the arrow buttons.
  const goNext = useCallback(() => goTo(activeIndex + 1), [goTo, activeIndex]);
  const goPrev = useCallback(() => goTo(activeIndex - 1), [goTo, activeIndex]);

  // Where a touch gesture started (so we can measure a swipe). On phones the
  // arrows are hidden, so swiping is the primary way to move between groups.
  const touchStartX = useRef(null);

  // Remember where the finger first landed.
  const handleTouchStart = (event) => {
    touchStartX.current = event.touches[0].clientX;
  };

  // On release, a far-enough horizontal drag flips to the next / previous group.
  const handleTouchEnd = (event) => {
    if (touchStartX.current === null) {
      return;
    }

    // How far the finger travelled, left (negative) or right (positive).
    const deltaX = event.changedTouches[0].clientX - touchStartX.current;
    const SWIPE_THRESHOLD = 45;

    // Dragging left advances; dragging right goes back.
    if (deltaX < -SWIPE_THRESHOLD) {
      goNext();
    } else if (deltaX > SWIPE_THRESHOLD) {
      goPrev();
    }

    touchStartX.current = null;
  };

  // Auto-advance: glide to the next group after AUTO_MS. Because this effect
  // depends on activeIndex, any manual move (swipe / arrow / thumbnail) tears
  // the timer down and starts a fresh wait — so the countdown always restarts
  // from the group the visitor just landed on.
  useEffect(() => {
    // Nothing to rotate through, the visitor prefers no motion, or they paused.
    if (groups.length <= 1 || reduceMotion || isPaused) {
      return;
    }

    const timer = setTimeout(goNext, AUTO_MS);
    return () => clearTimeout(timer);
  }, [activeIndex, groups.length, reduceMotion, isPaused, goNext]);

  // Tapping the stage expands it to fullscreen; tapping again closes it.
  const toggleFullscreen = () => setIsFullscreen((open) => !open);

  // While fullscreen: freeze the page behind the overlay and let Escape close.
  useEffect(() => {
    if (!isFullscreen) {
      return;
    }

    // Stop the page underneath from scrolling while the overlay is up.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Escape is the keyboard way out of fullscreen.
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleEscape);

    // Restore scrolling and remove the listener when we leave fullscreen.
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isFullscreen]);

  // Pre-compute the gradient for each group once (cheap, but tidy).
  const gradients = useMemo(
    () => groups.map((group, index) => {
      // Pick by name hash so it is stable; fall back to index if unnamed.
      const seed = getGroupName(group) || String(index);
      return GRADIENTS[hashString(seed) % GRADIENTS.length];
    }),
    [groups],
  );

  // Let the left / right arrow keys drive the showcase too.
  const handleKeyDown = (event) => {
    if (event.key === 'ArrowLeft') {
      goNext();
    } else if (event.key === 'ArrowRight') {
      goPrev();
    }
  };

  // Guard: nothing to show.
  if (groups.length === 0) {
    return null;
  }

  return (
    <div
      className={`showcase${isFullscreen ? ' is-fullscreen' : ''}`}
      // Arrow keys move between groups too.
      onKeyDown={handleKeyDown}
    >

      {/* The big stage: every group is stacked here; only the active one shows.
          Tapping it expands to / exits fullscreen (buttons inside stop the
          click from bubbling, so they navigate instead of toggling). */}
      <div
        className="showcase-stage"
        aria-roledescription="carousel"
        onClick={toggleFullscreen}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >

        {groups.map((group, index) => {
          // Only the active slide (and its neighbours) need to be "live", so we
          // load a photo only when it is about to be seen — keeps things light.
          const isActive = index === activeIndex;
          const isNear = Math.abs(index - activeIndex) <= 1;

          const imageUrl = getImageUrl(group);
          const showImage = imageUrl && isNear;

          return (
            <div
              className={`showcase-slide${isActive ? ' is-active' : ''}`}
              key={group.id || index}
              aria-hidden={isActive ? 'false' : 'true'}
            >

              {/* Background layer: either the real photo or the gradient scene. */}
              <div
                className="showcase-bg"
                style={
                  showImage
                    ? { backgroundImage: `url(${imageUrl})` }
                    : { backgroundImage: gradients[index] }
                }
              >
                {/* Floating blurred orbs add depth to the gradient scenes. */}
                {!showImage && (
                  <>
                    <span className="showcase-orb showcase-orb-1" />
                    <span className="showcase-orb showcase-orb-2" />

                    {/* Big translucent monogram, the "hero" of a photo-less scene. */}
                    <span className="showcase-monogram">{getInitial(group)}</span>
                  </>
                )}
              </div>

              {/* Dark scrim so the white text stays readable over any scene. */}
              <div className="showcase-scrim" />

              {/* Text overlay: the group name, and its description if it has one. */}
              <div className="showcase-content">
                <h3 className="showcase-name">{getGroupName(group)}</h3>

                {group.description && (
                  <p className="showcase-desc">{group.description}</p>
                )}
              </div>
            </div>
          );
        })}

        {/* Previous / next arrows. In RTL "previous" sits on the right.
            stopPropagation: navigate without toggling fullscreen. */}
        {groups.length > 1 && (
          <>
            <button
              type="button"
              className="showcase-nav showcase-nav-prev"
              onClick={(event) => {
                event.stopPropagation();
                goPrev();
              }}
              aria-label="הקבוצה הקודמת"
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
              aria-label="הקבוצה הבאה"
            >
              ‹
            </button>
          </>
        )}

        {/* Play / pause the automatic image switching (stopPropagation so it
            doesn't toggle fullscreen). */}
        {groups.length > 1 && !reduceMotion && (
          <button
            type="button"
            className="showcase-playpause"
            onClick={(event) => {
              event.stopPropagation();
              setIsPaused((paused) => !paused);
            }}
            aria-label={isPaused ? 'הפעלת החלפה אוטומטית' : 'עצירת החלפה אוטומטית'}
          >
            {/* Inline SVG icons render identically in every browser/font (the
                old "❙❙" glyph wasn't reliable everywhere). Explicit width/height
                attributes mean they show even if the CSS hasn't applied yet. */}
            {isPaused ? (
              <svg className="showcase-icon" width="20" height="20" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg className="showcase-icon" width="20" height="20" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="15" y="5" width="4" height="14" rx="1" />
              </svg>
            )}
          </button>
        )}

        {/* Close button, only in fullscreen (tapping the image or Esc also closes). */}
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

      {/* Thumbnail rail: a mini scene per group, the active one highlighted. */}
      {groups.length > 1 && (
        <div className="showcase-thumbs" role="tablist" aria-label="בחירת קבוצה">
          {groups.map((group, index) => {
            // The group's photo on its thumbnail (gradient if it has none).
            const thumbImage = getImageUrl(group);

            return (
            <button
              type="button"
              key={group.id || index}
              className={`showcase-thumb${index === activeIndex ? ' is-active' : ''}`}
              style={{
                backgroundImage: thumbImage ? `url(${thumbImage})` : gradients[index],
              }}
              onClick={() => goTo(index)}
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={getGroupName(group)}
            >
              <span className="showcase-thumb-name">{getGroupName(group)}</span>
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default GroupShowcase;
