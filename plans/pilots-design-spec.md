# PILOTS — Prism Intelligent Logistics & Operations Tracking System
## Design Specification + Implementation Plan
**Date:** 2026-04-26  
**Project root:** `/Users/tifeatere/Desktop/GOV/pilots`  
**Status:** Approved for implementation

---

## Context

PILOTS is a multi-tenant, global logistics intelligence SaaS platform. The vision is to own every layer of the logistics stack the way Google owns every layer of the internet — the infrastructure, the algorithms, the API, the dashboard, the driver app, the truck computer client. No external vendor can break us because we built it all.

This is a long-build project (6–12+ months). It is built week by week, subsystem by subsystem, with each week producing a complete, tested, production-quality vertical slice. There are no shortcuts, no half-finished modules, no "we'll fix that later." Every piece is built once and built correctly.

---

## The Proprietary Principle

**The line:**

| Category | Examples | Decision |
|----------|----------|----------|
| CPU, OS, network protocols (TCP/IP) | Linux, TCP, TLS | External — impossible to build |
| Language runtime | Node.js V8 engine | External — impossible to build |
| Language toolchain | TypeScript compiler (`tsc`) | External — compiler infrastructure |
| Database engine | PostgreSQL 15 + TimescaleDB | External — 30 years of engineering |
| Database wire protocol driver | `pg` (PostgreSQL), `ioredis` (Redis) | External — protocol implementation only |
| UI framework primitives | React (web), React Native (mobile) | External — rendering engine/mobile runtime |
| **Everything else** | HTTP server, router, WebSocket, job queue, JWT, auth, algorithms, ORM, validation, caching, logging, rate-limiting, all business logic | **PROPRIETARY — we build it** |

**Allowed `package.json` dependencies (and nothing else):**
```
pg                  — PostgreSQL wire protocol
ioredis             — Redis RESP protocol  
typescript          — Compiler (devDependency)
react               — Web UI rendering
react-native        — Mobile UI/runtime
react-dom           — Web DOM rendering
@types/*            — TypeScript type definitions (devDependencies only)
```

Everything else is our code. No Express. No Socket.io. No Bull. No JWT library. No bcrypt. No Zod. No lodash. No axios. No ORM. No test runner (we write our own). No build tool beyond `tsc`. If it can be written in TypeScript using Node.js built-in modules (`http`, `net`, `crypto`, `fs`, `events`, `stream`, `worker_threads`), we write it.

---

## System Architecture — 8 Proprietary Layers

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 8: Client Surfaces                                    │
│  Web Dashboard · Driver Mobile App · Truck Client · Portal  │
├─────────────────────────────────────────────────────────────┤
│  Layer 7: Real-Time Communication                            │
│  Custom WebSocket Server (Node.js net module)               │
├─────────────────────────────────────────────────────────────┤
│  Layer 6: Job Orchestration                                  │
│  Custom Job Queue + Scheduler (Redis-backed, zero deps)     │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: Algorithm Engines (all proprietary)               │
│  Route Optimizer · Tracker · Allocator · Predictor · Fraud  │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: Custom HTTP Server + API                           │
│  Router · Middleware chain · Request/Response lifecycle      │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Proprietary Data Access                            │
│  Query Builder · Connection Pool · Migration Runner         │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Infrastructure Primitives                          │
│  PostgreSQL 15 + TimescaleDB · Redis 7                      │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: Runtime                                            │
│  Node.js 20 LTS · TypeScript 5                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Project Structure

