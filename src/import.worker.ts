import { importFiles } from './importer';
import type { Dataset, InputFile } from './types';
self.onmessage = (event: MessageEvent<{ files: InputFile[]; base?: Dataset }>) => { self.postMessage(importFiles(event.data.files, event.data.base)); };
