const ENTER_TO_SEND_KEY = 'khidki.chat.enter-to-send';

function defaultEnterToSendPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  try {
    return !window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return true;
  }
}

/** Read this browser's Enter-key preference; default to the existing mobile behavior. */
export function readEnterToSendPreference(): boolean {
  if (typeof window === 'undefined') return true;

  try {
    const stored = window.localStorage.getItem(ENTER_TO_SEND_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // Use the device-aware default when local storage is unavailable.
  }

  return defaultEnterToSendPreference();
}

/** Save the chat preference locally without sending it to the server. */
export function writeEnterToSendPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ENTER_TO_SEND_KEY, String(enabled));
  } catch {
    // Preference persistence is optional in private or storage-restricted browsers.
  }
}
