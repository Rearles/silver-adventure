/**
 * Downloads a text file to the user's downloads folder.
 *
 * This is a local backup/disaster-recovery convenience only — the live
 * store (see TreeDataService/TimelineDataService) is the actual save path,
 * reached via the Worker's authenticated write API, not this. See
 * App.onExportBackup().
 */
export function downloadTextFile(fileName: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
