/**
 * Writes a text file to the user's disk.
 *
 * Prefers the File System Access API, which lets the GM save straight back over
 * `data/{world}.json` — the round trip the C# tools in `/tools` also operate on.
 * Browsers without it fall back to an ordinary download, which lands in the
 * downloads folder and has to be moved over the original by hand.
 */

interface FileSystemWritable {
  write(data: string): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritable>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}

type SaveFilePicker = (options: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;

function getSaveFilePicker(): SaveFilePicker | null {
  const candidate = (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof candidate === 'function' ? (candidate as SaveFilePicker) : null;
}

export function canSaveInPlace(): boolean {
  return getSaveFilePicker() !== null;
}

export type SaveOutcome = 'saved' | 'downloaded' | 'cancelled';

export async function saveTextFile(
  suggestedName: string,
  contents: string,
): Promise<SaveOutcome> {
  const picker = getSaveFilePicker();

  if (picker !== null) {
    try {
      const handle = await picker({
        suggestedName,
        types: [{ description: 'JSON world file', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
      return 'saved';
    } catch (cause) {
      // An AbortError means the GM dismissed the picker; anything else falls
      // through to the download path rather than losing the edit.
      if (cause instanceof DOMException && cause.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  downloadTextFile(suggestedName, contents);
  return 'downloaded';
}

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