```
pilots/
├── core/                        # Shared proprietary primitives
│   ├── http/                    # Custom HTTP server
│   │   ├── server.ts            # Node.js http.createServer wrapper
│   │   ├── router.ts            # Trie-based router
│   │   ├── middleware.ts        # Middleware pipeline
│   │   ├── request.ts           # Parsed request object
│   │   └── response.ts          # Response builder
│   ├── ws/                      # Custom WebSocket server
│   │   ├── server.ts            # WebSocket upgrade handler
│   │   ├── connection.ts        # Connection lifecycle
│   │   └── rooms.ts             # Room-based pub/sub
│   ├── queue/                   # Custom job queue
│   │   ├── queue.ts             # Redis-backed queue
│   │   ├── worker.ts            # Job processor
│   │   └── scheduler.ts        # Cron-style scheduling
│   ├── db/                      # Proprietary data access
│   │   ├── pool.ts              # Connection pool wrapper
│   │   ├── query-builder.ts    # SQL query builder
│   │   └── migrator.ts         # Migration runner
│   ├── auth/                    # Proprietary auth
│   │   ├── jwt.ts               # JWT sign/verify (Node.js crypto)
│   │   ├── password.ts          # pbkdf2 hashing (Node.js crypto)
│   │   └── middleware.ts        # Auth middleware
│   ├── cache/                   # Proprietary cache layer
│   │   └── cache.ts             # Redis-backed with TTL + invalidation
│   ├── validation/              # Proprietary schema validation
│   │   └── schema.ts            # Runtime type validation (no Zod)
│   ├── logger/                  # Structured logging
│   │   └── logger.ts            # JSON logs (no pino/winston)
│   └── events/                  # Internal event bus
│       └── event-bus.ts         # In-process pub/sub
│
├── engines/                     # Proprietary algorithm engines
│   ├── route-optimizer/
│   │   ├── vrp.ts               # Vehicle Routing Problem solver
│   │   ├── branch-and-bound.ts  # B&B with pruning
│   │   ├── distance-matrix.ts   # Haversine + learned speeds
│   │   └── greedy-init.ts       # Initial feasible solution
│   ├── tracking/
│   │   ├── event-log.ts         # Immutable append-only log
│   │   ├── state-machine.ts     # Event → state transitions
│   │   ├── commands.ts          # CQRS write side
│   │   ├── queries.ts           # CQRS read side
│   │   └── spatial-index.ts    # R-tree for location queries
│   ├── allocation/
│   │   ├── bipartite-graph.ts   # Order ↔ warehouse graph
│   │   └── hungarian.ts        # Hungarian algorithm (optimal assignment)
│   ├── analytics/
│   │   ├── time-series.ts       # Trend + seasonality decomposition
│   │   ├── demand-forecast.ts   # Additive model projection
│   │   ├── delivery-predictor.ts # Speed patterns from historical data
│   │   └── percentile.ts        # Histogram-based P50/P95/P99
│   └── fraud/
│       ├── detector.ts          # Z-score anomaly detection
│       ├── baseline.ts          # Statistical baseline trainer
│       └── cusum.ts             # CUSUM control chart
│
├── api/                         # HTTP API layer
│   ├── routes/
│   │   ├── orders.ts
│   │   ├── shipments.ts
│   │   ├── routes.ts
│   │   ├── drivers.ts
│   │   ├── warehouses.ts
│   │   ├── analytics.ts
│   │   └── auth.ts
│   ├── middleware/
│   │   ├── rate-limiter.ts      # Proprietary rate limiting
│   │   ├── tenant.ts            # Multi-tenant context
│   │   └── error-handler.ts
│   └── services/                # Business logic layer
│       ├── order.service.ts
│       ├── shipment.service.ts
│       ├── route.service.ts
│       └── driver.service.ts
│
├── db/
│   ├── migrations/              # SQL migration files
│   └── schema.sql               # Full schema
│
├── clients/
│   ├── web/                     # React web dashboard
│   ├── mobile/                  # React Native driver app
│   ├── truck/                   # Embedded Node.js truck client
│   └── portal/                  # React customer portal
│
└── tests/                       # Proprietary test runner
    ├── runner.ts                # Our test runner (no Jest)
    └── ...
```

---

## Database Schema (12 Tables)

All tables follow: UUID primary keys, `created_at` immutable, `updated_at` mutable, org-scoped indexes, foreign key constraints enforced at DB level.

