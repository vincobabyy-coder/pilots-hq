import * as sqlite3 from 'sqlite3'
import { VehicleTelemetry, QueuedTelemetry } from './types'

export class TelemetryQueue {
  private db: sqlite3.Database
  private initialized: boolean = false

  constructor(dbPath: string = ':memory:') {
    this.db = new sqlite3.Database(dbPath)
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run(
          `
          CREATE TABLE IF NOT EXISTS telemetry_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            vehicle_id TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            synced BOOLEAN DEFAULT 0
          )
        `,
          (err) => {
            if (err) {
              reject(err)
            } else {
              this.initialized = true
              resolve()
            }
          }
        )
      })
    })
  }

  async enqueue(telemetry: VehicleTelemetry): Promise<number> {
    if (!this.initialized) {
      throw new Error('Queue not initialized')
    }

    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO telemetry_queue (vehicle_id, data, created_at, synced) VALUES (?, ?, ?, ?)',
        [telemetry.vehicleId, JSON.stringify(telemetry), telemetry.timestamp, false],
        function (err) {
          if (err) {
            reject(err)
          } else {
            resolve(this.lastID as number)
          }
        }
      )
    })
  }

  async getUnsynced(limit: number = 100): Promise<QueuedTelemetry[]> {
    if (!this.initialized) {
      throw new Error('Queue not initialized')
    }

    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT id, data, created_at FROM telemetry_queue WHERE synced = 0 LIMIT ?',
        [limit],
        (err, rows: any[]) => {
          if (err) {
            reject(err)
          } else {
            const queued = rows.map((row) => ({
              id: row.id,
              data: JSON.parse(row.data),
              createdAt: row.created_at,
              synced: false,
            }))
            resolve(queued)
          }
        }
      )
    })
  }

  async markSynced(ids: number[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('Queue not initialized')
    }

    if (ids.length === 0) return

    return new Promise((resolve, reject) => {
      const placeholders = ids.map(() => '?').join(',')
      this.db.run(
        `UPDATE telemetry_queue SET synced = 1 WHERE id IN (${placeholders})`,
        ids,
        (err) => {
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        }
      )
    })
  }

  async clear(): Promise<void> {
    if (!this.initialized) {
      throw new Error('Queue not initialized')
    }

    return new Promise((resolve, reject) => {
      this.db.run('DELETE FROM telemetry_queue', (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }
}
