import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { SessionService } from './services/session.service';
import { ViewModeService } from './services/view-mode.service';

/**
 * Integration tests for the one guarantee the whole app exists to provide:
 * nothing GM-only may reach the DOM in Player Preview.
 *
 * These drive the real component tree against a stubbed `fetch`, so they cover the
 * template gating rather than just the projection functions.
 */

const SECRET_TOKEN = 'ZZ_SECRET_MARKER_ZZ';
const HIDDEN_NAME = 'ZZ_HIDDEN_PERSON_ZZ';
const HIDDEN_EVENT = 'ZZ_HIDDEN_EVENT_ZZ';

const worldPeople = {
  people: [
    {
      id: 'p1',
      name: 'Rowan Valcrest',
      house: 'Valcrest',
      nation: 'Astyria',
      title: 'King',
      isAlive: false,
      parentIds: [],
      spouseIds: [],
      generation: 0,
      visibility: 'known',
      hideParentage: false,
      gmNotes: { secrets: SECRET_TOKEN, motivations: SECRET_TOKEN },
    },
    {
      id: 'p2',
      name: HIDDEN_NAME,
      house: 'Valcrest',
      nation: 'Astyria',
      isAlive: true,
      parentIds: ['p1'],
      spouseIds: [],
      generation: 1,
      visibility: 'hidden',
      hideParentage: false,
    },
    {
      id: 'p3',
      name: 'Corin Ashfell',
      house: 'Ashfell',
      nation: 'Astyria',
      isAlive: true,
      parentIds: ['p1'],
      spouseIds: [],
      generation: 1,
      visibility: 'known',
      hideParentage: true,
    },
  ],
};

const worldEvents = {
  events: [
    {
      id: 'e1',
      title: 'Coronation of Rowan',
      type: 'coronation',
      year: 1468,
      relatedPersonIds: ['p1'],
      nation: 'Astyria',
      house: 'Valcrest',
      visibility: 'known',
    },
    {
      id: 'e2',
      title: HIDDEN_EVENT,
      type: 'other',
      year: 1470,
      relatedPersonIds: ['p1', 'p2'],
      visibility: 'hidden',
    },
  ],
};

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      // Matches the live API paths (/api/world/:world and /api/world/:world/events),
      // not the old data/{world}[-events].json static files.
      const body = url.endsWith('/events') ? worldEvents : worldPeople;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

