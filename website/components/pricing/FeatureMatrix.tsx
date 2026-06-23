import { Fragment } from "react";
import { Check, Minus } from "lucide-react";
import { MATRIX, PLANS } from "./plans";

// A real comparison table across the four tiers, columns centred under each
// plan name, with the recommended (Pro) column carried as one clean tinted
// band, continuous through the group headings, so the eye tracks it down.

const PRO_TINT = { background: "rgba(245,245,247,0.85)" } as const;

function Cell({ value }: { value: boolean | string }): React.ReactElement {
  if (value === true) {
    return (
      <span className="inline-flex size-[21px] items-center justify-center rounded-full bg-[#1d1d1f]">
        <Check size={12} strokeWidth={3} className="text-white" />
      </span>
    );
  }
  if (value === false) {
    return <Minus size={15} strokeWidth={2.4} className="text-text-ter/55" aria-label="Not included" />;
  }
  return <span className="font-geist text-[12.5px] font-medium leading-tight text-text">{value}</span>;
}

export function FeatureMatrix(): React.ReactElement {
  return (
    <section className="mx-auto max-w-6xl px-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="max-w-2xl font-display text-[clamp(1.7rem,3.4vw,2.5rem)] font-600 leading-[1.05] tracking-[-0.03em] text-text text-balance">
          What you get on each plan
        </h2>
        <span className="font-geist text-[12.5px] text-text-ter sm:hidden">Swipe to compare →</span>
      </div>

      <div className="mt-9 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <table className="w-full min-w-[680px] border-collapse text-left">
          <thead>
            <tr>
              <th className="w-[30%] pb-4 pr-4 align-bottom" />
              {PLANS.map((plan) => (
                <th
                  key={plan.id}
                  className={`px-3 pb-4 pt-5 text-center align-bottom ${plan.recommended ? "rounded-t-[14px]" : ""}`}
                  style={plan.recommended ? PRO_TINT : undefined}
                >
                  <span className="block font-display text-[1.1rem] font-600 tracking-[-0.02em] text-text">
                    {plan.name}
                  </span>
                </th>
              ))}
            </tr>
            <tr>
              <th className="border-b border-border-strong" />
              {PLANS.map((plan) => (
                <th key={plan.id} className="border-b border-border-strong" style={plan.recommended ? PRO_TINT : undefined} />
              ))}
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((group) => (
              <Fragment key={group.title}>
                <tr>
                  <td className="pb-3 pt-8">
                    <span className="font-geist-mono text-[11px] uppercase tracking-[0.14em] text-text-ter">
                      {group.title}
                    </span>
                  </td>
                  {PLANS.map((plan) => (
                    <td key={plan.id} style={plan.recommended ? PRO_TINT : undefined} />
                  ))}
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.label}>
                    <td className="border-t border-border py-3 pr-5 font-geist text-[13.5px] leading-snug text-text-sec">
                      {row.label}
                    </td>
                    {row.values.map((v, i) => (
                      <td
                        key={i}
                        className="border-t border-border px-3 py-3 text-center align-middle"
                        style={PLANS[i].recommended ? PRO_TINT : undefined}
                      >
                        <span className="inline-flex items-center justify-center">
                          <Cell value={v} />
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
