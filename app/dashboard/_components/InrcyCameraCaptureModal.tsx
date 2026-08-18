import { useTranslations } from "next-intl";
import React from "react";
import { createPortal } from "react-dom";
import { INR_MEDIA_VIDEO_SOURCE_MAX_BYTES } from "@/lib/mediaRules";

function buildPhotoFileName() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  return `photo-inrcy-${stamp}.jpg`;
}

const DEFAULT_MAX_VIDEO_BYTES = INR_MEDIA_VIDEO_SOURCE_MAX_BYTES;

function formatMegabytes(bytes: number) {
  const mb = Math.max(1, Math.round(Number(bytes || 0) / (1024 * 1024)));
  return `${mb} Mo`;
}

type CameraMode = "photo" | "video";
type RecordingState = "idle" | "recording" | "saving";

const recordedVideoMimeCandidates = [
  "video/mp4;codecs=h264,aac",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function getSupportedRecordedVideoMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    recordedVideoMimeCandidates.find((type) =>
      MediaRecorder.isTypeSupported(type),
    ) || ""
  );
}

function buildVideoFileName(mimeType: string) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+$/, "")
    .replace("T", "-");
  const normalizedMimeType = mimeType.toLowerCase();
  const extension = normalizedMimeType.includes("mp4") ? "mp4" : "webm";
  return `video-inrcy-${stamp}.${extension}`;
}

function formatRecordingSeconds(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

type InrcyCameraCaptureModalProps = {
  open: boolean;
  title?: string;
  onClose: () => void;
  onCapture: (file: File) => void | Promise<void>;
  allowVideo?: boolean;
  initialMode?: CameraMode;
  maxVideoBytes?: number;
  maxVideoSeconds?: number | null;
};

type ZoomCapability = {
  min?: number;
  max?: number;
  step?: number;
};

type ExtendedCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: ZoomCapability | number;
};

