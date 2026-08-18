import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ViewModeService } from './view-mode.service';

/**
 * Covers the click-to-jump / Ctrl-click-to-combine filter model added
 * alongside the multi-select `WorldFilter`. `FilterBar` itself is a thin
 * pass-through onto these methods (plain click → jumpTo*, Ctrl/Cmd-click →
 * toggle*) — the actual selection logic lives here, so that's what's tested
 * directly rather than via simulated DOM clicks with modifier keys.
 */
describe('ViewModeService filter', () => {
  let viewMode: ViewModeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    viewMode = TestBed.inject(ViewModeService);
  });

  it('starts unfiltered', () => {
    expect(viewMode.filter()).toEqual({ nations: [], houses: [] });
  });

  it('jumpToNation replaces the whole selection, clearing any selected houses', () => {
    viewMode.jumpToHouse('Milltree');
    viewMode.jumpToNation('Asha');

    expect(viewMode.filter()).toEqual({ nations: ['Asha'], houses: [] });
  });

  it('jumpToHouse replaces the whole selection, clearing any selected nations', () => {
    viewMode.jumpToNation('Asha');
    viewMode.jumpToHouse('Milltree');

    expect(viewMode.filter()).toEqual({ nations: [], houses: ['Milltree'] });
  });

  it('jumpToNation(null) and jumpToHouse(null) both fully clear the filter', () => {
    viewMode.jumpToNation('Asha');
    viewMode.toggleHouse('Milltree');
    viewMode.jumpToNation(null);
    expect(viewMode.filter()).toEqual({ nations: [], houses: [] });

    viewMode.jumpToNation('Asha');
    viewMode.toggleHouse('Milltree');
    viewMode.jumpToHouse(null);
    expect(viewMode.filter()).toEqual({ nations: [], houses: [] });
  });

  it('toggleNation adds to the current selection without clearing houses — this is "combine"', () => {
    viewMode.jumpToHouse('Milltree');
    viewMode.toggleNation('Asha');

    expect(viewMode.filter()).toEqual({ nations: ['Asha'], houses: ['Milltree'] });
  });

  it('toggleNation/toggleHouse can build a multi-nation, multi-house combined selection', () => {
    viewMode.toggleNation('Asha');
    viewMode.toggleNation('Ethos');
    viewMode.toggleHouse('Milltree');
    viewMode.toggleHouse('Sparrow');

    expect(viewMode.filter()).toEqual({
      nations: ['Asha', 'Ethos'],
      houses: ['Milltree', 'Sparrow'],
    });
  });

  it('toggling an already-selected nation removes it again', () => {
    viewMode.toggleNation('Asha');
    viewMode.toggleNation('Asha');

    expect(viewMode.filter()).toEqual({ nations: [], houses: [] });
  });

  it('clearFilter resets both nations and houses', () => {
    viewMode.toggleNation('Asha');
    viewMode.toggleHouse('Milltree');
    viewMode.clearFilter();

    expect(viewMode.filter()).toEqual({ nations: [], houses: [] });
  });
});
