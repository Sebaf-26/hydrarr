const BASE = import.meta.env.VITE_API_BASE_URL || "";

export async function apiFetch(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const msg = await safeJson(res);
    throw new Error(msg?.error || `Request failed (${res.status})`);
  }
  return res.json();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function toTitle(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
