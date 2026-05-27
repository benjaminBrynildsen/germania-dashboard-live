import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import LaunchDetail from './pages/LaunchDetail';
import NewLaunch from './pages/NewLaunch';
import Locations from './pages/Locations';
import LocationDetail from './pages/LocationDetail';
import GoogleReviews from './pages/GoogleReviews';
import TicketTime from './pages/TicketTime';
import SalesAnomaly from './pages/SalesAnomaly';
import WeatherClosure from './pages/WeatherClosure';
import CogManager from './pages/CogManager';
import WeeklySales from './pages/WeeklySales';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import Applicants from './pages/Applicants';
import HoursWatch from './pages/HoursWatch';
import Staffing from './pages/Staffing';
import BakeHaus from './pages/BakeHaus';
import Patrons from './pages/Patrons';
import HolidayCalendar from './pages/HolidayCalendar';
import Pairings from './pages/Pairings';
import MenuTeam from './pages/MenuTeam';
import MenuTeamEdit from './pages/MenuTeam/EditView';
import MenuTeamPresets from './pages/MenuTeam/PresetsView';
import MenuBoards from './pages/MenuBoards';

export default function App() {
  const { user, loading, logout } = useAuth();
  const { pathname } = useLocation();

  // Public routes that bypass the auth wall (Google verification needs them
  // reachable without a session).
  if (pathname === '/privacy') {
    return <Privacy />;
  }
  if (pathname === '/terms') {
    return <Terms />;
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#ffffff',
      }}>
        <div style={{ textAlign: 'center' }}>
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" style={{ height: 44, marginBottom: 16, opacity: 0.4 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          <div style={{ color: 'rgba(0,0,0,0.3)', fontSize: 14 }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <Layout user={user} onLogout={logout}>
      <Routes>
        {/* Home = Dashboard (was /weekly-sales). The original Launches
            list moves to /launches; /weekly-sales kept as an alias so any
            saved bookmarks still resolve. */}
        <Route path="/" element={<WeeklySales />} />
        <Route path="/weekly-sales" element={<WeeklySales />} />
        <Route path="/launches" element={<Dashboard />} />
        <Route path="/launch/new" element={<NewLaunch />} />
        <Route path="/launch/:id" element={<LaunchDetail />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/locations/:id" element={<LocationDetail />} />
        <Route path="/locations/:id/reviews" element={<GoogleReviews />} />
        <Route path="/ticket-time" element={<TicketTime />} />
        <Route path="/anomalies" element={<SalesAnomaly />} />
        <Route path="/weather-closure" element={<WeatherClosure />} />
        <Route path="/cog" element={<CogManager />} />
        <Route path="/applicants" element={<Applicants />} />
        <Route path="/staffing" element={<Staffing />} />
        <Route path="/bake-haus" element={<BakeHaus />} />
        <Route path="/patrons" element={<Patrons />} />
        <Route path="/holidays" element={<HolidayCalendar />} />
        <Route path="/pairings" element={<Pairings />} />
        <Route path="/menu-boards" element={<MenuBoards />} />
        <Route path="/menu-boards/:id" element={<MenuBoards />} />
        <Route path="/menu-team" element={<MenuTeam />} />
        <Route path="/menu-team/presets" element={<MenuTeamPresets />} />
        <Route path="/menu-team/:slug" element={<MenuTeamEdit />} />
        {/* Legacy alias so old /hours bookmarks still resolve. */}
        <Route path="/hours" element={<HoursWatch />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
