import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';

const PHASES = [
  {
    key: 'ideation',
    label: 'Ideation & Voting',
    icon: '01',
    drinkStatuses: ['idea', 'voting'],
    taskCategories: [],
    description: 'Collect drink ideas from staff and vote on submissions',
  },
  {
    key: 'development',
    label: 'Recipe Development',
    icon: '02',
    drinkStatuses: ['approved', 'in_development'],
    taskCategories: [],
    description: 'Wednesday iterations to perfect each recipe',
  },
  {
    key: 'pre_production',
    label: 'Pre-Production',
    icon: '03',
    drinkStatuses: [],
    taskCategories: ['photo_shoot', 'social_media', 'eventbrite', 'menu_panels'],
    description: 'Photo shoots, social content, Eventbrite, menu panels',
  },
  {
    key: 'launch_prep',
    label: 'Launch Prep',
    icon: '04',
    drinkStatuses: [],
    taskCategories: ['sops', 'dripos_buttons', 'menu_tasting', 'sauces', 'delivery', 'other'],
    description: 'SOPs, Dripos, tasting event, sauces & delivery',
  },
  {
    key: 'launch',
    label: 'Launch & Beyond',
    icon: '05',
    drinkStatuses: ['finalized'],
    taskCategories: [],
    description: 'Menu goes live, staff quizzes, wrap up',
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  photo_shoot: 'Photo Shoot', social_media: 'Social Media', eventbrite: 'Eventbrite',
  menu_tasting: 'Menu Tasting', sops: 'SOPs', dripos_buttons: 'Dripos',
  menu_panels: 'Menu Panels', sauces: 'Sauces', delivery: 'Delivery', other: 'Other',
};

const DRINK_NEXT: Record<string, string> = {
  idea: 'voting', voting: 'approved', approved: 'in_development', in_development: 'finalized',
};

interface Launch {
  id: number; name: string; season: string; year: number;
  launch_date: string | null; status: string;
  idea_form_id: string | null; voting_form_id: string | null;
  drive_folder_id: string | null;
}
interface Drink {
  id: number; name: string; description: string; submitted_by: string;
  assigned_to: number | null; assigned_to_name: string | null;
  status: string; votes_yes: number; votes_no: number;
}
interface Task {
  id: number; title: string; category: string; due_date: string;
  assigned_to_name: string | null; completed: number; notes: string;
}

export default function LaunchDetail() {
  const { id } = useParams();
  const [launch, setLaunch] = useState<Launch | null>(null);
  const [drinks, setDrinks] = useState<Drink[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [openPhase, setOpenPhase] = useState<string | null>(null);
  const [showAddDrink, setShowAddDrink] = useState(false);
  const [drinkForm, setDrinkForm] = useState({ name: '', description: '', submitted_by: '' });

  useEffect(() => {
    Promise.all([
      api.get(`/api/launches/${id}`),
      api.get(`/api/launches/${id}/drinks`),
      api.get(`/api/launches/${id}/tasks`),
    ]).then(([l, d, t]) => { setLaunch(l); setDrinks(d); setTasks(t); }).finally(() => setLoading(false));
  }, [id]);

  if (loading || !launch) return <div style={{ color: 'rgba(0,0,0,0.3)', padding: 40 }}>Loading...</div>;

  const completedTasks = tasks.filter(t => t.completed).length;
  const daysToLaunch = launch.launch_date
    ? Math.ceil((new Date(launch.launch_date).getTime() - Date.now()) / 86400000) : null;

  const toggleTask = async (taskId: number, completed: boolean) => {
    const updated = await api.patch(`/api/tasks/${taskId}`, { completed: !completed });
    setTasks(tasks.map(t => t.id === taskId ? { ...t, ...updated } : t));
  };

  const updateDrinkStatus = async (drinkId: number, status: string) => {
    const updated = await api.patch(`/api/drinks/${drinkId}`, { status });
    setDrinks(drinks.map(d => d.id === drinkId ? { ...d, ...updated } : d));
  };

  const addDrink = async (e: React.FormEvent) => {
    e.preventDefault();
    const drink = await api.post(`/api/launches/${launch.id}/drinks`, drinkForm);
    setDrinks([...drinks, drink]);
    setDrinkForm({ name: '', description: '', submitted_by: '' });
    setShowAddDrink(false);
  };

  const getPhaseData = (phase: typeof PHASES[0]) => {
    const d = drinks.filter(dr => phase.drinkStatuses.includes(dr.status));
    const t = tasks.filter(ta => phase.taskCategories.includes(ta.category));
    return { drinks: d, tasks: t, done: t.filter(x => x.completed).length };
  };

  const getActivePhaseIndex = () => {
    for (let i = 0; i < PHASES.length; i++) {
      const data = getPhaseData(PHASES[i]);
      if (data.tasks.some(t => !t.completed) || data.drinks.length > 0) return i;
    }
    return PHASES.length - 1;
  };
  const activeIdx = getActivePhaseIndex();

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <Link to="/" style={{ fontSize: 13, color: 'rgba(0,0,0,0.3)', display: 'inline-block', marginBottom: 12 }}>
        &larr; Back
      </Link>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.8, color: '#111' }}>{launch.name}</h1>
          <p style={{ color: 'rgba(0,0,0,0.4)', fontSize: 14, marginTop: 6 }}>
            {launch.season} {launch.year}
            {launch.launch_date && ` \u2022 ${new Date(launch.launch_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`}
          </p>
        </div>
        <button onClick={() => setShowAddDrink(!showAddDrink)} className="btn btn-primary">+ Add Drink</button>
      </div>

      {/* Stat bar */}
      <div style={{
        display: 'flex', gap: 24, marginBottom: 32, padding: '18px 24px',
        background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,0.06)',
        flexWrap: 'wrap',
      }}>
        {daysToLaunch !== null && (
          <StatBlock label="Days to Launch" value={daysToLaunch < 0 ? 'Overdue' : String(daysToLaunch)}
            accent={daysToLaunch <= 7} />
        )}
        <StatBlock label="Drinks" value={String(drinks.length)} />
        <StatBlock label="Tasks" value={`${completedTasks} / ${tasks.length}`} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 120 }}>
          <div style={{ width: '100%' }}>
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)', marginBottom: 6 }}>Overall</div>
            <div style={{ width: '100%', height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.05)' }}>
              <div style={{
                height: '100%', borderRadius: 3, background: '#111',
                width: tasks.length ? `${(completedTasks / tasks.length) * 100}%` : '0%',
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        </div>
      </div>

      {/* Add drink form */}
      {showAddDrink && (
        <form onSubmit={addDrink} style={{
          marginBottom: 24, display: 'flex', gap: 10, flexWrap: 'wrap',
          padding: 20, background: '#fff', borderRadius: 14, border: '1px solid rgba(0,0,0,0.06)',
        }}>
          <div style={{ flex: '1 1 160px' }}>
            <label>Name</label>
            <input placeholder="Lavender Honey Latte" value={drinkForm.name}
              onChange={e => setDrinkForm({ ...drinkForm, name: e.target.value })} required />
          </div>
          <div style={{ flex: '2 1 220px' }}>
            <label>Description</label>
            <input placeholder="Flavor profile" value={drinkForm.description}
              onChange={e => setDrinkForm({ ...drinkForm, description: e.target.value })} required />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <label>By</label>
            <input placeholder="Name" value={drinkForm.submitted_by}
              onChange={e => setDrinkForm({ ...drinkForm, submitted_by: e.target.value })} required />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="submit" className="btn btn-primary">Add</button>
          </div>
        </form>
      )}

      {/* Phase Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {PHASES.map((phase, i) => {
          const data = getPhaseData(phase);
          const isActive = i === activeIdx;
          const isPast = i < activeIdx;
          const isOpen = openPhase === phase.key;
          const totalItems = data.drinks.length + data.tasks.length;
          const taskProgress = data.tasks.length > 0 ? (data.done / data.tasks.length) * 100 : 0;

          return (
            <div key={phase.key} style={{
              background: '#fff',
              borderRadius: 16,
              border: isActive ? '2px solid #111' : '1px solid rgba(0,0,0,0.06)',
              overflow: 'hidden',
              transition: 'border-color 0.2s',
            }}>
              {/* Card header — always visible */}
              <div
                onClick={() => setOpenPhase(isOpen ? null : phase.key)}
                style={{
                  padding: '20px 24px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 20,
                  userSelect: 'none',
                }}
              >
                {/* Phase number */}
                <div style={{
                  width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                  background: isActive ? '#111' : isPast ? 'rgba(0,0,0,0.04)' : 'rgba(0,0,0,0.02)',
                  color: isActive ? '#fff' : isPast ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 700,
                }}>
                  {isPast ? '\u2713' : phase.icon}
                </div>

                {/* Title + description */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <h3 style={{
                      fontSize: 16, fontWeight: 700, color: '#111',
                    }}>
                      {phase.label}
                    </h3>
                    {isActive && (
                      <span style={{
                        fontSize: 10, fontWeight: 600, color: '#fff', background: '#111',
                        padding: '2px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: 0.5,
                      }}>Active</span>
                    )}
                  </div>
                  <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{phase.description}</p>
                </div>

                {/* Right side stats */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0 }}>
                  {data.drinks.length > 0 && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>{data.drinks.length}</div>
                      <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.3)' }}>drinks</div>
                    </div>
                  )}
                  {data.tasks.length > 0 && (
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#111' }}>{data.done}/{data.tasks.length}</div>
                      <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.3)' }}>tasks</div>
                    </div>
                  )}
                  {data.tasks.length > 0 && (
                    <div style={{ width: 60, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.06)' }}>
                      <div style={{
                        width: `${taskProgress}%`, height: '100%', borderRadius: 3,
                        background: taskProgress === 100 ? '#2e7d32' : '#111',
                        transition: 'width 0.3s',
                      }} />
                    </div>
                  )}
                  <div style={{
                    fontSize: 18, color: 'rgba(0,0,0,0.2)', transform: isOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.2s',
                  }}>&#9662;</div>
                </div>
              </div>

              {/* Expanded content */}
              {isOpen && (
                <div onClick={e => e.stopPropagation()} style={{
                  padding: '0 24px 24px',
                  borderTop: '1px solid rgba(0,0,0,0.05)',
                }}>
                  {/* Drinks section */}
                  {data.drinks.length > 0 && (
                    <div style={{ paddingTop: 20 }}>
                      <h4 style={sectionHeader}>Drinks</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {data.drinks.map(drink => (
                          <div key={drink.id} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '14px 16px', borderRadius: 12,
                            background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.04)',
                          }}>
                            <div>
                              <div style={{ fontSize: 14, fontWeight: 600 }}>{drink.name}</div>
                              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginTop: 2 }}>{drink.description}</div>
                              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.25)', marginTop: 4 }}>
                                by {drink.submitted_by}
                                {drink.assigned_to_name && ` \u2022 ${drink.assigned_to_name}`}
                              </div>
                            </div>
                            {DRINK_NEXT[drink.status] && (
                              <button onClick={() => updateDrinkStatus(drink.id, DRINK_NEXT[drink.status])}
                                className="btn btn-primary btn-sm">
                                Advance &rarr;
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Tasks section */}
                  {data.tasks.length > 0 && (
                    <div style={{ paddingTop: 20 }}>
                      <h4 style={sectionHeader}>Tasks</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {data.tasks.map(task => {
                          const overdue = !task.completed && isOverdue(task.due_date);
                          return (
                            <div key={task.id} onClick={() => toggleTask(task.id, !!task.completed)} style={{
                              display: 'flex', alignItems: 'center', gap: 12,
                              padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                              background: task.completed ? 'rgba(0,0,0,0.01)' : overdue ? 'rgba(210,50,50,0.03)' : 'rgba(0,0,0,0.02)',
                              border: overdue ? '1px solid rgba(210,50,50,0.1)' : '1px solid transparent',
                              opacity: task.completed ? 0.5 : 1,
                              transition: 'all 0.15s',
                            }}>
                              <div style={{
                                width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                                border: task.completed ? 'none' : '2px solid rgba(0,0,0,0.12)',
                                background: task.completed ? '#111' : 'transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}>
                                {task.completed && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700 }}>&#10003;</span>}
                              </div>
                              <div style={{ flex: 1 }}>
                                <span style={{
                                  fontSize: 14,
                                  textDecoration: task.completed ? 'line-through' : 'none',
                                }}>{task.title}</span>
                              </div>
                              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.2)' }}>{CATEGORY_LABELS[task.category]}</div>
                                <div style={{
                                  fontSize: 12, fontWeight: 500,
                                  color: overdue ? '#d32f2f' : 'rgba(0,0,0,0.25)',
                                }}>
                                  {new Date(task.due_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Google workspace links */}
                  {phase.key === 'ideation' && (
                    <div style={{ paddingTop: 20 }}>
                      <h4 style={sectionHeader}>Google Workspace</h4>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <FormButton
                          formId={launch.idea_form_id}
                          label="Idea Form"
                          createLabel="Create Idea Form"
                          onCreate={async () => {
                            try {
                              const r = await api.post(`/api/launches/${id}/idea-form`);
                              setLaunch({ ...launch, idea_form_id: r.formId });
                              window.open(r.responderUri, '_blank');
                            } catch {}
                          }}
                        />
                        <FormButton
                          formId={launch.voting_form_id}
                          label="Voting Form"
                          createLabel="Create Voting Form"
                          onCreate={async () => {
                            try {
                              const r = await api.post(`/api/launches/${id}/voting-form`);
                              setLaunch({ ...launch, voting_form_id: r.formId });
                              window.open(r.responderUri, '_blank');
                            } catch {}
                          }}
                        />
                        {launch.drive_folder_id && (
                          <a href={`https://drive.google.com/drive/folders/${launch.drive_folder_id}`}
                            target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                            Drive Folder
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Empty state */}
                  {totalItems === 0 && phase.key !== 'ideation' && (
                    <div style={{ paddingTop: 20, textAlign: 'center', color: 'rgba(0,0,0,0.2)', fontSize: 14 }}>
                      Nothing here yet
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const sectionHeader: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.3)',
  textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
};

function StatBlock({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 800, color: accent ? '#d32f2f' : '#111', letterSpacing: -0.5 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.3)', marginTop: 1 }}>{label}</div>
    </div>
  );
}

function FormButton({ formId, label, createLabel, onCreate }: {
  formId: string | null; label: string; createLabel: string; onCreate: () => void;
}) {
  if (formId) {
    return (
      <a href={`https://docs.google.com/forms/d/${formId}/edit`}
        target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">{label}</a>
    );
  }
  return <button onClick={onCreate} className="btn btn-primary btn-sm">{createLabel}</button>;
}

function isOverdue(dateStr: string): boolean {
  return new Date(dateStr + 'T00:00:00') < new Date(new Date().toDateString());
}
