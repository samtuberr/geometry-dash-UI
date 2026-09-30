import type { Dataset, ImportResult, InputFile } from './types';
export async function runImport(files: InputFile[], base?: Dataset): Promise<ImportResult> {
  const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = event => { resolve(event.data as ImportResult); worker.terminate(); };
    worker.onerror = () => { reject(new Error('Unable to read files in the import worker. Please retry.')); worker.terminate(); };
    worker.postMessage({ files, base }, files.map(f => f.buffer));
  });
}
export async function loadSample(): Promise<Dataset> {
  const get = async (path: string) => { const response = await fetch('/sample/' + path); if (!response.ok) throw new Error(`Could not load sample ${path}.`); return { path: 'sample/' + path, buffer: await response.arrayBuffer() }; };
  const manifest = await get('manifest.json');
  const value = JSON.parse(new TextDecoder().decode(manifest.buffer));
  const files = await Promise.all(['predictions.json', ...value.meshes.flatMap((m: { directory: string }) => [m.directory + '/mesh.json', m.directory + '/segments.json'])].map(get));
  const result = await runImport([manifest, ...files]);
  if (!result.dataset) throw new Error(result.errors.join(' '));
  return { ...result.dataset, name: 'Procedural fixtures', sample: true };
}
export async function prepareFiles(files: File[]): Promise<InputFile[]> {
  const supported = files.filter(f => /\.(stl|json|csv)$/i.test(f.name));
  if (!supported.length) throw new Error('Choose an STL or JSON/CSV files from the results dataset.');
  return Promise.all(supported.map(async f => ({ path: f.webkitRelativePath || f.name, buffer: await f.arrayBuffer() })));
}
// Directory drag and drop preserves paths just like the directory picker.
export async function droppedFiles(items: DataTransferItemList, fallback: FileList): Promise<InputFile[]> {
  const entries = Array.from(items).map(i => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.some(e => e.isDirectory)) return prepareFiles(Array.from(fallback));
  const read = async (entry: FileSystemEntry, path: string): Promise<InputFile[]> => {
    const name = path + entry.name;
    if (entry.isFile) { const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)); return /\.(stl|json|csv)$/i.test(file.name) ? [{ path: name, buffer: await file.arrayBuffer() }] : []; }
    const reader = (entry as FileSystemDirectoryEntry).createReader(); const children: FileSystemEntry[] = [];
    while (true) { const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject)); if (!batch.length) break; children.push(...batch); }
    return (await Promise.all(children.map(c => read(c, name + '/')))).flat();
  };
  return (await Promise.all(entries.map(e => read(e, '')))).flat();
}
export function download(text: string, name: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