```sql
-- Multi-tenancy root
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  country_code VARCHAR(2),
  currency_code VARCHAR(3) DEFAULT 'USD',
  api_key VARCHAR(255) UNIQUE,
  webhook_secret_encrypted VARCHAR(500),
  features JSONB DEFAULT '{}'::jsonb,
  settings JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL,   -- admin, operator, dispatcher, viewer
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, email)
);
CREATE INDEX idx_users_org ON users(org_id);

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(30),
  address JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_customers_org ON customers(org_id);

CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  lat DECIMAL(10,7) NOT NULL,
  lon DECIMAL(10,7) NOT NULL,
  address JSONB NOT NULL,
  capacity_units INT,
  current_units INT DEFAULT 0,
  operating_hours JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_warehouses_org ON warehouses(org_id);

CREATE TABLE warehouse_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  sku VARCHAR(100) NOT NULL,
  quantity INT DEFAULT 0,
  reserved_quantity INT DEFAULT 0,
  last_updated TIMESTAMP DEFAULT NOW(),
  UNIQUE(warehouse_id, sku)
);
CREATE INDEX idx_inventory_sku ON warehouse_inventory(sku);

CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  license_plate VARCHAR(20) NOT NULL,
  type VARCHAR(50),            -- van, truck, container
  capacity_kg INT,
  capacity_cbm DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'available',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, license_plate)
);

CREATE TABLE drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(255),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  status VARCHAR(50) DEFAULT 'inactive',
  current_lat DECIMAL(10,7),
  current_lon DECIMAL(10,7),
  performance_rating DECIMAL(3,2) DEFAULT 5.0,
  total_deliveries INT DEFAULT 0,
  on_time_count INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_drivers_org ON drivers(org_id);
CREATE INDEX idx_drivers_status ON drivers(status);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  order_number VARCHAR(50) NOT NULL,
  origin_address JSONB NOT NULL,
  destination_address JSONB NOT NULL,
  dest_lat DECIMAL(10,7),
  dest_lon DECIMAL(10,7),
  items JSONB NOT NULL,
  total_weight_kg DECIMAL(10,2),
  total_volume_cbm DECIMAL(10,2),
  status VARCHAR(50) DEFAULT 'pending',
  allocated_warehouse_id UUID REFERENCES warehouses(id),
  scheduled_delivery_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, order_number)
);
CREATE INDEX idx_orders_org_status ON orders(org_id, status);
CREATE INDEX idx_orders_customer ON orders(customer_id);

CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  shipment_number VARCHAR(50) NOT NULL,
  origin_warehouse_id UUID REFERENCES warehouses(id),
  destination_address JSONB NOT NULL,
  dest_lat DECIMAL(10,7),
  dest_lon DECIMAL(10,7),
  status VARCHAR(50) DEFAULT 'created',
  assigned_route_id UUID,
  assigned_driver_id UUID REFERENCES drivers(id),
  estimated_delivery TIMESTAMP,
  actual_delivery TIMESTAMP,
  exception_flag BOOLEAN DEFAULT false,
  exception_reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, shipment_number)
);
CREATE INDEX idx_shipments_org_status ON shipments(org_id, status);
CREATE INDEX idx_shipments_driver ON shipments(assigned_driver_id);

CREATE TABLE shipment_orders (
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  PRIMARY KEY (shipment_id, order_id)
);

CREATE TABLE routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route_number VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  driver_id UUID REFERENCES drivers(id),
  vehicle_id UUID REFERENCES vehicles(id),
  status VARCHAR(50) DEFAULT 'planned',
  origin_warehouse_id UUID REFERENCES warehouses(id),
  stops JSONB NOT NULL DEFAULT '[]',
  total_distance_km DECIMAL(10,2),
  estimated_duration_minutes INT,
  actual_duration_minutes INT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(org_id, route_number, date)
);
CREATE INDEX idx_routes_org_date ON routes(org_id, date);
CREATE INDEX idx_routes_driver_date ON routes(driver_id, date);

-- Time-series: converted to TimescaleDB hypertable
CREATE TABLE tracking_events (
  id UUID DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  event_type VARCHAR(100) NOT NULL,
  event_status VARCHAR(100),
  lat DECIMAL(10,7),
  lon DECIMAL(10,7),
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
);
SELECT create_hypertable('tracking_events', 'created_at', if_not_exists => TRUE);
CREATE INDEX idx_tracking_shipment_time ON tracking_events(shipment_id, created_at DESC);
```

---

## Layer 4: Custom HTTP Server

Built on Node.js built-in `http` module. No Express.

**Architecture:**
- `PilotsServer` class wraps `http.createServer`
- Trie-based router (prefix tree, O(log n) route lookup)
- Middleware pipeline: ordered array of `(req, res, next) => void`
- Typed `PilotsRequest` and `PilotsResponse` objects wrapping Node's `IncomingMessage` / `ServerResponse`
- JSON body parsing built-in
- Multipart/form-data parser built-in (for file uploads)
- Streaming support built-in

**Standard middleware stack (in order):**
1. Security headers (X-Content-Type-Options, X-Frame-Options, HSTS, CSP)
2. CORS handler
3. Request logger (structured JSON)
4. JSON body parser
5. JWT authentication
6. Multi-tenant context injection (org_id from JWT)
7. Rate limiter (token bucket algorithm, Redis-backed)
8. Schema validator

