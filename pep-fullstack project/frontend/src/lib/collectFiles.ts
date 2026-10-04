/**
 * Recursively walks a dropped folder (or files) via the FileSystem Entry
 * API, so "drag the case folder onto the browser" works and the images/
 * subfolder is included automatically — not just whatever files happen
 * to be at the top level. Each returned File is renamed to its relative
 * path (e.g. "images/img_0004.jpg") so the backend can route it correctly
 * regardless of upload method (drag-drop vs. the webkitdirectory input).
 */

interface FileSystemEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
}

interface FileSystemFileEntryLike extends FileSystemEntryLike {
  file(success: (file: File) => void, error: (err: DOMException) => void): void;
}

interface FileSystemDirectoryEntryLike extends FileSystemEntryLike {
  createReader(): {
    readEntries(
      success: (entries: FileSystemEntryLike[]) => void,
      error: (err: DOMException) => void,
    ): void;
  };
}

async function walk(entry: FileSystemEntryLike, path: string, out: File[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntryLike;
    const file = await new Promise<File>((resolve, reject) => fileEntry.file(resolve, reject));
    const relPath = `${path}${entry.name}`;
    out.push(new File([file], relPath, { type: file.type }));
    return;
  }

  if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntryLike;
    const reader = dirEntry.createReader();
    // readEntries only returns a batch at a time; must call repeatedly
    // until it returns an empty array.
    let batch: FileSystemEntryLike[];
    do {
      batch = await new Promise<FileSystemEntryLike[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      for (const child of batch) {
        await walk(child, `${path}${entry.name}/`, out);
      }
    } while (batch.length > 0);
  }
}

export async function collectFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items);
  const entries = items
    .map((item) =>
      "webkitGetAsEntry" in item
        ? (item.webkitGetAsEntry() as FileSystemEntryLike | null)
        : null,
    )
    .filter((e): e is FileSystemEntryLike => e !== null);

  if (entries.length === 0) {
    // Browser without FileSystem Entry API support -- fall back to the
    // flat file list (folder structure won't be preserved).
    return Array.from(dataTransfer.files);
  }

  const out: File[] = [];
  for (const entry of entries) {
    await walk(entry, "", out);
  }
  return out;
}
