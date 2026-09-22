import type React from "react";
import type { ImageOverlay } from "@/lib/imageOverlay";


export type BackgroundMode = "transparent" | "color" | "white" | "black" | "gray" | "sand" | "brand";

export type ChannelTab = { key: string; label: string; count?: number; tone?: "ready" | "warning" | "blocked" | "empty" };

export type RenderTransform = {
  fit?: "contain" | "cover";
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
  blurBackground?: boolean;
  backgroundMode?: BackgroundMode;
  backgroundColor?: string;
  overlay?: ImageOverlay;
};

export type RenderPreset = { width: number; height: number };

export type ImageMeta = { width: number; height: number };

export type PreviewImage = {
  previewUrl: string;
  transform?: RenderTransform;
  preset?: RenderPreset;
  imageMeta?: ImageMeta;
};

export type PreviewVideo = {
  previewUrl: string;
  name?: string | null;
  type?: string | null;
  size?: number | null;
  duration?: number | null;
  aspectRatio?: string | null;
  fitMode?: "contain" | "cover" | null;
};

export type PublicationPreview = {
  channelKey: string;
  mediaType?: "images" | "video";
  channelLabel: string;
  title?: string | null;
  content?: string | null;
  cta?: string | null;
  hashtags?: string[];
  image?: PreviewImage | null;
  images?: PreviewImage[];
  imageCount?: number;
  video?: PreviewVideo | null;
  formatLabel?: string;
};

export type CardItem = {
  key: string;
  previewUrl: string;
  included: boolean;
  disabled?: boolean;
  title: string;
  subtitle: string;
  fitLabel: string;
  /** Per-image ratio used by Booster's intelligent Originale/Adaptée preview. */
  previewAspectRatio?: string;
  backgroundMode: BackgroundMode;
  backgroundColor?: string;
  transform?: RenderTransform;
  preset?: RenderPreset;
  imageMeta?: ImageMeta;
  onToggle: () => void;
  onAdapt: () => void;
  onModify: () => void;
  onRemove?: () => void;
  removeLabel?: string;
  onRemoveEverywhere?: () => void;
  removeEverywhereLabel?: string;
  onReset?: () => void;
  onMovePrevious?: () => void;
  onMoveNext?: () => void;
  onMoveTo?: (targetImageKey: string) => void;
  dragLabel?: string;
};

export type SidebarItem = {
  key: string;
  previewUrl: string;
  title: string;
  subtitle: string;
  fitLabel?: string;
  active: boolean;
  onClick: () => void;
};

export type CardsPanelProps = {
  tabs: ChannelTab[];
  activeChannel: string;
  onActiveChannelChange: (key: string) => void;
  channelTitle: string;
  formatLabel: string;
  aspectRatio: string;
  items: CardItem[];
  buttonClassName: string;
  pillButtonStyle: React.CSSProperties;
  pillButtonActiveStyle: React.CSSProperties;
  showTabs?: boolean;
  emptyMessage?: string;
  publicationPreview?: PublicationPreview | null;
};

export type ModalProps = {
  open: boolean;
  title: string;
  subtitle: string;
  aspectRatio: string;
  backgroundMode: BackgroundMode;
  backgroundColor?: string;
  fitLabel: string;
  zoomLabel: string;
  previewSrc: string;
  previewImageStyle?: React.CSSProperties;
  previewLayout?: { drawW: number; drawH: number; dx: number; dy: number };
  overlay?: ImageOverlay;
  isDragging?: boolean;
  onClose: () => void;
  onWheel?: React.WheelEventHandler<HTMLDivElement>;
  onPointerDown?: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove?: React.PointerEventHandler<HTMLDivElement>;
  onPointerUp?: React.PointerEventHandler<HTMLDivElement>;
  onPointerCancel?: React.PointerEventHandler<HTMLDivElement>;
  onDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
  previewRef?: React.RefObject<HTMLDivElement | null>;
  onImageMouseDown?: React.MouseEventHandler<HTMLImageElement>;
  buttonClassName: string;
  primaryButtonClassName?: string;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onContain: () => void;
  onCover: () => void;
  onReset: () => void;
  onSave: () => void;
  saving?: boolean;
  onApplyToSelectedChannels?: () => void;
  onApplyToChannelImages?: () => void;
  onResetChannel?: () => void;
  isolationNote?: string;
  onBackgroundModeChange: (mode: BackgroundMode) => void;
  onBackgroundColorChange?: (color: string) => void;
  onOverlayChange?: (overlay: ImageOverlay | undefined) => void;
  pillButtonStyle: React.CSSProperties;
  pillButtonActiveStyle: React.CSSProperties;
  sidebarItems?: SidebarItem[];
};