**Response format (always consistent):**
```json
{ "success": true, "data": {}, "meta": { "requestId": "uuid", "timestamp": "ISO-8601", "ms": 14 } }
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "fields": [] }, "meta": {} }
```

---

## Layer 5: Algorithm Engines

### Engine 1 — Route Optimizer (VRP)

**Problem:** Given N delivery stops, M vehicles with capacities and time windows, find routes minimizing total distance.

**Algorithm:** Branch-and-Bound with nearest-insertion lower bound pruning
- Greedy initial solution (nearest-neighbor heuristic) establishes upper bound
- Branch: try inserting each unserved order at every position in every existing route
- Bound: lower bound = current cost + nearest-insertion estimate for remaining orders
- Prune: any branch exceeding current best is cut immediately
- Time limit: 30 seconds, returns best found so far

**Distance:** Haversine formula (great-circle distance). Travel time estimated from learned speed profiles per (hour, day-of-week) tuple, stored in PostgreSQL, updated from historical data after every completed route.

**Constraints enforced:** Vehicle capacity (kg + cbm), delivery time windows, driver working hours, return-to-warehouse deadline.

**Output:** Array of `Route` objects, each with ordered stops, total distance, estimated duration, vehicle + driver assignment.

### Engine 2 — Tracking Engine (Event Sourcing + CQRS)

**Architecture:** Immutable append-only event log. State is never stored — it is derived by replaying events.

**Event types:** `created`, `allocated`, `in_transit`, `location_updated`, `out_for_delivery`, `delivered`, `failed_delivery`, `exception`, `cancelled`

**Write side (Commands):** Append event → persist to `tracking_events` → publish to WebSocket rooms → trigger exception detection

**Read side (Queries):** Reconstruct state by replaying event sequence. Materialized views cached in Redis for fast reads (current status, last location, analytics aggregates). Cache invalidated on every event append.

**Exception detection:** Runs automatically after every `location_updated` event. Checks: delivery late by >2h, no location update >45 min, location anomaly (position jumps >50km in <10 min).

**Spatial index:** Proprietary R-tree (not rbush library) for "find all shipments within X km of point" queries. Built on coordinate bounding boxes, filtered by Haversine for precision.

### Engine 3 — Allocation Engine (Bipartite Matching)

**Problem:** Assign each incoming order to the optimal warehouse.

**Algorithm:** Hungarian algorithm (Kuhn-Munkres), O(n³), optimal assignment guaranteed.

**Cost function per edge (order → warehouse):**
```
cost = haversine_distance(order.origin, warehouse.location)
     + (inventory_deficit > 0 ? 1000 : 0)        // penalty: insufficient stock
     + (utilization > 0.8 ? utilization * 200 : 0) // penalty: near capacity
```

**Output:** `Map<orderId, warehouseId>` — optimal assignment for the entire batch.

### Engine 4 — Predictive Analytics

**Delivery time prediction:** Learn (hour, day-of-week) → average speed + std deviation from historical deliveries. Predict = distance / learned_speed. Confidence interval = ±2σ. Updated incrementally after every completed delivery.

**Demand forecasting:** Additive decomposition model (Trend + Seasonality + Residual).
- Trend: 7-day moving average
- Seasonality: mean day-of-week effect after detrending
- Projection: linear trend extrapolation + repeating seasonal pattern + 95% CI (±1.96σ)

**Percentile histograms:** All performance metrics (delivery time, API response time, route distance) stored as fixed-bucket histograms, not raw values. P50/P95/P99 computed in O(n_buckets) = O(1).

**HyperLogLog:** Proprietary implementation for estimating unique counts (unique drivers active, unique customers served) without storing full sets.

### Engine 5 — Fraud Detector

**Baseline training:** Compute μ and σ for delivery time, stops per route, inter-delivery distances. Trained from historical data, retrained weekly via job queue.

**Anomaly checks (Z-score):**
- Delivery time z-score > 3σ (too fast — skipped stops?)
- Fewer stops completed than expected (>20% shortfall)
- Location jump >50km in <10 min (GPS spoofing or bad data)
- Repeated failed deliveries at same address (address fraud)

**CUSUM chart:** Cumulative sum control chart tracks persistent drift in driver behavior (not just single-point anomalies).

**Output:** `{ isAnomaly: boolean, score: number, reasons: string[] }` — attached to every completed delivery record.

---

