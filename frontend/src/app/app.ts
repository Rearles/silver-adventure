import { Component, computed, inject, signal } from '@angular/core';
import { BookOpen, Eye, EyeOff, LucideAngularModule } from 'lucide-angular';
import { FilterBar } from './components/filter-bar/filter-bar';
import { GmDossier } from './components/gm-dossier/gm-dossier';
import { LinkPreviewCard } from './components/link-preview-card/link-preview-card';
import { LoreLibrary } from './components/lore-library/lore-library';
import { PersonForm } from './components/person-form/person-form';
import { TimelineView } from './components/timeline-view/timeline-view';
import { TreeView } from './components/tree-view/tree-view';
import { downloadTextFile } from './services/file-export';
import { LoreDataService } from './services/lore-data.service';
import { LoreUiService } from './services/lore-ui.service';
import { SessionService } from './services/session.service';
import { TimelineDataService } from './services/timeline-data.service';
import { TreeDataService } from './services/tree-data.service';
import { ViewModeService } from './services/view-mode.service';

/** `null` = closed; `{ id: null }` = adding; `{ id }` = editing that person. */
interface FormTarget {
  id: string | null;
}

function postWorld(path: string, body: string, token: string): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body,
  });
}

/**
 * Application shell: mode toggle, filter bar, tree, timeline, and the GM-only
 * panels.
 *
 * Everything reads its mode from `ViewModeService`, so one switch moves the whole
 * app. The GM dossier and the person form are behind `@if (isGmView())`, which
 * keeps them out of the component tree and the DOM in Player Preview rather than
 * merely hiding them.
 */
