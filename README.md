# PILOTS HQ

**Prism Intelligent Logistics & Operations Tracking System**

This is the canonical home for everything PILOTS — plans, specs, implementations, changelogs, and documentation.

## Structure

```
pilots-hq/
├── plans/                        # All specs and implementation plans
│   ├── pilots-design-spec.md     # Full system design + architecture
│   └── 2026-04-26-pilots-implementation.md  # Week-by-week build plan
├── docs/                         # Ongoing documentation
├── src/                          # Source code (built here week by week)
└── README.md
```

## Build Sequence

| Week | Focus | Status |
|------|-------|--------|
| 1 | Core Infrastructure (HTTP server, auth, DB, validation) | 🔨 Building |
| 2 | Route Optimizer (VRP, branch-and-bound) | ⏳ Pending |
| 3 | Tracking Engine + WebSocket Server | ⏳ Pending |
| 4 | Allocation Engine + Job Queue | ⏳ Pending |
| 5 | Predictive Analytics + Fraud Detector | ⏳ Pending |
| 6 | Web Dashboard | ⏳ Pending |
| 7 | Driver Mobile App | ⏳ Pending |
| 8 | Truck Client + Customer Portal | ⏳ Pending |

## Philosophy

Zero external packages for core logic. Everything built from scratch on top of:
- Node.js 20 + TypeScript 5
- PostgreSQL 15 + TimescaleDB
- Redis 7

Allowed npm packages: `pg`, `ioredis`, `react`, `react-dom`, `react-native`, `leaflet`, `typescript`, `@types/*`

Everything else is ours.
