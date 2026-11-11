let sessionToken: string | undefined;
export async function api<T>(path: string, input?: unknown, signal?: AbortSignal): Promise<T> {
  if (input !== undefined && !sessionToken) {
    const response = await fetch('/api/session', {
      signal
    });
    if (!response.ok) throw new Error('NETWORK_ERROR');
    sessionToken = (await response.json()).token;
  }
  let response: Response;
  try {
    response = await fetch(`/api${path}`, input === undefined ? {
      signal
    } : {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Followup-Session': sessionToken!
      },
      body: JSON.stringify(input),
      signal
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('NETWORK_ERROR');
  }
  const data = await response.json();
  if (!response.ok) {
    if (data.error === 'INVALID_SESSION') sessionToken = undefined;
    throw new Error(data.error ?? 'INTERNAL_ERROR');
  }
  return data as T;
}