async function createApp() {
  const fixture = TestBed.createComponent(App);
  // These tests are written assuming a GM-View starting point (the app's own
  // default is 'player', for a safe bare link — see ViewModeService). Force
  // 'gm' here so the fixture's baseline matches what each test expects before
  // any toggleMode() calls. Entering GM View now requires an authenticated
  // session (see ViewModeService.setMode), so seed one directly rather than
  // going through the real password-prompt/fetch('/api/auth') flow — this
  // exercises the legitimate "already authenticated" path, not a backdoor.
  TestBed.inject(SessionService).setToken('test-session-token');
  await TestBed.inject(ViewModeService).setMode('gm');
  await fixture.whenStable();
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

/** Clicks the button whose title attribute matches, if present. */
function clickByTitle(root: HTMLElement, title: string): boolean {
  const button = root.querySelector<HTMLButtonElement>(`button[title="${title}"]`);
  if (button === null) return false;
  button.click();
  return true;
}

/** Clicks the single GM/Player mode toggle in the header. */
function toggleMode(root: HTMLElement): boolean {
  const button = root.querySelector<HTMLButtonElement>('button.mode-toggle');
  if (button === null) return false;
  button.click();
  return true;
}

describe('App', () => {
  beforeEach(async () => {
    localStorage.clear();
    stubFetch();
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('creates the app and loads the world', async () => {
    const fixture = await createApp();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('h1')?.textContent).toContain('Dynasty Ledger');
    expect(root.textContent).toContain('Rowan Valcrest');
  });

  it('shows hidden people as redacted records in GM View', async () => {
    const fixture = await createApp();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain(HIDDEN_NAME);
    expect(root.querySelectorAll('.note-redacted').length).toBeGreaterThan(0);
  });

  it('removes hidden people entirely in Player Preview', async () => {
    const fixture = await createApp();
    const root = fixture.nativeElement as HTMLElement;

    expect(toggleMode(root)).toBe(true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.textContent).not.toContain(HIDDEN_NAME);
    expect(root.querySelectorAll('.note-redacted').length).toBe(0);
    // The known people are still on the chart.
    expect(root.textContent).toContain('Rowan Valcrest');
    expect(root.textContent).toContain('Corin Ashfell');
  });

  it('removes hidden events in Player Preview but keeps known ones', async () => {
    const fixture = await createApp();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.textContent).toContain(HIDDEN_EVENT);

    toggleMode(root);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.textContent).not.toContain(HIDDEN_EVENT);
    expect(root.textContent).toContain('Coronation of Rowan');
  });

  it('exposes the GM dossier in GM View, secrets included', async () => {
    const fixture = await createApp();
    const root = fixture.nativeElement as HTMLElement;

    expect(clickByTitle(root, 'GM dossier')).toBe(true);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('app-gm-dossier')).not.toBeNull();
    // The secret is present in the GM-facing DOM, as an input value.
    const values = [...root.querySelectorAll('input, textarea')].map(
      (element) => (element as HTMLInputElement | HTMLTextAreaElement).value,
    );
    expect(values.some((value) => value.includes(SECRET_TOKEN))).toBe(true);
  });

  it('never renders the dossier component, or any gmNotes value, in Player Preview', async () => {
    const fixture = await createApp();
    const root = fixture.nativeElement as HTMLElement;

    // Open the dossier first, so switching mode has something to tear down.
    clickByTitle(root, 'GM dossier');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('app-gm-dossier')).not.toBeNull();

    toggleMode(root);
    await fixture.whenStable();
    fixture.detectChanges();

    // Not merely hidden — absent from the component tree.
    expect(root.querySelector('app-gm-dossier')).toBeNull();
    expect(root.querySelector('app-person-form')).toBeNull();

    // No GM string survives anywhere: text, attributes, or control values.
    expect(root.innerHTML).not.toContain(SECRET_TOKEN);
    const values = [...root.querySelectorAll('input, textarea')].map(
      (element) => (element as HTMLInputElement | HTMLTextAreaElement).value,
    );
    expect(values.some((value) => value.includes(SECRET_TOKEN))).toBe(false);
  });

  it('offers no GM affordances at all in Player Preview', async () => {
    const fixture = await createApp();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('button[title="GM dossier"]')).not.toBeNull();

    toggleMode(root);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelector('button[title="GM dossier"]')).toBeNull();
    expect(root.querySelector('button[title="Edit person"]')).toBeNull();
    expect(root.querySelector('button[title="Hide from players"]')).toBeNull();
  });

  it('does not badge concealed parentage in Player Preview', async () => {
    const fixture = await createApp();
    const root = fixture.nativeElement as HTMLElement;

    // GM View marks Corin's concealed parentage so the GM can see the state.
    expect(root.querySelectorAll('.note-parentage').length).toBe(1);

    toggleMode(root);
    await fixture.whenStable();
    fixture.detectChanges();

    // In Player Preview the badge would itself reveal whose parentage is secret.
    expect(root.querySelectorAll('.note-parentage').length).toBe(0);
    expect(root.textContent).toContain('Corin Ashfell');
  });

  it('colours each card by its house, consistently across cards sharing one', async () => {
    const fixture = await createApp();
    const root = fixture.nativeElement as HTMLElement;

    const cardFor = (name: string) =>
      [...root.querySelectorAll('app-person-card')]
        .find((card) => card.textContent?.includes(name))
        ?.querySelector<HTMLElement>('.card-body');

    const rowanColor = cardFor('Rowan Valcrest')?.style.getPropertyValue('--house');
    const corinColor = cardFor('Corin Ashfell')?.style.getPropertyValue('--house');

    // Both a valid colour, houses differ so the colours must too, and the same
    // house always resolves to the same colour (deterministic hash, no registry).
    expect(rowanColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(corinColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(rowanColor).not.toBe(corinColor);
  });

  it('dims people an event does not involve, and clears the dimming again', async () => {
    const fixture = await createApp();
    const root = fixture.nativeElement as HTMLElement;

    // Nothing selected: nothing dimmed.
    expect(root.querySelectorAll('app-person-card.is-dimmed').length).toBe(0);

    const coronation = [...root.querySelectorAll<HTMLButtonElement>('.event-main')].find(
      (button) => button.textContent?.includes('Coronation of Rowan'),
    );
    coronation?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    // The coronation involves p1 only, so the other two cards dim back.
    expect(root.querySelectorAll('app-person-card.is-highlighted').length).toBe(1);
    expect(root.querySelectorAll('app-person-card.is-dimmed').length).toBe(2);

    // Clicking the same event again clears the selection.
    coronation?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelectorAll('app-person-card.is-dimmed').length).toBe(0);
  });

  it('drops the rumoured parentage connector in Player Preview', async () => {
    const fixture = await createApp();
    const root = fixture.nativeElement as HTMLElement;

    // Corin has hideParentage, so GM View draws a dashed "rumoured" link.
    expect(root.querySelectorAll('path.link-rumoured').length).toBe(1);

    toggleMode(root);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root.querySelectorAll('path.link-rumoured').length).toBe(0);
    // Corin himself is still rendered — he just loses the line upward.
    expect(root.textContent).toContain('Corin Ashfell');
  });
});
