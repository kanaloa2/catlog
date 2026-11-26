import { HashRouter, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { CalendarPage } from './pages/CalendarPage';
import { EventsPage } from './pages/EventsPage';
import { EventPage } from './pages/EventPage';
import { CatsPage } from './pages/CatsPage';
import { CatPage } from './pages/CatPage';
import { QuickPage } from './pages/QuickPage';
import { AddPage, AddedPage } from './pages/AddPage';
import { SettingsPage } from './pages/SettingsPage';
import { Empty } from './components/ui';
import { AuthGate, useAuth } from './auth/AuthGate';
import { SyncIndicator } from './components/SyncIndicator';
import { ToastProvider } from './components/Toast';
import { useSyncStatus } from './sync';
import { ensureSomebody } from './lib/repo';
import { supabase } from './supabase';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Makes sure the "Somebody" pseudo-cat exists once the first sync has pulled the server copy, and saves the time zone. */
function SomebodyKeeper() {
  const { session } = useAuth();
  const status = useSyncStatus();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !status.lastSyncedAt) return;
    done.current = true;
    void ensureSomebody(session.user.id);
    // Lets events logged by email or shortcut use this person's local time. Best effort.
    const time_zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    void supabase
      .from('catlog_user_settings')
      .upsert({ user_id: session.user.id, time_zone, updated_at: new Date().toISOString() })
      .then(() => undefined, () => undefined);
  }, [status.lastSyncedAt, session.user.id]);
  return null;
}

function AddedRoute() {
  const { eventId } = useParams();
  return <AddedPage id={eventId ?? ''} />;
}

export default function App() {
  return (
    <AuthGate>
      <Shell />
    </AuthGate>
  );
}

function Shell() {
  return (
    <HashRouter>
      <ToastProvider>
        <ScrollToTop />
        <SomebodyKeeper />
        <header className="topbar">
          <div className="topbar-inner">
            <NavLink to="/" className="brand" end>
              <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={28} height={28} />
              CatLog
            </NavLink>
            <div className="topbar-right">
              <SyncIndicator />
              <nav className="topnav" aria-label="Main">
                <NavLink to="/" end>
                  Calendar
                </NavLink>
                <NavLink to="/quick">Quick add</NavLink>
                <NavLink to="/events">Events</NavLink>
                <NavLink to="/cats">Cats</NavLink>
                <NavLink to="/settings">Settings</NavLink>
              </nav>
            </div>
          </div>
        </header>
        <main className="main">
          <Routes>
            <Route path="/" element={<CalendarPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/events/:eventId" element={<EventPage />} />
            <Route path="/cats" element={<CatsPage />} />
            <Route path="/cats/:catId" element={<CatPage />} />
            <Route path="/quick" element={<QuickPage />} />
            <Route path="/add" element={<AddPage />} />
            <Route path="/added/:eventId" element={<AddedRoute />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Empty icon="🧭" title="Page not found" />} />
          </Routes>
        </main>
        <nav className="tabbar" aria-label="Main">
          <NavLink to="/" end>
            <span aria-hidden>📅</span>Calendar
          </NavLink>
          <NavLink to="/quick">
            <span aria-hidden>⚡</span>Quick
          </NavLink>
          <NavLink to="/events">
            <span aria-hidden>🔎</span>Events
          </NavLink>
          <NavLink to="/cats">
            <span aria-hidden>🐱</span>Cats
          </NavLink>
          <NavLink to="/settings">
            <span aria-hidden>⚙️</span>Settings
          </NavLink>
        </nav>
      </ToastProvider>
    </HashRouter>
  );
}
