import { Component, computed, inject } from '@angular/core';
import { TreeDataService } from '../../services/tree-data.service';
import { ViewModeService } from '../../services/view-mode.service';

/**
 * Nation/house filter for the tree and timeline.
 *
 * Writes to the shared `ViewModeService`, so the tree and the timeline react
 * together. It reports the adjacent count explicitly, because "12 in House
 * Valcrest + 3 connected by marriage" explains the dimmed cards on the chart far
 * better than a single total would.
 */
@Component({
  selector: 'app-filter-bar',
  imports: [],
  templateUrl: './filter-bar.html',
  styleUrl: './filter-bar.scss',
})
export class FilterBar {
  private readonly treeData = inject(TreeDataService);
  private readonly viewMode = inject(ViewModeService);

  readonly filter = this.viewMode.filter;
  readonly nations = this.treeData.nations;
  readonly houses = this.treeData.houses;

  readonly coreCount = computed<number>(
    () => this.treeData.filteredPeople().filter((entry) => entry.tier === 'core').length,
  );
  readonly adjacentCount = computed<number>(
    () => this.treeData.filteredPeople().filter((entry) => entry.tier === 'adjacent').length,
  );
  readonly totalCount = this.treeData.count;

  readonly isFiltered = computed<boolean>(() => {
    const { nation, house } = this.filter();
    return nation !== null || house !== null;
  });

  onNationChange(value: string): void {
    this.viewMode.setNation(value === '' ? null : value);
  }

  onHouseChange(value: string): void {
    this.viewMode.setHouse(value === '' ? null : value);
  }

  onClear(): void {
    this.viewMode.clearFilter();
  }
}