type PointerPoint = {
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getPointerDistance(points: PointerPoint[]) {
  if (points.length < 2) return 0;
  const dx = points[0].x - points[1].x;
  const dy = points[0].y - points[1].y;
  return Math.hypot(dx, dy);
}

export default function InrcyCameraCaptureModal({
  open,
  title = "Prendre une photo",
  onClose,
  onCapture,
  allowVideo = true,
  initialMode = "photo",
  maxVideoBytes = DEFAULT_MAX_VIDEO_BYTES,
  maxVideoSeconds = null,
}: InrcyCameraCaptureModalProps) {
  const i18nT = useTranslations("media");
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const recordedChunksRef = React.useRef<Blob[]>([]);
  const recordedBytesRef = React.useRef(0);
  const recordingTimerRef = React.useRef<number | null>(null);
  const recordingStartedAtRef = React.useRef(0);
  const cancelRecordingRef = React.useRef(false);
  const recordingOversizedRef = React.useRef(false);
  const mountedRef = React.useRef(false);
  const pointersRef = React.useRef<Map<number, PointerPoint>>(new Map());
  const pinchStartRef = React.useRef<{ distance: number; zoom: number } | null>(
    null,
  );

  const [phase, setPhase] = React.useState<
    "idle" | "loading" | "ready" | "capturing" | "error"
  >("idle");
  const [cameraMode, setCameraMode] = React.useState<CameraMode>(
    allowVideo ? initialMode : "photo",
  );
  const [recordingState, setRecordingState] =
    React.useState<RecordingState>("idle");
  const [recordingSeconds, setRecordingSeconds] = React.useState(0);
  const [error, setError] = React.useState("");
  const [facingMode, setFacingMode] = React.useState<"environment" | "user">(
    "environment",
  );
  const [hasMultipleCameras, setHasMultipleCameras] = React.useState(true);
  const [isLandscapeViewport, setIsLandscapeViewport] = React.useState(false);
  const [isMobileCameraViewport, setIsMobileCameraViewport] =
    React.useState(false);
  const [torchSupported, setTorchSupported] = React.useState(false);
  const [torchOn, setTorchOn] = React.useState(false);
  const [hardwareZoomSupported, setHardwareZoomSupported] =
    React.useState(false);
  const [zoom, setZoom] = React.useState(1);
  const [zoomLimits, setZoomLimits] = React.useState({
    min: 1,
    max: 4,
    step: 0.05,
  });
  const [flashNotice, setFlashNotice] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    setCameraMode(allowVideo ? initialMode : "photo");
    setRecordingState("idle");
    setRecordingSeconds(0);
  }, [allowVideo, initialMode, open]);

  React.useEffect(() => {
    if (!open || typeof window === "undefined") return;

    const updateViewport = () => {
      const coarsePointer =
        window.matchMedia?.("(pointer: coarse)").matches ?? false;
      setIsLandscapeViewport(window.innerWidth > window.innerHeight);
      setIsMobileCameraViewport(coarsePointer || window.innerWidth <= 820);
    };

    updateViewport();
    window.addEventListener("resize", updateViewport);
    window.addEventListener("orientationchange", updateViewport);

    return () => {
      window.removeEventListener("resize", updateViewport);
      window.removeEventListener("orientationchange", updateViewport);
    };
  }, [open]);

  React.useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined")
      return;

    const dispatchCameraState = (active: boolean) => {
      document.documentElement.dataset.inrcyCameraCaptureActive = active
        ? "true"
        : "false";
      window.dispatchEvent(
        new CustomEvent("inrcy-camera-capture-active", { detail: { active } }),
      );
    };

    if (open) {
      dispatchCameraState(true);
      return () => {
        dispatchCameraState(false);
      };
    }

    dispatchCameraState(false);
  }, [open]);

  React.useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [open]);

  const applyTorch = React.useCallback(async (enabled: boolean) => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: enabled }] as unknown as MediaTrackConstraintSet[],
      });
      setTorchOn(enabled);
    } catch (err) {
      console.warn("inrcy_camera_torch_apply_failed", err);
      setTorchOn(false);
      setTorchSupported(false);
      setFlashNotice(i18nT("flash_indisponible_sur_cet_appareil_9eac5eab"));
      window.setTimeout(() => setFlashNotice(""), 1800);
    }
  }, []);

  const stopStream = React.useCallback(() => {
    const activeRecorder = mediaRecorderRef.current;
    if (activeRecorder && activeRecorder.state !== "inactive") {
      cancelRecordingRef.current = true;
      try {
        activeRecorder.stop();
      } catch {
        // Best effort.
      }
    }

    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    recordedBytesRef.current = 0;
    recordingOversizedRef.current = false;
    setRecordingState("idle");
    setRecordingSeconds(0);

    const stream = streamRef.current;
    streamRef.current = null;

    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Best effort.
        }
      });
    }

    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        // Best effort.
      }
    }

    pointersRef.current.clear();
    pinchStartRef.current = null;
    setTorchOn(false);
    setTorchSupported(false);
    setFlashNotice("");
    setHardwareZoomSupported(false);
    setZoom(1);
  }, []);

  const applyZoom = React.useCallback(
    async (nextZoom: number) => {
      const normalizedZoom = clamp(nextZoom, zoomLimits.min, zoomLimits.max);
      setZoom(normalizedZoom);

      if (!hardwareZoomSupported) return;

      const track = streamRef.current?.getVideoTracks()[0];
      if (!track) return;

      try {
        await track.applyConstraints({
          advanced: [
            { zoom: normalizedZoom },
          ] as unknown as MediaTrackConstraintSet[],
        });
      } catch {
        setHardwareZoomSupported(false);
      }
    },
    [hardwareZoomSupported, zoomLimits.max, zoomLimits.min],
  );

  const readCameraCapabilities = React.useCallback(
    (stream: MediaStream) => {
      const track = stream.getVideoTracks()[0];
      if (!track || typeof track.getCapabilities !== "function") {
        setTorchSupported(false);
        setHardwareZoomSupported(false);
        setZoomLimits({ min: 1, max: 4, step: 0.05 });
        setZoom(1);
        return;
      }

      try {
        const capabilities = track.getCapabilities() as ExtendedCapabilities;
        const zoomCapability = capabilities.zoom;
        const nextTorchSupported =
          Boolean(capabilities.torch) && facingMode === "environment";
        let nextZoomLimits = { min: 1, max: 4, step: 0.05 };
        let nextHardwareZoomSupported = false;

        if (typeof zoomCapability === "object" && zoomCapability !== null) {
          const min = Number.isFinite(zoomCapability.min)
            ? Number(zoomCapability.min)
            : 1;
          const max = Number.isFinite(zoomCapability.max)
            ? Number(zoomCapability.max)
            : 4;
          const step = Number.isFinite(zoomCapability.step)
            ? Number(zoomCapability.step)
            : 0.05;
          nextHardwareZoomSupported = max > min;
          nextZoomLimits = {
            min: Math.max(1, min),
            max: Math.max(1, max),
            step: Math.max(0.01, step),
          };
        }

        setTorchSupported(nextTorchSupported);
        setHardwareZoomSupported(nextHardwareZoomSupported);
        setZoomLimits(nextZoomLimits);
        setZoom(nextZoomLimits.min || 1);
      } catch {
        setTorchSupported(false);
        setHardwareZoomSupported(false);
        setZoomLimits({ min: 1, max: 4, step: 0.05 });
        setZoom(1);
      }
    },
    [facingMode],
  );

  const startCamera = React.useCallback(async () => {
    if (!open) return;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setPhase("error");
      setError(
        cameraMode === "video"
          ? "Caméra indisponible sur ce navigateur. Importez une vidéo à la place."
          : "Caméra indisponible sur ce navigateur. Importez une image à la place.",
      );
      return;
    }

    if (cameraMode === "video" && typeof MediaRecorder === "undefined") {
      setPhase("error");
      setError(
        i18nT("l_enregistrement_video_n_est_pas_54fbe6f6"),
      );
      return;
    }

    setPhase("loading");
    setError("");
    stopStream();

    try {
      let stream: MediaStream;
      const audioConstraint = cameraMode === "video";
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: true,
        });
      }

      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(
          (device) => device.kind === "videoinput",
        );
        setHasMultipleCameras(videoInputs.length !== 1);
      } catch {
        setHasMultipleCameras(true);
      }

      readCameraCapabilities(stream);

      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play().catch(() => undefined);
      }
      setPhase("ready");
    } catch (err) {
      console.warn("inrcy_camera_open_failed", err);
      stopStream();
      setPhase("error");
      setError(
        cameraMode === "video"
          ? "Autorisez la caméra et le micro ou importez une vidéo à la place."
          : "Autorisez la caméra ou importez une image à la place.",
      );
    }
  }, [cameraMode, facingMode, open, readCameraCapabilities, stopStream]);

  React.useEffect(() => {
    mountedRef.current = true;
    if (open) void startCamera();
    return () => {
      mountedRef.current = false;
      stopStream();
    };
  }, [open, startCamera, stopStream]);

  React.useEffect(() => {
    if (!open) {
      setPhase("idle");
      setError("");
      stopStream();
    }
  }, [open, stopStream]);

  const clearRecordingTimer = React.useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const stopActiveRecording = React.useCallback(
    (cancel = false) => {
      cancelRecordingRef.current = cancel;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
          return true;
        } catch {
          // Continue cleanup below.
        }
      }
      clearRecordingTimer();
      mediaRecorderRef.current = null;
      setRecordingState("idle");
      setRecordingSeconds(0);
      return false;
    },
    [clearRecordingTimer],
  );

  const close = React.useCallback(() => {
    stopActiveRecording(true);
    void applyTorch(false).finally(() => {
      stopStream();
      onClose();
    });
  }, [applyTorch, onClose, stopActiveRecording, stopStream]);

  const capture = React.useCallback(async () => {
    if (phase !== "ready") return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    if (!width || !height) {
      setError(i18nT("image_camera_indisponible_reessayez_ou_importez_91edfa05"));
      setPhase("error");
      return;
    }

    setPhase("capturing");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setPhase("error");
      setError(i18nT("capture_impossible_sur_ce_navigateur_85e428b9"));
      return;
    }

    context.save();
    if (facingMode === "user") {
      context.translate(width, 0);
      context.scale(-1, 1);
    }

    if (!hardwareZoomSupported && zoom > 1) {
      const sourceWidth = width / zoom;
      const sourceHeight = height / zoom;
      const sourceX = (width - sourceWidth) / 2;
      const sourceY = (height - sourceHeight) / 2;
      context.drawImage(
        video,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        width,
        height,
      );
    } else {
      context.drawImage(video, 0, 0, width, height);
    }
    context.restore();

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });

    if (!blob) {
      setPhase("error");
      setError(i18nT("capture_impossible_importez_une_image_a_746d40fd"));
      return;
    }

    const file = new File([blob], buildPhotoFileName(), { type: "image/jpeg" });
    await applyTorch(false);
    await onCapture(file);
    close();
  }, [
    applyTorch,
    close,
    facingMode,
    hardwareZoomSupported,
    onCapture,
    phase,
    zoom,
  ]);

  const startVideoRecording = React.useCallback(() => {
    if (phase !== "ready" || cameraMode !== "video") return;
    if (typeof MediaRecorder === "undefined") {
      setError(
        i18nT("l_enregistrement_video_n_est_pas_54fbe6f6"),
      );
      setPhase("error");
      return;
    }

    const stream = streamRef.current;
    if (!stream) return;
    if (!stream.getAudioTracks().length) {
      setError(
        i18nT("micro_indisponible_autorisez_le_micro_pour_41f094c3"),
      );
      return;
    }

    try {
      const mimeType = getSupportedRecordedVideoMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      recordedChunksRef.current = [];
      recordedBytesRef.current = 0;
      recordingOversizedRef.current = false;
      cancelRecordingRef.current = false;
      mediaRecorderRef.current = recorder;
      recordingStartedAtRef.current = Date.now();
      setRecordingSeconds(0);
      setRecordingState("recording");
      setError("");

      recorder.ondataavailable = (event) => {
        if (!event.data?.size) return;
        recordedChunksRef.current.push(event.data);
        recordedBytesRef.current += event.data.size;
        if (recordedBytesRef.current > maxVideoBytes) {
          recordingOversizedRef.current = true;
          stopActiveRecording(false);
        }
      };

      recorder.onerror = () => {
        clearRecordingTimer();
        setRecordingState("idle");
        setError(i18nT("enregistrement_video_interrompu_merci_de_reessay_d964ee55"));
      };

      recorder.onstop = () => {
        const shouldCancel = cancelRecordingRef.current;
        const chunks = recordedChunksRef.current;
        const bytes = recordedBytesRef.current;
        const oversized =
          recordingOversizedRef.current || bytes > maxVideoBytes;
        const outputMimeType = recorder.mimeType || mimeType || "video/webm";

        clearRecordingTimer();
        mediaRecorderRef.current = null;
        recordedChunksRef.current = [];
        recordedBytesRef.current = 0;
        recordingOversizedRef.current = false;
        cancelRecordingRef.current = false;
        setRecordingSeconds(0);

        if (shouldCancel) {
          setRecordingState("idle");
          return;
        }

        if (oversized) {
          setRecordingState("idle");
          setError(i18nT("la_video_depasse_value_faites_une_a7f6d88f", { value0: formatMegabytes(maxVideoBytes) }));
          return;
        }

        if (!chunks.length) {
          setRecordingState("idle");
          setError(i18nT("aucune_video_enregistree_merci_de_reessayer_3b444b28"));
          return;
        }

        const blob = new Blob(chunks, { type: outputMimeType });
        const file = new File([blob], buildVideoFileName(outputMimeType), {
          type: outputMimeType,
          lastModified: Date.now(),
        });

        setRecordingState("saving");
        void Promise.resolve(onCapture(file))
          .then(() => applyTorch(false))
          .then(() => {
            stopStream();
            onClose();
          })
          .catch((err) => {
            console.warn("inrcy_camera_video_capture_failed", err);
            setRecordingState("idle");
            setError(i18nT("impossible_d_ajouter_cette_video_merci_b5b67c0f"));
          });
      };

      recorder.start(1000);
      recordingTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor(
          (Date.now() - recordingStartedAtRef.current) / 1000,
        );
        setRecordingSeconds(elapsed);
        if (typeof maxVideoSeconds === "number" && maxVideoSeconds > 0 && elapsed >= maxVideoSeconds) {
          stopActiveRecording(false);
        }
      }, 250);
    } catch (err) {
      console.warn("inrcy_camera_video_recording_failed", err);
      clearRecordingTimer();
      mediaRecorderRef.current = null;
      setRecordingState("idle");
      setError(i18nT("impossible_de_lancer_l_enregistrement_video_b2c96916"));
    }
  }, [
    applyTorch,
    cameraMode,
    clearRecordingTimer,
    maxVideoBytes,
    maxVideoSeconds,
    onCapture,
    onClose,
    phase,
    stopActiveRecording,
    stopStream,
  ]);

  const pickFallbackMedia = React.useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      void Promise.resolve(onCapture(file)).finally(close);
    },
    [close, onCapture],
  );

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Best effort.
      }

      const points = Array.from(pointersRef.current.values());
      if (points.length === 2) {
        pinchStartRef.current = {
          distance: getPointerDistance(points),
          zoom,
        };
      }
    },
    [zoom],
  );

  const handlePointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pointersRef.current.has(event.pointerId)) return;
      pointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });

      const points = Array.from(pointersRef.current.values());
      const pinchStart = pinchStartRef.current;
      if (points.length !== 2 || !pinchStart || pinchStart.distance <= 0)
        return;

      event.preventDefault();
      const currentDistance = getPointerDistance(points);
      const ratio = currentDistance / pinchStart.distance;
      void applyZoom(pinchStart.zoom * ratio);
    },
    [applyZoom],
  );

  const handlePointerEnd = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(event.pointerId);
      if (pointersRef.current.size < 2) {
        pinchStartRef.current = null;
      }
    },
    [],
  );

  if (!open) return null;

  const isRecording = recordingState === "recording";
  const isSavingRecording = recordingState === "saving";
  const isBusy =
    phase === "capturing" || phase === "loading" || isSavingRecording;
  const controlsLocked = isBusy || isRecording;
  const canCapturePhoto = cameraMode === "photo" && phase === "ready";
  const canStartVideoRecording =
    cameraMode === "video" && phase === "ready" && recordingState === "idle";
  const canStopVideoRecording = cameraMode === "video" && isRecording;
  const shellIsFullscreen = isMobileCameraViewport;
  const showVisualZoom = !hardwareZoomSupported && zoom > 1;

  const iconButtonBase: React.CSSProperties = {
    width: isLandscapeViewport ? 48 : 54,
    height: isLandscapeViewport ? 48 : 54,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.26)",
    background: "rgba(6,10,24,0.58)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontSize: isLandscapeViewport ? 20 : 22,
    fontWeight: 950,
    cursor: isBusy ? "not-allowed" : "pointer",
    opacity: isBusy ? 0.55 : 1,
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    boxShadow: "0 12px 28px rgba(0,0,0,0.28)",
    flex: "0 0 auto",
  };

  const captureButtonStyle: React.CSSProperties = {
    width: isLandscapeViewport ? 64 : 78,
    height: isLandscapeViewport ? 64 : 78,
    borderRadius: 999,
    border: "4px solid rgba(255,255,255,0.92)",
    background:
      canCapturePhoto || canStartVideoRecording || canStopVideoRecording
        ? "linear-gradient(135deg, #48c6ef, #7c3aed 56%, #ff4fd8)"
        : "rgba(255,255,255,0.14)",
    color: "#fff",
    display: "grid",
    placeItems: "center",
    fontSize: isLandscapeViewport ? 25 : 30,
    cursor:
      canCapturePhoto || canStartVideoRecording || canStopVideoRecording
        ? "pointer"
        : "not-allowed",
    opacity:
      canCapturePhoto || canStartVideoRecording || canStopVideoRecording
        ? 1
        : 0.58,
    boxShadow:
      canCapturePhoto || canStartVideoRecording || canStopVideoRecording
        ? "0 18px 42px rgba(124,58,237,0.34)"
        : undefined,
    flex: "0 0 auto",
  };

  const fallbackButtonStyle: React.CSSProperties = {
    minHeight: 44,
    borderRadius: 999,
    border: "1px solid rgba(76,195,255,0.45)",
    background: "linear-gradient(135deg, #48c6ef, #7c3aed)",
    color: "#fff",
    fontWeight: 950,
    padding: "0 18px",
    cursor: "pointer",
  };

  const closeButton = (
    <button
      type="button"
      onClick={close}
      aria-label={i18nT("fermer_la_camera_fd5ac40e")}
      style={{
        ...iconButtonBase,
        position: "absolute",
        top: "max(12px, env(safe-area-inset-top))",
        right: "max(12px, env(safe-area-inset-right))",
        zIndex: 4,
        width: isLandscapeViewport ? 42 : 46,
        height: isLandscapeViewport ? 42 : 46,
        fontSize: isLandscapeViewport ? 22 : 24,
      }}
    >
      ×
    </button>
  );

  const switchCameraButton = hasMultipleCameras ? (
    <button
      type="button"
      onClick={() => {
        setFacingMode((value) =>
          value === "environment" ? "user" : "environment",
        );
      }}
      disabled={controlsLocked}
      aria-label={
        facingMode === "environment"
          ? "Passer en caméra avant"
          : "Passer en caméra arrière"
      }
      title={facingMode === "environment" ? "Caméra avant" : "Caméra arrière"}
      style={iconButtonBase}
    >
      ⇄
    </button>
  ) : (
    <span
      style={{
        width: iconButtonBase.width,
        height: iconButtonBase.height,
        flex: "0 0 auto",
      }}
    />
  );

  const flashButton = (
    <button
      type="button"
      onClick={() => {
        if (controlsLocked) return;
        if (!torchSupported) {
          setFlashNotice(i18nT("flash_indisponible_sur_cet_appareil_9eac5eab"));
          window.setTimeout(() => setFlashNotice(""), 1800);
          return;
        }
        void applyTorch(!torchOn);
      }}
      disabled={controlsLocked}
      aria-disabled={!torchSupported}
      aria-label={
        torchSupported
          ? torchOn
            ? "Désactiver le flash"
            : "Activer le flash"
          : "Flash indisponible sur cet appareil"
      }
      title={
        torchSupported
          ? torchOn
            ? "Flash activé"
            : "Flash"
          : "Flash indisponible sur cet appareil"
      }
      style={{
        ...iconButtonBase,
        background: torchSupported
          ? torchOn
            ? "linear-gradient(135deg, #f59e0b, #ff4fd8)"
            : iconButtonBase.background
          : "rgba(15,23,42,0.72)",
        color: torchSupported ? "#fff" : "rgba(255,255,255,0.78)",
        borderColor: torchSupported
          ? "rgba(255,255,255,0.26)"
          : "rgba(255,255,255,0.34)",
        cursor: torchSupported && !controlsLocked ? "pointer" : "not-allowed",
        opacity: controlsLocked ? 0.55 : 1,
        boxShadow: torchSupported
          ? iconButtonBase.boxShadow
          : "0 12px 28px rgba(0,0,0,0.24)",
      }}
    >
      ⚡
    </button>
  );

  const cameraModeTabs = (
    <div
      style={{
        position: "absolute",
        top: "max(14px, env(safe-area-inset-top))",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 4,
        display: "inline-flex",
        gap: 4,
        padding: 4,
        borderRadius: 999,
        background: "rgba(6,10,24,0.72)",
        border: "1px solid rgba(255,255,255,0.22)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        boxShadow: "0 10px 24px rgba(0,0,0,0.28)",
      }}
      aria-label={i18nT("mode_de_l_appareil_inrcy_6cad924c")}
    >
      {(["photo", "video"] as CameraMode[]).map((mode) => {
        const active = cameraMode === mode;
        const disabled = controlsLocked || (mode === "video" && !allowVideo);
        return (
          <button
            key={mode}
            type="button"
            disabled={disabled}
            aria-current={active ? "true" : undefined}
            title={
              mode === "video" && !allowVideo
                ? "Vidéo indisponible ici"
                : undefined
            }
            onClick={() => {
              if (disabled || active) return;
              setCameraMode(mode);
            }}
            style={{
              minHeight: 30,
              border: "none",
              borderRadius: 999,
              padding: "6px 12px",
              background: active
                ? "linear-gradient(135deg, #48c6ef, #7c3aed)"
                : "rgba(255,255,255,0.08)",
              color: active ? "#fff" : "rgba(255,255,255,0.78)",
              fontSize: 12,
              fontWeight: active ? 950 : 900,
              cursor: disabled || active ? "default" : "pointer",
              opacity: disabled && !active ? 0.58 : 1,
            }}
          >
            {mode === "photo" ? i18nT("photo_d01d9003") : i18nT("video_304f6ca4")}
          </button>
        );
      })}
    </div>
  );

  const captureButtonDisabled =
    cameraMode === "photo"
      ? !canCapturePhoto
      : !canStartVideoRecording && !canStopVideoRecording;

  const captureButton = (
    <button
      type="button"
      onClick={() => {
        if (cameraMode === "video") {
          if (canStopVideoRecording) {
            stopActiveRecording(false);
          } else if (canStartVideoRecording) {
            startVideoRecording();
          }
          return;
        }
        void capture();
      }}
      disabled={captureButtonDisabled}
      aria-label={
        cameraMode === "video"
          ? canStopVideoRecording
            ? "Arrêter la vidéo"
            : "Enregistrer la vidéo"
          : phase === "capturing"
            ? "Ajout de la photo"
            : "Capturer la photo"
      }
      title={
        cameraMode === "video" ? "Enregistrer la vidéo" : "Capturer la photo"
      }
      style={{
        ...captureButtonStyle,
        cursor: captureButtonDisabled ? "not-allowed" : "pointer",
        opacity: captureButtonDisabled ? 0.58 : 1,
        background: canStopVideoRecording
          ? "linear-gradient(135deg, #ef4444, #ff4fd8)"
          : captureButtonStyle.background,
      }}
    >
      {cameraMode === "video"
        ? canStopVideoRecording
          ? "■"
          : isSavingRecording
            ? "…"
            : "●"
        : phase === "capturing"
          ? "…"
          : "📷"}
    </button>
  );

  const dialog = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483000,
        width: "100dvw",
        height: "100dvh",
        background: "rgba(5,8,18,0.96)",
        display: "grid",
        placeItems: "center",
        padding: shellIsFullscreen ? 0 : 14,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          position: "relative",
          width: shellIsFullscreen ? "100vw" : "min(100%, 540px)",
          height: shellIsFullscreen ? "100dvh" : "min(92dvh, 760px)",
          display: "flex",
          flexDirection: "column",
          borderRadius: shellIsFullscreen ? 0 : 28,
          border: shellIsFullscreen
            ? "none"
            : "1px solid rgba(255,255,255,0.16)",
          background: "#050816",
          boxShadow: shellIsFullscreen
            ? "none"
            : "0 28px 80px rgba(0,0,0,0.55)",
          color: "#fff",
          overflow: "hidden",
        }}
      >
        {closeButton}
        {phase !== "error" ? cameraModeTabs : null}

        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onDoubleClick={() => void applyZoom(zoomLimits.min)}
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            minHeight: 0,
            flex: "1 1 auto",
            overflow: "hidden",
            background: "#050816",
            touchAction: "none",
          }}
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display:
                phase === "ready" || phase === "capturing" ? "block" : "none",
              transform:
                `${facingMode === "user" ? "scaleX(-1) " : ""}${showVisualZoom ? `scale(${zoom})` : ""}`.trim() ||
                undefined,
              transformOrigin: "center center",
            }}
          />

          {phase !== "ready" && phase !== "capturing" ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                padding: 28,
                textAlign: "center",
                color: "rgba(255,255,255,0.84)",
                fontSize: 14,
                lineHeight: 1.45,
                background:
                  "radial-gradient(circle at 50% 35%, rgba(124,58,237,0.22), transparent 38%), #050816",
              }}
            >
              <div style={{ maxWidth: 340 }}>
                <div style={{ fontSize: 36, marginBottom: 12 }}>📷</div>
                <div>
                  {phase === "error" ? error : i18nT("ouverture_de_la_camera_f7d62280")}
                </div>
                {phase === "error" ? (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{ ...fallbackButtonStyle, marginTop: 16 }}
                  >
                    {cameraMode === "video"
                      ? i18nT("importer_une_video_280194c3")
                      : i18nT("importer_une_image_fcd9d38d")}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {phase !== "idle" && phase !== "error" ? (
            <div
              style={{
                position: "absolute",
                top: "max(14px, env(safe-area-inset-top))",
                left: "max(14px, env(safe-area-inset-left))",
                zIndex: 3,
                borderRadius: 999,
                padding: "7px 11px",
                minWidth: 42,
                textAlign: "center",
                background: "rgba(6,10,24,0.72)",
                border: "1px solid rgba(255,255,255,0.26)",
                color: "#fff",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                fontSize: 13,
                fontWeight: 950,
                boxShadow: "0 10px 24px rgba(0,0,0,0.3)",
              }}
              title={i18nT("pincez_avec_deux_doigts_pour_zoomer_a3ed1c93")}
            >
              {zoom <= (zoomLimits.min || 1) + 0.02
                ? i18nT("1x_6fe62d0d")
                : `${zoom.toFixed(1)}x`}
            </div>
          ) : null}

          {cameraMode === "video" && phase === "ready" ? (
            <div
              role="status"
              style={{
                position: "absolute",
                left: "50%",
                bottom: isLandscapeViewport ? 148 : 172,
                transform: "translateX(-50%)",
                zIndex: 5,
                maxWidth: "calc(100% - 32px)",
                borderRadius: 999,
                padding: "8px 12px",
                background: isRecording
                  ? "rgba(127,29,29,0.78)"
                  : "rgba(15,23,42,0.78)",
                border: "1px solid rgba(255,255,255,0.24)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 900,
                textAlign: "center",
                boxShadow: "0 14px 34px rgba(0,0,0,0.32)",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
              }}
            >
              {isRecording
                ? typeof maxVideoSeconds === "number" && maxVideoSeconds > 0
                  ? i18nT("rec_value_value_c37e4471", { value0: formatRecordingSeconds(recordingSeconds), value1: formatRecordingSeconds(maxVideoSeconds) })
                  : `REC ${formatRecordingSeconds(recordingSeconds)}`
                : i18nT("video_avec_son_value_max_1c2d8f98", { value0: formatMegabytes(maxVideoBytes) })}
            </div>
          ) : null}

          {flashNotice ? (
            <div
              role="status"
              style={{
                position: "absolute",
                left: "50%",
                bottom: isLandscapeViewport ? 86 : 106,
                transform: "translateX(-50%)",
                zIndex: 5,
                maxWidth: "calc(100% - 32px)",
                borderRadius: 999,
                padding: "9px 13px",
                background: "rgba(15,23,42,0.82)",
                border: "1px solid rgba(255,255,255,0.24)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 850,
                textAlign: "center",
                boxShadow: "0 14px 34px rgba(0,0,0,0.32)",
                backdropFilter: "blur(14px)",
                WebkitBackdropFilter: "blur(14px)",
              }}
            >
              {flashNotice}
            </div>
          ) : null}
        </div>

        <canvas ref={canvasRef} style={{ display: "none" }} />
        <input
          ref={fileInputRef}
          type="file"
          accept={
            cameraMode === "video"
              ? "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
              : "image/*"
          }
          style={{ display: "none" }}
          onChange={(event) => {
            pickFallbackMedia(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />

        <div
          style={{
            position: "absolute",
            left: "max(14px, env(safe-area-inset-left))",
            right: "max(14px, env(safe-area-inset-right))",
            bottom: "max(14px, env(safe-area-inset-bottom))",
            zIndex: 4,
            pointerEvents: phase === "error" ? "none" : "auto",
          }}
        >
          {isLandscapeViewport ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                {switchCameraButton}
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                {flashButton}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {captureButton}
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                alignItems: "center",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                {switchCameraButton}
              </div>
              <div style={{ display: "flex", justifyContent: "center" }}>
                {captureButton}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                {flashButton}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return dialog;
  return createPortal(dialog, document.body);
}
