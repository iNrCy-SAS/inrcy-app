export const BROWSER_SIGN_OUT_START_EVENT = "inrcy:browser-sign-out-start";

let browserSignOutInProgress = false;

export function beginBrowserSignOut() {
  browserSignOutInProgress = true;

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(BROWSER_SIGN_OUT_START_EVENT));
  }
}

export function cancelBrowserSignOut() {
  browserSignOutInProgress = false;
}

export function isBrowserSignOutInProgress() {
  return browserSignOutInProgress;
}
