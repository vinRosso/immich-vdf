import { cn } from "cn";

/**
 * Placeholder block. Fades in after a short delay (so near-instant loads never flash one) and sweeps a highlight across.
 * `index` offsets the sweep, so repeated blocks ripple as a wave instead of pulsing together.
 */
function Skeleton({ className, index, style, ...props }: React.ComponentProps<"div"> & { index?: number }) {
  return (
    <div
      data-slot="skeleton"
      className={cn("skeleton rounded-md", className)}
      style={index === undefined ? style : ({ "--skeleton-i": index % 12, ...style } as React.CSSProperties)}
      {...props}
    />
  );
}

export { Skeleton };
