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

export default function App() {
  const { user, loading, logout } = useAuth();
  const { pathname } = useLocation();

  // Public routes that bypass the auth wall (Google verification needs them
  // reachable without a session).
  if (pathname === '/privacy') {
    return <Privacy />;
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        background: '#f0f0f3',
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
        <Route path="/" element={<Dashboard />} />
        <Route path="/launch/new" element={<NewLaunch />} />
        <Route path="/launch/:id" element={<LaunchDetail />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/locations/:id" element={<LocationDetail />} />
        <Route path="/locations/:id/reviews" element={<GoogleReviews />} />
        <Route path="/ticket-time" element={<TicketTime />} />
        <Route path="/anomalies" element={<SalesAnomaly />} />
        <Route path="/weather-closure" element={<WeatherClosure />} />
        <Route path="/cog" element={<CogManager />} />
        <Route path="/weekly-sales" element={<WeeklySales />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
