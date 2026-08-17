import {
  Baby,
  Crown,
  Heart,
  ScrollText,
  Skull,
  Swords,
  type LucideIconData,
} from 'lucide-angular';
import type { DynastyEventType } from '../../models/dynasty-event';

/**
 * Icon and colour per event type, ported from the reference prototype.
 *
 * War and battle deliberately share the crossed-swords mark and the deep red, and
 * treaty shares its blue with `other`, so the timeline reads as a handful of
 * recognisable kinds rather than eight competing colours.
 */
const EVENT_ICONS: Readonly<Record<DynastyEventType, LucideIconData>> = {
  birth: Baby,
  death: Skull,
  coronation: Crown,
  wedding: Heart,
  war: Swords,
  battle: Swords,
  treaty: ScrollText,
  other: ScrollText,
};

const EVENT_COLORS: Readonly<Record<DynastyEventType, string>> = {
  birth: '#4a8577',
  death: '#5c584d',
  coronation: '#b08d3e',
  wedding: '#a3435a',
  war: '#7a2634',
  battle: '#7a2634',
  treaty: '#3d6ea8',
  other: '#3d6ea8',
};

export function eventIcon(type: DynastyEventType): LucideIconData {
  return EVENT_ICONS[type] ?? ScrollText;
}

export function eventColor(type: DynastyEventType): string {
  return EVENT_COLORS[type] ?? EVENT_COLORS.other;
}
