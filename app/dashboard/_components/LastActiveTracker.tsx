"use client";

import { useEffect } from "react";

const ENDPOINT = "/api/profile/last-active";
const MIN_TOUCH_DELAY_MS = 5 * 60 * 1000;
const HEARTBEAT_DELAY_MS = 10 * 60 * 1000;

export default function LastActiveTracker() {
  useEffect(() => {
    let lastRecordedAt = 0;
    let requestInFlight = false;

    function touchLastActive() {
      if (document.visibilityState === "hidden" || requestInFlight) return;
      if (Date.now() - lastRecordedAt < MIN_TOUCH_DELAY_MS) return;

      requestInFlight = true;
      void fetch(ENDPOINT, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        keepalive: true,
      }).then(async (response) => {
        if (response.ok && (await response.json()).ok === true) {
          lastRecordedAt = Date.now();
        }
      }).catch(() => {
        // The next activity event can retry the write.
      }).finally(() => {
        requestInFlight = false;
      });
    }

    touchLastActive();
    const interval = window.setInterval(touchLastActive, HEARTBEAT_DELAY_MS);

    window.addEventListener("focus", touchLastActive);
    window.addEventListener("online", touchLastActive);
    document.addEventListener("visibilitychange", touchLastActive);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", touchLastActive);
      window.removeEventListener("online", touchLastActive);
      document.removeEventListener("visibilitychange", touchLastActive);
    };
  }, []);

  return null;
}
