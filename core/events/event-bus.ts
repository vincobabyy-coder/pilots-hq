import { EventEmitter } from 'events'
import { logger } from '../logger/logger'

type Handler<T> = (payload: T) => void | Promise<void>

class TypedEventBus<Events extends Record<string, unknown>> {
  private emitter: EventEmitter

  constructor() {
    this.emitter = new EventEmitter()
    this.emitter.setMaxListeners(200)
  }

  on<K extends keyof Events & string>(
    event: K,
    handler: Handler<Events[K]>
  ): () => void {
    const wrapped = (payload: Events[K]) => {
      try {
        const result = handler(payload)
        if (result instanceof Promise) {
          result.catch((err) =>
            logger.error('EventBus async handler error', {
              event,
              error: (err as Error).message,
            })
          )
        }
      } catch (err) {
        logger.error('EventBus sync handler error', {
          event,
          error: (err as Error).message,
        })
      }
    }
    this.emitter.on(event, wrapped as (...args: unknown[]) => void)
    return () => this.emitter.off(event, wrapped as (...args: unknown[]) => void)
  }

  once<K extends keyof Events & string>(
    event: K,
    handler: Handler<Events[K]>
  ): void {
    this.emitter.once(event, (payload: Events[K]) => {
      try {
        const result = handler(payload)
        if (result instanceof Promise) {
          result.catch((err) =>
            logger.error('EventBus once async handler error', {
              event,
              error: (err as Error).message,
            })
          )
        }
      } catch (err) {
        logger.error('EventBus once sync handler error', {
          event,
          error: (err as Error).message,
        })
      }
    })
  }

  emit<K extends keyof Events & string>(event: K, payload: Events[K]): void {
    this.emitter.emit(event, payload)
  }

  listenerCount(event: keyof Events & string): number {
    return this.emitter.listenerCount(event)
  }
}

export type PilotsEvents = {
  'route.completed':      { routeId: string; orgId: string; driverId: string; completedAt: string }
  'shipment.delivered':   { shipmentId: string; orgId: string; deliveredAt: string }
  'exception.raised':     { shipmentId: string; orgId: string; reason: string; raisedAt: string }
  'order.allocated':      { orderId: string; warehouseId: string; orgId: string; allocatedAt: string }
  'speed.profile.update': { orgId: string; routeId: string; stops: Array<{ fromLat: number; fromLon: number; toLat: number; toLon: number; actualMinutes: number }> }
}

export const eventBus = new TypedEventBus<PilotsEvents>()
