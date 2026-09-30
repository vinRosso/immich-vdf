type HalftoneDot = { id: string; x: number; y: number; size: number; rx: number };

const STEP = 52;
const WIDTH = 6 * STEP; // 312

const SIZE_MAP: Record<string, number> = {
  "0,0": 42, "1,0": 42, "2,0": 40, "3,0": 36, "4,0": 30, "5,0": 22,
  "0,1": 42, "1,1": 38, "2,1": 32, "3,1": 24, "4,1": 15, "5,1": 7,
  "0,2": 40, "1,2": 32, "2,2": 22, "3,2": 14, "4,2": 7,  "5,2": 3,
  "0,3": 36, "1,3": 24, "2,3": 14, "3,3": 7,  "4,3": 3,
  "0,4": 30, "1,4": 15, "2,4": 7,  "3,4": 3,
  "0,5": 22, "1,5": 7,  "2,5": 3,
};

const CORNER_DOTS: HalftoneDot[] = Object.entries(SIZE_MAP).map(([key, size]) => {
  const [c, r] = key.split(",").map(Number);
  const cx = WIDTH - (c * STEP + STEP / 2);
  const cy = r * STEP + STEP / 2;
  const rx = Math.min(size * 0.44, 16);
  return {
    id: key,
    x: Number((cx - size / 2).toFixed(1)),
    y: Number((cy - size / 2).toFixed(1)),
    size,
    rx: Number(rx.toFixed(1)),
  };
});

function CornerHalftone({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${WIDTH}`}
      className={className}
      fill="currentColor"
      aria-hidden
    >
      {CORNER_DOTS.map((dot) => (
        <rect
          key={dot.id}
          x={dot.x}
          y={dot.y}
          width={dot.size}
          height={dot.size}
          rx={dot.rx}
        />
      ))}
    </svg>
  );
}

export function PageMarks() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden text-violet-400/[0.035]"
      aria-hidden
    >
      {/* Top right corner halftone */}
      <CornerHalftone className="absolute top-0 right-0 size-[21rem] md:size-[24rem]" />
      {/* Bottom left corner halftone (rotated 180) */}
      <CornerHalftone className="absolute bottom-0 left-0 size-[21rem] md:size-[24rem] rotate-180" />
    </div>
  );
}
