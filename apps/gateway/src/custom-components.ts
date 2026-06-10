import type { ComponentManifest } from '@oas/component-registry';

export interface CustomComponentRecord {
  manifest: ComponentManifest;
  tsx: string;
  prompt: string;
  attempts: number;
  createdAt: string;
}

/** In-memory project registry for AI-generated components (M3). */
export class CustomComponentStore {
  private components = new Map<string, CustomComponentRecord>();

  add(record: Omit<CustomComponentRecord, 'createdAt'>): CustomComponentRecord {
    const full = { ...record, createdAt: new Date().toISOString() };
    this.components.set(record.manifest.ref, full);
    return full;
  }

  get(ref: string): CustomComponentRecord | undefined {
    return this.components.get(ref);
  }

  list(): CustomComponentRecord[] {
    return [...this.components.values()];
  }
}
