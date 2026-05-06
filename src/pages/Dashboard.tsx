import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useIsMobile } from '../hooks/useIsMobile';

const STATUS_LABELS: Record<string, string> = {
  idea_collection: 'Idea Collection',
  voting: 'Voting',
  finalization: 'Finalization',
  recipe_development: 'Recipe Dev',
  pre_launch: 'Pre-Launch',
  launch: 'Launch Day',
  completed: 'Completed',
};

const STATUS_COLORS: Record<string, string> = {
  idea_collection: 'badge-blue',
  voting: 'badge-gold',
  finalization: 'badge-gold',
  recipe_development: 'badge-blue',
  pre_launch: 'badge-red',
  launch: 'badge-green',
  completed: 'badge-green',
};

const PIPELINE_STAGES = [
  'idea_collection', 'voting', 'finalization',
  'recipe_development', 'pre_launch', 'launch', 'completed'
];

interface Launch {
  id: number;
  name: string;
  season: string;
  year: number;
  launch_date: string | null;
  status: string;
}

export default function Dashboard() {
  const isMobile = useIsMobile();
  const [launches, setLaunches] = useState<Launch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/launches').then(setLaunches).finally(() => setLoading(false));
  }, []);

  const activeLaunches = launches.filter(l => l.status !== 'completed');
  const pastLaunches = launches.filter(l => l.status === 'completed');

  if (loading) return <div style={{ color: 'rgba(0,0,0,0.3)', padding: 40 }}>Loading...</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 12 : 0, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Menu Launches</h1>
          <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 4 }}>
            Track seasonal menus from idea to launch
          </p>
        </div>
        <Link to="/launch/new" className="btn btn-primary">New Launch</Link>
      </div>

      {activeLaunches.length > 0 && (
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.35)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>
            Active
          </h2>
          <div style={{ display: 'grid', gap: 14 }}>
            {activeLaunches.map(launch => (
              <LaunchCard key={launch.id} launch={launch} isMobile={isMobile} />
            ))}
          </div>
        </section>
      )}

      {activeLaunches.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 60 }}>
          <p style={{ color: 'rgba(0,0,0,0.3)', fontSize: 16, marginBottom: 20 }}>
            No active launches yet
          </p>
          <Link to="/launch/new" className="btn btn-primary">Create Your First Launch</Link>
        </div>
      )}

      {pastLaunches.length > 0 && (
        <section>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.35)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>
            Past Launches
          </h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {pastLaunches.map(launch => (
              <LaunchCard key={launch.id} launch={launch} isMobile={isMobile} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function LaunchCard({ launch, isMobile }: { launch: Launch; isMobile: boolean }) {
  const stageIndex = PIPELINE_STAGES.indexOf(launch.status);
  const progress = ((stageIndex + 1) / PIPELINE_STAGES.length) * 100;

  return (
    <Link to={`/launch/${launch.id}`} className="card" style={{ display: 'block', cursor: 'pointer' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 10 : 0, marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600, letterSpacing: -0.2 }}>{launch.name}</h3>
          <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 13, marginTop: 2 }}>
            {launch.season} {launch.year}
            {launch.launch_date && ` \u2022 Launch: ${new Date(launch.launch_date + 'T00:00:00').toLocaleDateString()}`}
          </p>
        </div>
        <span className={`badge ${STATUS_COLORS[launch.status]}`}>
          {STATUS_LABELS[launch.status]}
        </span>
      </div>
      <div className="progress-bar">
        <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.25)' }}>Pipeline</span>
        <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.25)' }}>{Math.round(progress)}%</span>
      </div>
    </Link>
  );
}
