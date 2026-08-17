import { Component, computed, inject, signal } from '@angular/core';
import { FilterBar } from './components/filter-bar/filter-bar';
import { GmDossier } from './components/gm-dossier/gm-dossier';
import { PersonForm } from './components/person-form/person-form';
import { TimelineView } from './components/timeline-view/timeline-view';
import { TreeView } from './components/tree-view/tree-view';
import { saveTextFile } from './services/file-export';
import { TimelineDataService } from './services/timeline-data.service';
import { TreeDataService } from './services/tree-data.service';
import { ViewModeService } from './services/view-mode.service';

/** `null` = closed; `{ id: null }` = adding; `{ id }` = editing that person. */
interface FormTarget {
  id: string | null;
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
  imports: [FilterBar, GmDossier, PersonForm, TimelineView, TreeView],
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

  readonly isGmView = this.viewMode.isGmView;
  readonly isPlayerPreview = this.viewMode.isPlayerPreview;
  readonly world = this.treeData.world;
  readonly loading = this.treeData.loading;
  readonly loadError = this.treeData.error;
  readonly hiddenPeopleCount = this.treeData.hiddenCount;

  readonly dirty = computed<boolean>(() => this.treeData.dirty() || this.timelineData.dirty());

  readonly formTarget = signal<FormTarget | null>(null);
  readonly dossierPersonId = signal<string | null>(null);
  readonly statusMessage = signal<string | null>(null);

  constructor() {
    void this.treeData.load();
    void this.timelineData.load();
  }

  onSetMode(mode: 'gm' | 'player'): void {
    // Leaving GM View must also tear down the GM-only panels.
    if (mode === 'player') {
      this.formTarget.set(null);
      this.dossierPersonId.set(null);
    }
    this.viewMode.setMode(mode);
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

  async onSaveWorld(): Promise<void> {
    const peopleOutcome = await saveTextFile(this.treeData.fileName(), this.treeData.serialize());
    if (peopleOutcome === 'cancelled') {
      this.statusMessage.set('Save cancelled.');
      return;
    }
    const eventsOutcome = await saveTextFile(
      this.timelineData.fileName(),
      this.timelineData.serialize(),
    );

    this.statusMessage.set(
      peopleOutcome === 'saved' && eventsOutcome === 'saved'
        ? 'Saved to disk. Re-run "npm run sync-data" if you saved outside the repo data folder.'
        : 'Downloaded — move the files over your repo data/ copies.',
    );
  }

  async onRevert(): Promise<void> {
    await this.treeData.revert();
    await this.timelineData.revert();
    this.statusMessage.set('Reverted to the files on disk.');
  }

  onDismissStatus(): void {
    this.statusMessage.set(null);
  }
}
