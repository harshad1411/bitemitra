'use client';

// Requests that are not JSON: multipart uploads and private file downloads. The access token only ever
// lives in memory (DECISIONS D-22); an expired token is refreshed once and the request retried with the
// same Idempotency-Key, so a retry can never create a second upload.
import { api, apiUrl, getAccessTokenForUpload } from './api';

const baseHeaders = () => ({
  'x-app-id': 'ADMIN',
  'x-platform': 'WEB',
  authorization: `Bearer ${getAccessTokenForUpload()}`,
});

async function withRefresh(send) {
  let res = await send();
  if (res.status === 401 && (await api.refreshSession())) res = await send();
  return res;
}

/** POST multipart/form-data; resolves with the JSON body or throws an error shaped like ApiError. */
export async function uploadForm(path, formData) {
  const idempotencyKey = crypto.randomUUID();
  const res = await withRefresh(() =>
    fetch(apiUrl(path), {
      method: 'POST',
      body: formData,
      headers: { ...baseHeaders(), 'idempotency-key': idempotencyKey },
    }),
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error?.message ?? 'Upload failed'), json.error ?? {});
  return json;
}

/** Opens a private file (e.g. a KYC document) in a new tab without exposing a public URL. */
export async function openPrivateFile(path) {
  const res = await withRefresh(() => fetch(apiUrl(path), { headers: baseHeaders() }));
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw Object.assign(new Error(json.error?.message ?? 'Could not open the file'), json.error ?? {});
  }
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
