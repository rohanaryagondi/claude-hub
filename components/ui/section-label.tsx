// Section divider: small uppercase tracked label + count + a thin flex-1 rule.

export function SectionLabel({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-bold text-muted-foreground/60 uppercase tracking-widest whitespace-nowrap">{label}</span>
      <span className="text-[11px] text-muted-foreground/40 tabular-nums">{count}</span>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  )
}
