import { Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LucideAngularModule } from 'lucide-angular';

export interface DatePartsValue {
  day: number | null;
  month: number | null;
  year: number | null;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "1st"/"2nd"/"3rd"/"4th"… — teens are always "th" regardless of their last digit. */
function ordinal(n: number): string {
  const remainder100 = n % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * `new Date(year, ...)`/`Date.UTC` silently remap a two-digit `year` into 1900-something —
 * legacy JS behaviour that would corrupt any in-world year below 100 (a young dynasty's
 * founding year, say). `setFullYear` on an existing Date never applies that remapping, so
 * every calendar calculation below goes through this helper instead of the constructor.
 */
function dateFor(year: number, monthIndex: number, day: number): Date {
  const date = new Date(0);
  date.setFullYear(year, monthIndex, day);
  return date;
}

/** Days in `month` (1-12) for `year` — JS's own proleptic-Gregorian leap-year rule handles February. */
function daysInMonth(year: number, month: number): number {
  return dateFor(year, month, 0).getDate();
}

/**
 * Popup calendar widget for entering a Day/Month/Year date, replacing three raw number
 * inputs with a single trigger that opens a month grid — same visual role as a native
 * `<input type="date">` but built to this app's own optional-precision model, where day
 * and month are optional refinement on top of year rather than a single required value.
 *
 * Not wired through `formControlName`/`ControlValueAccessor`: day/month/year live as three
 * independent `FormControl`s on the host form (so existing chronology validation keeps
 * working unchanged), and this component instead follows the app's established pattern for
 * complex fields — see the parent/spouse pickers in PersonForm — of a signal-driven child
 * with explicit inputs and a single change output, imperatively patched into the form by
 * the parent rather than bound as a form control itself.
 *
 * The calendar grid is a fictional-but-consistent Gregorian analogue: this world's years
 * have no real-world anchor, so "Su Mo Tu …" alignment and leap-year length are a deterministic
 * visual convenience, not a claim about which real weekday any in-world date fell on.
 */
@Component({
  selector: 'app-date-picker',
  imports: [LucideAngularModule],
  templateUrl: './date-picker.html',
  styleUrl: './date-picker.scss',
  host: {
    '[class.is-open]': 'isOpen()',
  },
})
export class DatePicker {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly day = input<number | null>(null);
  readonly month = input<number | null>(null);
  readonly year = input<number | null>(null);
  /** Used only for the trigger button's aria-label and the popup's empty-state prompt. */
  readonly label = input<string>('Date');
  /** Forwarded to the trigger button so an existing `<label for="…">` keeps working unchanged. */
  readonly id = input<string>('');

  readonly dateChange = output<DatePartsValue>();

  readonly ChevronLeftIcon = ChevronLeft;
  readonly ChevronRightIcon = ChevronRight;
  readonly ChevronsLeftIcon = ChevronsLeft;
  readonly ChevronsRightIcon = ChevronsRight;
  readonly monthNames = MONTH_NAMES;

  readonly isOpen = signal<boolean>(false);

  /** Seeded from the inputs each time the popup opens; live-edited from then on.
   *  Readable from the template (nav-button disabled state, empty-state prompt), so these
   *  stay public — only ever written from within this class. */
  readonly draftDay = signal<number | null>(null);
  readonly draftMonth = signal<number | null>(null);
  readonly draftYear = signal<number | null>(null);

  /** The month the grid renders — defaults to January so a year-only date can still be browsed. */
  readonly displayMonth = computed<number>(() => this.draftMonth() ?? 1);

  readonly summary = computed<string>(() => {
    const year = this.year();
    if (year === null) return 'Unset';
    const month = this.month();
    const day = this.day();
    if (month === null) return `${year}`;
    if (day === null) return `${MONTH_NAMES[month - 1]} ${year}`;
    return `${MONTH_NAMES[month - 1]} ${ordinal(day)}, ${year}`;
  });

  /** Same formatting as `summary`, but against the in-progress draft — the popup's live footer line. */
  readonly draftSummary = computed<string>(() => {
    const year = this.draftYear();
    if (year === null) return 'Enter a year to begin';
    const month = this.draftMonth();
    const day = this.draftDay();
    if (month === null) return `${year}`;
    if (day === null) return `${MONTH_NAMES[month - 1]} ${year}`;
    return `${MONTH_NAMES[month - 1]} ${ordinal(day)}, ${year}`;
  });

  readonly yearText = computed<string>(() => this.draftYear()?.toString() ?? '');

  readonly weeks = computed<(number | null)[][]>(() => {
    const year = this.draftYear();
    if (year === null) return [];
    const month = this.displayMonth();
    const total = daysInMonth(year, month);
    const firstWeekday = dateFor(year, month - 1, 1).getDay();

    const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
    while (cells.length % 7 !== 0) cells.push(null);

    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    return rows;
  });

  /** Closes on any outside click — the popup has no separate "cancel", every edit is already live. */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    if (!this.host.nativeElement.contains(event.target as Node)) this.isOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.isOpen.set(false);
  }

  toggle(): void {
    if (this.isOpen()) {
      this.isOpen.set(false);
      return;
    }
    this.draftDay.set(this.day());
    this.draftMonth.set(this.month());
    this.draftYear.set(this.year());
    this.isOpen.set(true);
  }

  onYearInput(raw: string): void {
    const parsed = raw.trim() === '' ? null : Number(raw);
    this.draftYear.set(parsed === null || Number.isNaN(parsed) ? null : parsed);
    this.clampDraftDay();
    this.emit();
  }

  onMonthSelect(raw: string): void {
    this.draftMonth.set(raw === '' ? null : Number(raw));
    this.clampDraftDay();
    this.emit();
  }

  stepMonth(direction: 1 | -1): void {
    const year = this.draftYear();
    if (year === null) return;
    let month = this.displayMonth() + direction;
    let nextYear = year;
    if (month < 1) {
      month = 12;
      nextYear -= 1;
    } else if (month > 12) {
      month = 1;
      nextYear += 1;
    }
    this.draftYear.set(nextYear);
    this.draftMonth.set(month);
    this.clampDraftDay();
    this.emit();
  }

  stepYear(direction: 1 | -1): void {
    const year = this.draftYear();
    this.draftYear.set((year ?? 0) + direction);
    this.clampDraftDay();
    this.emit();
  }

  selectDay(day: number): void {
    this.draftMonth.set(this.displayMonth());
    this.draftDay.set(day);
    this.emit();
    this.isOpen.set(false);
  }

  isSelectedDay(day: number): boolean {
    return this.draftDay() === day && this.draftMonth() === this.displayMonth();
  }

  clear(): void {
    this.draftDay.set(null);
    this.draftMonth.set(null);
    this.draftYear.set(null);
    this.emit();
    this.isOpen.set(false);
  }

  /** A month/year change can strand a previously-picked day past the new month's end (31st → February). */
  private clampDraftDay(): void {
    const day = this.draftDay();
    const year = this.draftYear();
    if (day === null || year === null) return;
    const max = daysInMonth(year, this.displayMonth());
    if (day > max) this.draftDay.set(max);
  }

  private emit(): void {
    this.dateChange.emit({ day: this.draftDay(), month: this.draftMonth(), year: this.draftYear() });
  }
}
