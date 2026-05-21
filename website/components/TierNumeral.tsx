interface TierNumeralProps {
  n: "I" | "II" | "III";
}

export function TierNumeral({ n }: TierNumeralProps): React.ReactElement {
  return (
    <span className="font-display italic text-accent font-medium tracking-tight">
      {n}
    </span>
  );
}
