/* MainScreen — public landing page for logged-out visitors.
   This screen owns the page shell: header, hero text, loading groups from
   Firestore, and handing the loaded groups to GroupShowcase. */

import { useEffect, useLayoutEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';

import { db } from '../../firebase';
import GroupShowcase from './GroupShowcase/GroupShowcase';
import './MainScreen.css';


const GROUPS_COLLECTION = 'groups';

const REGISTER_URL = '?register=1';
const LOGO_URL =
  'https://www.shalva.org/wp-content/uploads/2025/02/Logo-Hebrew-1024x488-1.png';

const GROUPS_STATUS = Object.freeze({
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
});

const GROUPS_LOAD_ERROR_MESSAGE =
  'לא ניתן לטעון את הקבוצות כרגע. נסו לרענן את הדף.';

// Some mobile browsers restore scroll after paint. These delayed resets keep
// the full-screen landing pinned to the top even after late layout changes.
const SCROLL_RESET_DELAYS_MS = Object.freeze([120, 350, 700]);

const noop = () => {};


function canUseDOM() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}


function resetDocumentScroll() {
  if (!canUseDOM()) {
    return;
  }

  document.documentElement.scrollTop = 0;
  document.body.scrollTop = 0;
  window.scrollTo(0, 0);
}


function normalizeGroup(groupDoc) {
  const groupData = groupDoc.data();

  return {
    ...groupData,

    // Firestore's document id stays authoritative even if the document itself
    // contains an "id" field.
    id: groupDoc.id,
  };
}


// The landing page intentionally shows every group in the collection.
// Filtering or limiting should only be added if the product requirement changes.
async function fetchGroups() {
  const groupsSnapshot = await getDocs(collection(db, GROUPS_COLLECTION));
  return groupsSnapshot.docs.map(normalizeGroup);
}


function MainScreen({
  onNavigateLogin = noop,
  homeHref = '/',
  registerHref = REGISTER_URL,
}) {
  const [groupsState, setGroupsState] = useState({
    status: GROUPS_STATUS.LOADING,
    groups: [],
    errorMessage: '',
  });

  // Reset before paint to avoid a visible jump from a restored scroll position.
  useLayoutEffect(() => {
    if (!canUseDOM()) {
      return undefined;
    }

    const canRestoreScroll = 'scrollRestoration' in window.history;
    const previousScrollRestoration = canRestoreScroll
      ? window.history.scrollRestoration
      : undefined;

    if (canRestoreScroll) {
      window.history.scrollRestoration = 'manual';
    }

    resetDocumentScroll();

    const frameId = window.requestAnimationFrame(resetDocumentScroll);
    const timeoutIds = SCROLL_RESET_DELAYS_MS.map((delay) =>
      window.setTimeout(resetDocumentScroll, delay),
    );

    return () => {
      window.cancelAnimationFrame(frameId);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));

      if (canRestoreScroll) {
        window.history.scrollRestoration = previousScrollRestoration;
      }
    };
  }, []);

  // Load all groups once. The ignore flag prevents state updates after unmount.
  useEffect(() => {
    let shouldIgnoreResult = false;

    async function loadGroups() {
      try {
        const groups = await fetchGroups();

        if (!shouldIgnoreResult) {
          setGroupsState({
            status: GROUPS_STATUS.SUCCESS,
            groups,
            errorMessage: '',
          });
        }
      } catch (error) {
        console.error('Error fetching groups:', error);

        if (!shouldIgnoreResult) {
          setGroupsState({
            status: GROUPS_STATUS.ERROR,
            groups: [],
            errorMessage: GROUPS_LOAD_ERROR_MESSAGE,
          });
        }
      }
    }

    loadGroups();

    return () => {
      shouldIgnoreResult = true;
    };
  }, []);

  // Loading completion can change the layout height. Reset once more so the
  // full-screen landing stays visually anchored at the top.
  useEffect(() => {
    if (groupsState.status === GROUPS_STATUS.LOADING) {
      return undefined;
    }

    if (!canUseDOM()) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(resetDocumentScroll);
    return () => window.cancelAnimationFrame(frameId);
  }, [groupsState.status]);

  return (
    <div className="main-container">
      <MainHeader
        homeHref={homeHref}
        registerHref={registerHref}
        onNavigateLogin={onNavigateLogin}
      />

      <main className="main-content">
        <HeroSection />

        <GroupsSection
          status={groupsState.status}
          groups={groupsState.groups}
          errorMessage={groupsState.errorMessage}
        />
      </main>
    </div>
  );
}


function MainHeader({ homeHref, registerHref, onNavigateLogin }) {
  return (
    <header className="main-header">
      <a href={homeHref} className="main-logo-link" aria-label="שלוה - לדף הבית">
        <img
          src={LOGO_URL}
          alt=""
          className="main-logo"
          width="101"
          height="48"
          decoding="async"
        />
      </a>

      <div className="header-buttons">
        <a className="btn-register" href={registerHref}>
          הרשמה להתנדבות
        </a>

        <button type="button" className="btn-login" onClick={onNavigateLogin}>
          כניסה למערכת
        </button>
      </div>
    </header>
  );
}


function HeroSection() {
  return (
    <section className="main-hero" aria-labelledby="main-hero-title">
      <div className="hero-content">
        <h1 id="main-hero-title">נותנים תקווה. משנים חיים.</h1>

        <p className="hero-text">
          ברוכים הבאים למערכת הקהילתית של שלוה.
          <span className="hero-text-tail">
            {' '}
            כאן אנו מחברים בין מתנדבים, מדריכים ורכזי פעילויות
            כדי להעניק טיפול, שילוב ותמיכה מיטביים בקהילה.
          </span>
        </p>
      </div>
    </section>
  );
}


function GroupsSection({ status, groups, errorMessage }) {
  return (
    <section
      className="groups-section"
      aria-labelledby="groups-section-title"
      aria-busy={status === GROUPS_STATUS.LOADING}
    >
      <h2 id="groups-section-title">הקבוצות שלנו</h2>

      <GroupsContent
        status={status}
        groups={groups}
        errorMessage={errorMessage}
      />
    </section>
  );
}


function GroupsContent({ status, groups, errorMessage }) {
  if (status === GROUPS_STATUS.LOADING) {
    return (
      <p className="groups-message" role="status">
        טוען קבוצות...
      </p>
    );
  }

  if (status === GROUPS_STATUS.ERROR) {
    return (
      <p className="groups-error" role="alert">
        {errorMessage}
      </p>
    );
  }

  if (groups.length === 0) {
    return (
      <p className="groups-message">
        כרגע אין קבוצות להצגה.
      </p>
    );
  }

  return <GroupShowcase groups={groups} variant="landing" />;
}


export default MainScreen;
