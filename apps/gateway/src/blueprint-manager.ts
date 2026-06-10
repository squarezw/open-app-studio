import { randomUUID } from 'node:crypto';
import type { AppSpec } from '@oas/app-spec';

export interface BlueprintRecord {
  id: string;
  spec: AppSpec;
  runId?: string;
  createdAt: string;
  updatedAt: string;
}

/** In-memory blueprint store (M2). Postgres persistence replaces the Map in M3+. */
export class BlueprintManager {
  private blueprints = new Map<string, BlueprintRecord>();

  create(spec: AppSpec, runId?: string): BlueprintRecord {
    const now = new Date().toISOString();
    const record: BlueprintRecord = { id: randomUUID(), spec, runId, createdAt: now, updatedAt: now };
    this.blueprints.set(record.id, record);
    return record;
  }

  get(id: string): BlueprintRecord | undefined {
    return this.blueprints.get(id);
  }

  list(): BlueprintRecord[] {
    return [...this.blueprints.values()];
  }

  update(id: string, spec: AppSpec): BlueprintRecord | undefined {
    const record = this.blueprints.get(id);
    if (!record) return undefined;
    record.spec = spec;
    record.updatedAt = new Date().toISOString();
    return record;
  }
}
