/** Shared by the PNG renderer and FFmpeg: copy never covers generated pixels. */
export type AiMediaVideoCaptionLayout = "overlay" | "caption-band";

export function resolveAiMediaVideoLayout(args: {
  width: number;
  height: number;
  captionLayout?: AiMediaVideoCaptionLayout;
}) {
  const captionHeight = args.captionLayout === "caption-band"
    ? Math.min(
        Math.floor(args.height * 0.32 / 2) * 2,
        Math.max(
          64,
          Math.round(Math.min(args.width, args.height) * 0.22 / 2) * 2,
        ),
      )
    : 0;
  return {
    content: {
      left: 0,
      top: 0,
      width: args.width,
      height: args.height - captionHeight,
    },
    caption: {
      left: 0,
      top: args.height - captionHeight,
      width: args.width,
      height: captionHeight,
    },
  };
}
