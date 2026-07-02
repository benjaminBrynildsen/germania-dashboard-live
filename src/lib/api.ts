async function request(url: string, options?: RequestInit) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || `Request failed: ${res.status}`);
    // Expose the response so callers can act on structured errors (e.g. 409 details).
    (err as any).status = res.status;
    (err as any).body = data;
    throw err;
  }
  return res.json();
}

export const api = {
  get: (url: string) => request(url),
  post: (url: string, body?: any) => request(url, { method: 'POST', body: JSON.stringify(body) }),
  put: (url: string, body?: any) => request(url, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (url: string, body?: any) => request(url, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (url: string) => request(url, { method: 'DELETE' }),
};
