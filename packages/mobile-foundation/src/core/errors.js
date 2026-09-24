// Friendly messages for API/client error codes. Server messages are already user-safe; these cover the
// client-side codes and give consistent wording on poor networks (spec §40).
const MESSAGES = {
  NETWORK_ERROR: "You're offline or the network is unstable. Check your connection and try again.",
  TIMEOUT: 'This is taking too long. Please try again.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment.',
  INTERNAL: 'Something went wrong on our side. Please try again.',
};

/** @param {unknown} err */
export function userMessage(err) {
  const e = /** @type {any} */ (err);
  if (e && MESSAGES[e.code]) return MESSAGES[e.code];
  if (e?.message && typeof e.status === 'number') return e.message;
  return MESSAGES.INTERNAL;
}

/** @param {unknown} err seconds to wait before retrying, when the server said so */
export function retryAfterSec(err) {
  const v = /** @type {any} */ (err)?.details?.retryAfterSec;
  return Number.isFinite(v) ? v : null;
}
