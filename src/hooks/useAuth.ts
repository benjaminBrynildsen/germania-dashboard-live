import { useState, useEffect } from 'react';
import { api } from '../lib/api';

const IS_GH_PAGES = window.location.hostname.endsWith('github.io');
const DEMO_USER_KEY = 'germania_demo_user';

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (IS_GH_PAGES) {
      const raw = localStorage.getItem(DEMO_USER_KEY);
      if (raw) {
        try { setUser(JSON.parse(raw)); } catch { setUser(null); }
      } else {
        setUser(null);
      }
      setLoading(false);
      return;
    }

    api.get('/api/auth/me')
      .then(data => setUser(data.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = async () => {
    if (IS_GH_PAGES) {
      localStorage.removeItem(DEMO_USER_KEY);
      setUser(null);
      return;
    }

    await api.post('/api/auth/logout');
    setUser(null);
  };

  return { user, loading, logout };
}