## Layer 6: Custom Job Queue

Built on Redis. No Bull, no BullMQ.

**Features:**
- Named queues with configurable concurrency
- Job persistence (jobs survive server restart)
- Retries with exponential backoff (configurable max attempts)
- Dead-letter queue for permanently failed jobs
- Scheduled jobs (cron-style) using Redis sorted sets (score = next run timestamp)
- Job progress reporting via WebSocket

**Scheduled jobs:**
- Route optimization: daily at 06:00 per org timezone
- Fraud baseline retraining: weekly Sunday 02:00
- Demand forecast update: daily 00:30
- Speed profile update: daily 01:00 (learn from yesterday's completed routes)
- Notification dispatch: every 5 minutes (batch SMS/email)

---

## Layer 7: Custom WebSocket Server

Built on Node.js `net` module implementing RFC 6455 WebSocket protocol from scratch. No Socket.io.

**Features:**
- HTTP → WebSocket upgrade handshake (SHA-1 key hashing, base64, built with Node.js `crypto`)
- Frame parsing/serialization (opcodes: text, binary, ping, pong, close)
- Room-based pub/sub: clients subscribe to `shipment:{id}`, `org:{id}`, `driver:{id}`
- Redis-backed room state (supports multiple server instances / horizontal scaling)
- Heartbeat (ping/pong) every 30 seconds, drop dead connections at 90 seconds
- Reconnection handled client-side with exponential backoff

**Channels:**
- `shipment:{id}` — real-time status + location for a single shipment
- `org:{id}:operations` — all org-level events (new orders, exceptions, deliveries)
- `driver:{id}:route` — driver's current route + next stop
- `truck:{vin}:telemetry` — truck IoT telemetry stream

---

## Proprietary Utilities (no external packages)

### JWT (core/auth/jwt.ts)
Built on Node.js `crypto.createHmac('sha256', secret)`. Implements:
- `sign(payload, secret, expiresIn)` → token string
- `verify(token, secret)` → payload or throw
- Header: `{"alg":"HS256","typ":"JWT"}`, base64url encoded

### Password hashing (core/auth/password.ts)
Built on Node.js `crypto.pbkdf2Sync`. 100,000 iterations, SHA-512, 64-byte salt, 64-byte hash. Stored as `salt:hash` hex string.

### Schema validation (core/validation/schema.ts)
Proprietary runtime validation. Defines `Schema` class with chainable validators: `.string()`, `.number()`, `.uuid()`, `.email()`, `.min()`, `.max()`, `.required()`, `.object({...})`, `.array()`. Returns typed result `{ ok: boolean, errors: FieldError[] }`.

### Rate limiter (api/middleware/rate-limiter.ts)
Token bucket algorithm. Bucket state stored in Redis. Each bucket: `{ tokens, lastRefill }`. Refill rate configurable per endpoint. Returns 429 with `Retry-After` header.

### Logger (core/logger/logger.ts)
Writes structured JSON lines to stdout. Fields: `{ level, ts, requestId, orgId, msg, ...context }`. No winston, no pino.

### Test runner (tests/runner.ts)
Proprietary async test runner. `describe(name, fn)`, `it(name, fn)`, `expect(value).toBe()/.toEqual()/.toThrow()`. Runs tests concurrently by file, sequentially within file. Outputs TAP-compatible results.

---

## Client Surfaces

### Web Dashboard (clients/web/)
React 18 + TypeScript. Custom HTTP client (no axios — built on `fetch` API which is web-standard, not an npm package). Custom state management (no Redux/Zustand — proprietary reactive store built on `EventEmitter`). Real-time via our WebSocket client.

**Pages:** Login · Org Dashboard · Orders · Shipments · Route Map · Driver Management · Warehouse Management · Analytics · Settings

### Driver Mobile App (clients/mobile/)
React Native + TypeScript. GPS via `react-native`'s built-in `Geolocation`. Offline-capable: pending location updates queued locally, synced when reconnected. Push notifications via our WebSocket (no Firebase/FCM dependency for the app layer — messages come through our WS server).

**Screens:** Login · My Route · Current Delivery · Mark Delivered (photo + signature) · Navigation (map view) · History

### Truck Computer Client (clients/truck/)
Lightweight Node.js TypeScript process designed for embedded Linux (in-cab computers). Connects to our WebSocket server. Streams: GPS location (every 10s), speed, engine status (if available via OBD-II USB adapter). Reconnects automatically. Operates offline (buffers events, flushes on reconnect).

### Customer Portal (clients/portal/)
React 18 + TypeScript. Standalone web app (separate domain from dashboard). Customers enter tracking number, see live shipment location on map, full event history, estimated delivery window (from Predictive engine).

---

## API Endpoints

```
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh

POST   /api/v1/orders
GET    /api/v1/orders?status=&page=&limit=
GET    /api/v1/orders/:id
PATCH  /api/v1/orders/:id/status

POST   /api/v1/shipments
GET    /api/v1/shipments/:id
GET    /api/v1/shipments/:id/events
GET    /api/v1/shipments?status=&page=&limit=
PATCH  /api/v1/shipments/:id/exception

POST   /api/v1/routes/optimize          (triggers async job)
GET    /api/v1/routes/jobs/:jobId        (poll optimization status)
GET    /api/v1/routes/:id
POST   /api/v1/routes/:id/confirm
PATCH  /api/v1/routes/:id/reassign

POST   /api/v1/drivers
GET    /api/v1/drivers/:id
PATCH  /api/v1/drivers/:id/location      (mobile app, every 10s)
GET    /api/v1/drivers/:id/route
POST   /api/v1/drivers/:id/delivery-complete

GET    /api/v1/warehouses
POST   /api/v1/warehouses
GET    /api/v1/warehouses/:id/inventory
POST   /api/v1/orders/allocate           (triggers allocation engine)

GET    /api/v1/analytics/kpis
GET    /api/v1/analytics/timeseries?metric=&from=&to=
GET    /api/v1/analytics/forecasts
GET    /api/v1/analytics/exceptions

GET    /api/v1/tracking/:shipmentNumber  (public, no auth — customer portal)
```

---

## 8-Week Build Sequence

**Week 1 — Core Infrastructure**
- Project scaffold (`pilots/` directory, `tsconfig.json`, zero-dep constraint enforced)
- Custom HTTP server (`core/http/`)
- Proprietary JWT auth (`core/auth/`)
- Proprietary schema validation (`core/validation/`)
- Structured logger (`core/logger/`)
- PostgreSQL connection pool + query builder (`core/db/`)
- Migration runner + Week 1 schema (organizations, users, warehouses, customers)
- Auth endpoints: login, refresh, me
- Multi-tenant middleware (org context on every request)
- Rate limiter (token bucket)
- Proprietary test runner + tests for all of the above
- **Output:** Running authenticated multi-tenant API, all core primitives complete

**Week 2 — Route Optimizer**
- Distance matrix with Haversine formula + speed learning
- Greedy nearest-neighbor initial solution
- Branch-and-bound solver with lower-bound pruning
- Time window + capacity feasibility checker
- Insertion cost calculator
- Orders + vehicles + routes DB schema
- Route API endpoints (optimize, confirm, reassign)
- Async optimization via job queue (Week 2 queue: simple Redis list, full queue built Week 4)
- Tests: correctness on known small instances, performance benchmark (<5s for 50 stops)
- **Output:** POST /routes/optimize returns optimal routes for a day's orders

**Week 3 — Tracking Engine + WebSocket Server**
- RFC 6455 WebSocket server from Node.js `net`
- Room-based pub/sub + Redis cluster state
- Immutable event log (append-only writes)
- Event → state reducer (pure function)
- CQRS split: commands (appendEvent) + queries (getCurrentState, findLate)
- Materialized view cache in Redis
- Exception auto-detection (late, stale, location anomaly)
- Tracking endpoints + driver location update endpoint
- Proprietary R-tree spatial index
- Tests: event sourcing correctness, WebSocket handshake, room pub/sub
- **Output:** Live shipment tracking with sub-second WebSocket updates

**Week 4 — Allocation Engine + Full Job Queue**
- Full proprietary job queue (persistence, retries, dead-letter, scheduler)
- Hungarian algorithm implementation
- Bipartite graph builder (order × warehouse cost matrix)
- Allocation API endpoint + integration with order creation flow
- Inventory management (reserve, release, reorder alerts)
- Scheduled jobs: route optimization, fraud retraining, forecast update
- Tests: Hungarian on known optimal instances, queue persistence across restart
- **Output:** Orders automatically allocated to optimal warehouse; job queue running all scheduled tasks

**Week 5 — Predictive Analytics + Fraud Detector**
- Speed profile learner (trained from completed routes)
- Delivery time predictor with confidence intervals
- Demand forecaster (trend + seasonality + projection)
- Histogram-based percentile calculator
- HyperLogLog implementation
- Fraud baseline trainer (μ, σ per metric)
- Z-score anomaly detector
- CUSUM control chart
- Analytics API endpoints
- Weekly fraud retraining scheduled job
- Tests: forecast accuracy on synthetic data, fraud detection on labeled anomalies
- **Output:** Delivery predictions, demand forecasts, automatic fraud scores on all completions

**Week 6 — Web Dashboard**
- React 18 + TypeScript scaffold (no create-react-app — custom webpack config? No — use tsc + custom HTML entry)
- Proprietary HTTP client (fetch-based, typed, auth token injection)
- Proprietary reactive state store (EventEmitter-based)
- WebSocket client (auto-reconnect, room subscription)
- Pages: Login, Dashboard, Orders, Shipments, Route Map, Drivers, Warehouses, Analytics
- Map rendering: Leaflet (open-source, no API key) for map tiles (OpenStreetMap, free)
- **Output:** Fully functional operator dashboard with live map and real-time updates

**Week 7 — Driver Mobile App**
- React Native scaffold
- GPS location polling (every 10s) + background location
- Offline queue (locations buffered to SQLite via react-native's built-in storage, flushed on reconnect — no external storage library)
- WebSocket client (reconnect with exponential backoff)
- Screens: Login, My Route, Current Delivery, Deliver (camera + signature), Navigation
- Proprietary signature capture (react-native canvas, no library)
- **Output:** Driver app with offline GPS tracking, delivery confirmation, proof-of-delivery capture

**Week 8 — Truck Client + Customer Portal**
- Lightweight Node.js truck client (TypeScript, targets embedded Linux)
- OBD-II USB adapter integration (serial port reading, proprietary OBDII parser)
- Telemetry streaming: GPS, speed, RPM, fuel level, engine fault codes
- Configurable stream interval (default 10s, configurable per org)
- Customer portal (React, separate build, public tracking endpoint)
- Tracking number lookup → live map + event timeline + ETA from Predictive engine
- **Output:** Truck telemetry streaming to PILOTS; customers can self-serve track shipments

---

## Security Principles

- All passwords: `crypto.pbkdf2`, 100k iterations, unique salt per user — no bcrypt dependency
- All tokens: HS256 JWT built on `crypto.createHmac` — no JWT library
- All sensitive DB fields (API keys, webhook secrets): AES-256-CBC via `crypto.createCipheriv` — no library
- Multi-tenancy: `org_id` injected server-side from JWT, never trusted from client
- Rate limiting: token bucket per (IP, endpoint) pair, Redis-backed
- Audit log: every write operation logged to `audit_logs` table (actor, action, before, after, timestamp)
- TLS: terminated at load balancer (Railway/AWS), internal traffic on private network

---

## Verification (per week)

Each week is considered complete when:
1. All new code passes the proprietary test runner (`npm test`)
2. TypeScript compiles with zero errors (`tsc --noEmit`)
3. The week's primary integration test passes end-to-end (e.g., Week 2: POST /routes/optimize returns valid route for sample order set)
4. No npm packages added beyond the allowed list
5. All DB migrations run cleanly on a fresh database

---

## Critical Files for Implementation

- `core/http/server.ts` — foundation for all API
- `core/auth/jwt.ts` — used everywhere
- `core/db/pool.ts` — used everywhere
- `engines/route-optimizer/vrp.ts` — core algorithm
- `engines/tracking/event-log.ts` — core tracking state
- `engines/allocation/hungarian.ts` — core allocation
- `db/migrations/` — schema source of truth

---

## Dependencies Reference (allowed list, final)

```json
{
  "dependencies": {
    "pg": "^8.11.0",
    "ioredis": "^5.3.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-native": "^0.73.0",
    "leaflet": "^1.9.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/pg": "^8.10.0",
    "@types/react": "^18.2.0",
    "@types/leaflet": "^1.9.0"
  }
}
```

> **Note on Leaflet:** OpenStreetMap tiles are free, no API key. Leaflet is the rendering library (like React is the rendering library for the UI). No Google Maps, no Mapbox.

> **Note on React Native:** React Native is the mobile runtime (equivalent to Node.js for mobile). We build all application logic, screens, and components ourselves — we only use React Native's core primitives (View, Text, TouchableOpacity, Camera, Geolocation).
