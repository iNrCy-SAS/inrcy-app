type Props = {
  size?: number;
  className?: string;
};

/** Shared ADN mark used by compact shortcuts to the professional context. */
export default function BusinessDnaIcon({ size = 24, className }: Props) {
  return (
    <img
      data-business-dna-icon
      aria-hidden="true"
      alt=""
      className={className}
      src="/icons/business-dna.svg"
      width={size}
      height={size}
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        display: "block",
        objectFit: "contain",
      }}
    />
  );
}
