import { openDB, type IDBPDatabase } from 'idb'
import type { BacktestResult, Dataset, DatasetMeta, ScriptMeta } from '@/types/domain'

const DB_NAME = 'quantlab-db'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('datasets')) {
          database.createObjectStore('datasets', { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains('scripts')) {
          database.createObjectStore('scripts', { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains('results')) {
          database.createObjectStore('results', { keyPath: 'id' })
        }
        if (!database.objectStoreNames.contains('kv')) {
          database.createObjectStore('kv')
        }
      },
    })
  }
  return dbPromise
}

/* ---------------- Datasets ---------------- */

export async function saveDataset(ds: Dataset): Promise<void> {
  const database = await db()
  await database.put('datasets', ds)
}

export async function getDataset(id: string): Promise<Dataset | undefined> {
  const database = await db()
  return database.get('datasets', id)
}

export async function listDatasets(): Promise<Dataset[]> {
  const database = await db()
  const all = (await database.getAll('datasets')) as Dataset[]
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function listDatasetMetas(): Promise<DatasetMeta[]> {
  const all = await listDatasets()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return all.map(({ data, ...meta }) => meta)
}

export async function deleteDataset(id: string): Promise<void> {
  const database = await db()
  await database.delete('datasets', id)
}

/* ---------------- Scripts ---------------- */

export async function saveScript(script: ScriptMeta): Promise<void> {
  const database = await db()
  await database.put('scripts', script)
}

export async function listScripts(): Promise<ScriptMeta[]> {
  const database = await db()
  const all = (await database.getAll('scripts')) as ScriptMeta[]
  return all.sort((a, b) => a.name.localeCompare(b.name))
}

export async function deleteScript(id: string): Promise<void> {
  const database = await db()
  await database.delete('scripts', id)
}

/* ---------------- Results ---------------- */

export async function saveResult(result: BacktestResult): Promise<void> {
  const database = await db()
  await database.put('results', result)
}

export async function getLatestResult(): Promise<BacktestResult | undefined> {
  const database = await db()
  const all = (await database.getAll('results')) as BacktestResult[]
  return all.sort((a, b) => b.createdAt - a.createdAt)[0]
}

export async function listResults(): Promise<BacktestResult[]> {
  const database = await db()
  const all = (await database.getAll('results')) as BacktestResult[]
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

/* ---------------- KV ---------------- */

export async function kvSet(key: string, value: unknown): Promise<void> {
  const database = await db()
  await database.put('kv', value, key)
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  const database = await db()
  return database.get('kv', key)
}

/* ---------------- Helpers ---------------- */

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function extractMeta(id: string, pair: string, data: { time: number }[], sizeBytes: number): DatasetMeta {
  return {
    id,
    pair,
    bars: data.length,
    startDate: data.length ? data[0].time : 0,
    endDate: data.length ? data[data.length - 1].time : 0,
    sizeBytes,
    createdAt: Date.now(),
  }
}