@Component({
  selector: 'app-root',
  imports: [
    FilterBar,
    GmDossier,
    LinkPreviewCard,
    LoreLibrary,
    LucideAngularModule,
    PersonForm,
    TimelineView,
    TreeView,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: {
    '[class.player-mode]': 'isPlayerPreview()',
  },
})
export class App {
  private readonly viewMode = inject(ViewModeService);
  private readonly treeData = inject(TreeDataService);
  private readonly timelineData = inject(TimelineDataService);
  private readonly loreData = inject(LoreDataService);
  private readonly loreUi = inject(LoreUiService);
  private readonly session = inject(SessionService);

  readonly EyeIcon = Eye;
  readonly EyeOffIcon = EyeOff;
  readonly BookOpenIcon = BookOpen;

  readonly isGmView = this.viewMode.isGmView;
  readonly isPlayerPreview = this.viewMode.isPlayerPreview;
  readonly world = this.treeData.world;

  /**
   * "House {name} — Dynasty Ledger" when exactly one house is in focus.
   * TODO(rework-event-dates plan, next step): with true multi-select, 2+
   * houses selected together falls back to the unfiltered title below — how
   * a combined selection should read is next step's call, not decided here.
   */
  readonly ledgerTitle = computed<string>(() => {
    const houses = this.viewMode.filter().houses;
    return houses.length === 1 ? `House ${houses[0]} — Dynasty Ledger` : 'Dynasty Ledger';
  });

  /**
   * The eyebrow names the nation in focus, or a nation-count summary when
   * unfiltered — never the internal world/file id, which is not meant to be
   * player- or GM-facing text. Same 2+-selected caveat as `ledgerTitle`.
   */
  readonly eyebrow = computed<string>(() => {
    const selectedNations = this.viewMode.filter().nations;
    if (selectedNations.length === 1) return `Kingdom of ${selectedNations[0]}`;

    const nations = this.treeData.nations();
    if (nations.length === 0) return '';
    if (nations.length === 1) return nations[0];
    return `${nations.length} Nations`;
  });
  readonly loading = this.treeData.loading;
  readonly loadError = this.treeData.error;
  readonly hiddenPeopleCount = this.treeData.hiddenCount;

  readonly dirty = computed<boolean>(
    () => this.treeData.dirty() || this.timelineData.dirty() || this.loreData.dirty(),
  );

  readonly formTarget = signal<FormTarget | null>(null);
  readonly dossierPersonId = signal<string | null>(null);
  readonly statusMessage = signal<string | null>(null);
  readonly loreOpen = signal<boolean>(false);

  /** Open either via the header toggle, or because a `[[Wiki Link]]` click asked for a specific doc. */
  readonly showLore = computed<boolean>(() => this.loreOpen() || this.loreUi.openDocId() !== null);

  constructor() {
    void this.treeData.load();
    void this.timelineData.load();
    void this.loreData.load();
  }

  async onSetMode(mode: 'gm' | 'player'): Promise<void> {
    // Leaving GM View must also tear down the GM-only panels.
    if (mode === 'player') {
      this.formTarget.set(null);
      this.dossierPersonId.set(null);
    }
    // Entering GM View may prompt for the password — setMode no-ops back to
    // the current mode if that's declined, so nothing further to branch on.
    await this.viewMode.setMode(mode);
  }

  async onToggleMode(): Promise<void> {
    await this.onSetMode(this.isGmView() ? 'player' : 'gm');
  }

  onAddPerson(): void {
    this.dossierPersonId.set(null);
    this.formTarget.set({ id: null });
  }

  onEditPerson(personId: string): void {
    this.dossierPersonId.set(null);
    this.formTarget.set({ id: personId });
  }

  onCloseForm(): void {
    this.formTarget.set(null);
  }

  onOpenDossier(personId: string): void {
    this.formTarget.set(null);
    this.dossierPersonId.set(personId);
  }

  onCloseDossier(): void {
    this.dossierPersonId.set(null);
  }

  onToggleLore(): void {
    this.loreOpen.update((open) => !open);
  }

  onCloseLore(): void {
    this.loreOpen.set(false);
    this.loreUi.close();
  }

  async onSaveWorld(): Promise<void> {
    const token = this.session.token();
    if (token === null) {
      this.statusMessage.set('Sign in as GM (via the GM View toggle) to save.');
      return;
    }

    const world = this.treeData.world();
    try {
      const [peopleRes, eventsRes, loreRes] = await Promise.all([
        postWorld(`/api/world/${encodeURIComponent(world)}`, this.treeData.serialize(), token),
        postWorld(`/api/world/${encodeURIComponent(world)}/events`, this.timelineData.serialize(), token),
        postWorld(`/api/world/${encodeURIComponent(world)}/lore`, this.loreData.serialize(), token),
      ]);

      if (peopleRes.status === 401 || eventsRes.status === 401 || loreRes.status === 401) {
        this.session.clear();
        this.statusMessage.set('Your GM session expired — sign in again to save.');
        return;
      }
      if (!peopleRes.ok || !eventsRes.ok || !loreRes.ok) {
        throw new Error(`people ${peopleRes.status}, events ${eventsRes.status}, lore ${loreRes.status}`);
      }

      // _dirty on both services clears itself shortly, via the write's own
      // broadcast looping back over this tab's live WebSocket — no need to
      // set it here too.
      this.statusMessage.set('Saved — live for everyone with the link.');
    } catch (cause) {
      this.statusMessage.set(cause instanceof Error ? `Save failed: ${cause.message}` : 'Save failed.');
    }
  }

  async onRevert(): Promise<void> {
    await this.treeData.revert();
    await this.timelineData.revert();
    await this.loreData.revert();
    this.statusMessage.set('Reverted to the last saved version.');
  }

  /** A local snapshot, independent of the live store — disaster-recovery copy, not the save path. */
  onExportBackup(): void {
    downloadTextFile(this.treeData.fileName(), this.treeData.serialize());
    downloadTextFile(this.timelineData.fileName(), this.timelineData.serialize());
    downloadTextFile(this.loreData.fileName(), this.loreData.serialize());
    this.statusMessage.set('Downloaded a local backup of the current people, events, and lore.');
  }

  onDismissStatus(): void {
    this.statusMessage.set(null);
  }
}
