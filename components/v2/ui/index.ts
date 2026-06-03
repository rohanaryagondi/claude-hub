/**
 * FLIGHTDECK primitive kit — public barrel.
 * Screen agents: `import { Panel, StatTile, ... } from '@/components/v2/ui'`.
 *
 * NOTE: import the token contract once from the root layout:
 *   import '@/components/v2/ui/v2-tokens.css'
 * (Importing this barrel does NOT pull in the CSS.)
 */

export { Panel, PanelHeader, PanelEyebrow, PanelTitle, PanelBody } from './panel'
export type { PanelProps, PanelHeaderProps } from './panel'

export { StatTile } from './stat-tile'
export type { StatTileProps, StatTileTone, StatTileDelta } from './stat-tile'

export { StatusDot } from './status-dot'
export type { StatusDotProps, StatusDotState } from './status-dot'

export { Pill } from './pill'
export type { PillProps } from './pill'

export { Sparkline } from './sparkline'
export type { SparklineProps, SparklineTone, SparklineVariant } from './sparkline'

export { Section, SectionDivider, SectionLabel } from './section'
export type { SectionProps, SectionDividerProps } from './section'

export { SearchInput } from './search-input'
export type { SearchInputProps } from './search-input'

export { Button, buttonVariants } from './button'
export type { ButtonProps } from './button'

export { Tabs, TabNav, useActiveTab } from './tabs'
export type { TabsProps, TabItem } from './tabs'

export { Kbd } from './kbd'
export type { KbdProps } from './kbd'

export { SkeletonRow } from './skeleton-row'
export type { SkeletonRowProps, SkeletonListProps } from './skeleton-row'

export { StretchGrid } from './stretch-grid'
export type { StretchGridProps } from './stretch-grid'
