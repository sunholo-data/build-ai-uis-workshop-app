/**
 * ONE landing right-column visual.
 *
 * Static mock of the one-doc-compare workbench surface: two PPA contracts
 * side-by-side with key differences highlighted. Not connected to any agent
 * — it's the marketing teaser that previews what clicking the Hero CTA will
 * actually open.
 *
 * Fork pattern: each deployment supplies its own HeroVisual via Hero's
 * `visual` prop. Upstream / Sunholo defaults to no visual (single-column
 * Hero). To rebrand, replace this component (or write a sibling like
 * AcmeHeroVisual.tsx) and pass it to `<Hero visual={...} />` in page.tsx.
 */

interface DocumentColumnProps {
  label: string;
  counterparty: string;
  settlementType: string;
  priceFormula: string;
  termYears: string;
  highlighted?: boolean;
}

function DocumentColumn({
  label,
  counterparty,
  settlementType,
  priceFormula,
  termYears,
  highlighted = false,
}: DocumentColumnProps) {
  return (
    <div
      className={
        "rounded-md border p-3 " +
        (highlighted
          ? "border-primary/40 bg-primary/[0.03]"
          : "border-border bg-background")
      }
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="font-mono text-[9px] text-muted-foreground">.pdf</span>
      </div>
      <div className="space-y-2 text-xs">
        <Field label="Counterparty" value={counterparty} />
        <Field label="Settlement" value={settlementType} />
        <Field label="Price formula" value={priceFormula} />
        <Field label="Term" value={termYears} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <p className="font-mono text-foreground tabular-nums">{value}</p>
    </div>
  );
}

export function OneHeroVisual() {
  return (
    <div className="relative isolate">
      <div className="relative overflow-hidden rounded-xl border border-border bg-muted/30 p-6 backdrop-blur md:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="relative mb-4 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Side-by-side PPA review
          </span>
          <span className="font-mono text-[10px] text-muted-foreground">
            live
          </span>
        </div>
        <div className="relative grid grid-cols-2 gap-3">
          <DocumentColumn
            label="Contract A"
            counterparty="ACME Energy GmbH"
            settlementType="PaP"
            priceFormula="Fixed €45/MWh"
            termYears="10 years"
          />
          <DocumentColumn
            label="Contract B"
            counterparty="Beta Power Ltd"
            settlementType="PaN"
            priceFormula="CPI-indexed €48/MWh"
            termYears="7 years"
            highlighted
          />
        </div>
        <div className="relative mt-4 rounded-md border border-primary/30 bg-primary/[0.04] p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
              key differences
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">
              3 material
            </span>
          </div>
          <ul className="space-y-1.5 text-xs">
            <DiffRow label="Settlement type" delta="PaP → PaN" />
            <DiffRow label="Price formula" delta="€45 fixed → CPI" />
            <DiffRow label="Term length" delta="10y → 7y" />
          </ul>
        </div>
        <div className="relative mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="font-mono">
            Source-cited at clause level
          </span>
          <span className="font-mono uppercase tracking-wider">
            Live market benchmarking
          </span>
        </div>
      </div>
    </div>
  );
}

function DiffRow({ label, delta }: { label: string; delta: string }) {
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="text-foreground">{label}</span>
      <span className="font-mono text-muted-foreground tabular-nums">
        {delta}
      </span>
    </li>
  );
}
