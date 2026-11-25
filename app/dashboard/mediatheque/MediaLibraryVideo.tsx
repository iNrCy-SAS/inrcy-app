"use client";

import { useRef, useState, type VideoHTMLAttributes } from "react";

type Props = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & { src?: string; unavailableLabel: string };

function Playback({ src, unavailableLabel, onError, onStalled, onLoadedMetadata, onPlay, onPause, ...props }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryCount = useRef(0);
  const playback = useRef({ time: 0, playing: false });
  let renewed: string | null = null;
  if (src && typeof window !== "undefined") {
    try {
      const url = new URL(src, window.location.origin);
      if (url.origin === window.location.origin && /^\/api\/media-library\/items\/[a-f0-9-]{36}\/content$/.test(url.pathname)) {
        url.searchParams.set("playbackRetry", "1");
        renewed = `${url.pathname}${url.search}`;
      }
    } catch { /* Provider and malformed URLs cannot be renewed here. */ }
  }
  const renewPlayback = (video: HTMLVideoElement, playing: boolean) => {
    if (!renewed || retryCount.current !== 0) return false;
    playback.current = {
      time: Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0,
      playing,
    };
    retryCount.current = 1;
    setAttempt(1);
    return true;
  };
  if (failed || !src) return <span role="status" className={props.className} style={{ ...props.style, display: "grid", placeItems: "center" }}>{unavailableLabel}</span>;
  return <video {...props} key={attempt} src={attempt && renewed ? renewed : src}
    onPlay={event => {
      if (attempt !== retryCount.current) return;
      playback.current.playing = true;
      onPlay?.(event);
    }}
    onPause={event => {
      if (attempt !== retryCount.current) return;
      if (!event.currentTarget.error) playback.current.playing = false;
      onPause?.(event);
    }}
    onLoadedMetadata={event => {
      if (attempt !== retryCount.current) return;
      if (attempt) {
        const video = event.currentTarget;
        try { if (playback.current.time > 0) video.currentTime = Number.isFinite(video.duration) ? Math.min(playback.current.time, video.duration) : playback.current.time; } catch { /* Some streams do not support seeking. */ }
        if (playback.current.playing) void video.play().catch(() => {});
      }
      onLoadedMetadata?.(event);
    }}
    onStalled={event => {
      if (attempt !== retryCount.current) return;
      const video = event.currentTarget;
      const playing = !video.paused && !video.ended;
      // A delayed Range request can stall while Chromium keeps the old redirect.
      // Only renew an active seek or playback that already had media metadata.
      if (props.controls && (video.seeking || (playing && video.currentTime > 0)) &&
          video.readyState >= HTMLMediaElement.HAVE_METADATA && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        renewPlayback(video, playing);
      }
      onStalled?.(event);
    }}
    onError={event => {
      // Ignore a second event from the old element while React mounts its replacement.
      if (attempt !== retryCount.current) return;
      const video = event.currentTarget;
      const recoverable = !video.error?.code || video.error.code === 2 || video.error.code === 4;
      if (!recoverable || !renewPlayback(video, playback.current.playing || (!video.paused && !video.ended))) setFailed(true);
      onError?.(event);
    }} />;
}

/** A stable authenticated URL can renew an expired storage redirect once. */
export default function MediaLibraryVideo(props: Props) {
  return <Playback key={props.src || ""} {...props} />;
}
