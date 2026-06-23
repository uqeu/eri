// A subtle iPhone frame (dark bezel, dynamic island) wrapping any screen content.
// Reused by the hero and the desk↔pocket comparison.

export function PhoneFrame({
  children,
  width = 324,
  height = 640,
  className,
}: {
  readonly children: React.ReactNode;
  readonly width?: number;
  readonly height?: number;
  readonly className?: string;
}): React.ReactElement {
  return (
    <div className={className} style={{ width }}>
      <div
        className="rounded-[46px] bg-[#1c1a17] p-[10px]"
        style={{
          boxShadow:
            "0 2px 4px rgba(28,26,23,0.06), 0 50px 90px -34px rgba(28,26,23,0.40)",
        }}
      >
        <div
          className="relative overflow-hidden rounded-[38px] bg-white"
          style={{ height }}
        >
          <div className="absolute left-1/2 top-2 z-10 h-[22px] w-[78px] -translate-x-1/2 rounded-full bg-[#1c1a17]" />
          {children}
        </div>
      </div>
    </div>
  );
}
