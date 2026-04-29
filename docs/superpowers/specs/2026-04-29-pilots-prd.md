# PRISM — PILOTS Product Requirements Document

**Product:** PILOTS (Prism Intelligent Logistics & Operations Tracking System)
**Company:** PRISM
**Version:** 1.0
**Date:** April 29, 2026
**Status:** Active

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [The Problem](#2-the-problem)
3. [The Product](#3-the-product)
4. [Feature Breakdown](#4-feature-breakdown)
5. [Who It's For](#5-who-its-for)
6. [How It Works](#6-how-it-works)
7. [Business Model](#7-business-model)
8. [Market Opportunity](#8-market-opportunity)
9. [Competitive Landscape](#9-competitive-landscape)
10. [Roadmap](#10-roadmap)
11. [Success Metrics](#11-success-metrics)

---

## 1. Executive Summary

PRISM builds intelligent logistics software for companies that move physical goods. Its flagship product, PILOTS, is a complete operating system for logistics — handling everything from the moment a customer places an order to the moment it arrives at their door, and every decision in between.

PILOTS replaces the patchwork of spreadsheets, disconnected apps, and manual guesswork that most logistics companies still rely on today. It does this through a single, unified platform that combines real-time shipment tracking, automated warehouse-to-order matching, AI-driven route planning, demand forecasting, and fraud detection — all built on proprietary technology owned entirely by PRISM.

PILOTS is sold as a monthly subscription, scales from small e-commerce businesses to global enterprise logistics operators, and is designed to work anywhere in the world from day one.

**Current state:** The full backend platform is built, tested, and production-ready. 178 automated tests pass. All core engines are live. The next phase is the client-facing layer — the dashboards, mobile apps, and customer portals that sit on top of the platform.

---

## 2. The Problem

### The logistics industry runs on outdated tools

Every time you order something online and it arrives at your door, dozens of decisions were made to get it there: which warehouse had the product, which driver was available, which route was fastest, whether to flag the delivery as at risk. In most companies, those decisions are made by humans staring at spreadsheets, calling drivers on the phone, and guessing based on experience.

This is expensive, slow, and error-prone. Here is what that looks like in practice:

**For a small e-commerce brand:**
A founder running a clothing brand ships 300 orders a week. She has two warehouses — one in Lagos, one in Nairobi. Every Monday morning she manually figures out which warehouse should ship which orders by looking at stock levels in a spreadsheet. She has no idea if a delivery is running late until a customer emails to complain. She has no way to predict how much stock she'll need next month. She loses 3–4% of revenue to fraud — drivers who claim mileage they didn't drive, or warehouse staff who under-report inventory.

**For a mid-size logistics company:**
A regional carrier with 40 drivers and 5 warehouses. Their dispatch team spends half the day on the phone coordinating routes. Their operations manager checks a different system for shipment tracking, another for inventory, another for driver GPS. None of them talk to each other. When something goes wrong — a missed delivery, a damaged shipment — it takes hours to figure out what happened and who is responsible.

**For a large enterprise:**
A 3PL (a company that manages shipping for other brands) running thousands of shipments a day. Their legacy software costs millions per year, takes six months to onboard onto, and still can't answer simple questions like "which of my delivery routes are underperforming" or "is there fraud in this region" without a data analyst pulling a report.

### The gap in the market

Existing solutions fall into three categories, all with significant problems:

1. **Enterprise legacy software** (SAP, Oracle TMS): Extremely powerful but costs hundreds of thousands of dollars per year, requires months of implementation, and is completely inaccessible to small and mid-size companies.

2. **Lightweight SaaS tools** (Shippo, EasyPost): Easy to use and affordable, but only solve one piece of the puzzle — usually just label generation or basic tracking. No intelligence, no optimization, no analytics.

3. **Build-it-yourself**: Large tech companies (Amazon, Jumia) build their own logistics software. This works, but costs tens of millions of dollars and years of engineering time, and the resulting software is not available to anyone else.

**PILOTS fills the gap:** enterprise-grade intelligence at SaaS prices, accessible to any company from day one.

---

## 3. The Product

PILOTS is a cloud-based logistics operating system. Think of it as the brain of a delivery network. It connects orders, warehouses, drivers, vehicles, and customers into a single intelligent system, then makes — or recommends — the decisions that keep everything running smoothly.

Here is what PILOTS does at the highest level:

- **Receives orders** and automatically figures out which warehouse should fulfill each one
- **Plans routes** for drivers so they cover all their stops in the most efficient possible sequence
- **Tracks every shipment** from the moment it leaves the warehouse to the moment it reaches the customer
- **Updates customers and dispatchers in real time** when something changes
- **Learns from every delivery** to make future estimates more accurate
- **Forecasts demand** so companies always have the right stock in the right place
- **Detects fraud and anomalies** before they cost money

None of these functions require human intervention. PILOTS handles them automatically, surfaces alerts when something needs attention, and gets smarter over time.

---

## 4. Feature Breakdown

### 4.1 Order Management & Automatic Warehouse Allocation

**What it does:**
When an order comes in, PILOTS automatically decides which warehouse should fulfill it. It doesn't just pick the closest warehouse — it considers three factors simultaneously:

1. **Distance**: How far is the warehouse from the delivery address? Closer warehouses mean faster, cheaper deliveries.
2. **Stock levels**: Does this warehouse actually have the product in stock? Sending an order to a warehouse that can't fulfill it wastes time.
3. **Capacity**: Is this warehouse already running at over 80% capacity? Overloaded warehouses slow down processing times.

It weighs all three factors together using a mathematical optimization algorithm (the Hungarian algorithm — the same class of algorithm used by airlines to assign aircraft to routes) and picks the single best warehouse for every order, every time.

**What this means for a customer:**
Instead of a dispatch manager spending 2 hours every morning matching orders to warehouses, PILOTS does it instantly the moment each order arrives — 24 hours a day, 7 days a week, with no errors.

**Key capabilities:**
- Automatic allocation on order creation
- Manual re-allocation trigger if circumstances change
- Full inventory tracking per warehouse per SKU (product code)
- Utilization percentage visible at a glance
- Reserved quantity tracking (stock set aside for in-progress orders)

---

### 4.2 Route Optimization

**What it does:**
Given a set of delivery stops and a fleet of vehicles, PILOTS calculates the most efficient routes — minimizing total distance driven, fuel cost, and time. It solves what mathematicians call the "Vehicle Routing Problem," which is one of the classic hard problems in operations research. Most logistics software approximates a solution; PILOTS solves it properly using a Branch and Bound algorithm, meaning it finds the best possible route, not just a good one.

**What this means for a customer:**
A driver covering 15 stops without optimization might drive 120km. With PILOTS optimization, the same stops might be covered in 78km. Over a fleet of 40 drivers doing this 5 days a week, that is a measurable reduction in fuel costs and driver hours.

**Speed learning:**
Every time a driver completes a route, PILOTS records how fast they actually traveled on each leg, broken down by time of day and day of week. It uses this data to make future ETAs progressively more accurate. A route that goes through a market district on a Saturday morning will have a different speed profile than the same route on a Tuesday night — PILOTS learns and remembers both.

**Key capabilities:**
- Multi-vehicle route optimization
- Constraint support (vehicle capacity, time windows)
- Actual vs. estimated duration tracking
- Continuous ETA improvement from real delivery data
- Route completion endpoint that feeds the learning engine

---

### 4.3 Shipment Tracking & Event Log

**What it does:**
Every shipment in PILOTS has a complete event log — a timestamped record of everything that has happened to it. When a shipment is created, picked up, loaded onto a vehicle, out for delivery, delayed, or delivered — each of those is an event recorded with a timestamp, GPS coordinates, and optional notes.

PILOTS enforces logical rules about what states a shipment can be in. A shipment cannot go from "created" to "delivered" without passing through intermediate states. This prevents data corruption and ensures the event log tells a coherent story.

**Exception detection:**
PILOTS watches shipments automatically and raises alerts when something is wrong, without anyone having to check manually. Examples:
- A driver has been stationary at the same GPS point for longer than expected mid-route
- A delivery is past its estimated delivery time
- A shipment has been in "in transit" status for an unusually long time
- No GPS update has been received for a vehicle that should be active

**Key capabilities:**
- Full event log per shipment (immutable, append-only)
- State machine enforcement (no invalid transitions)
- Automatic exception detection and alerting
- GPS coordinate recording on every event
- Exception reason tracking and resolution workflow

---

### 4.4 Real-Time Updates

**What it does:**
When a driver's location changes, when a shipment status updates, when an exception is raised — everyone who needs to know finds out immediately, without refreshing a page or polling an API. PILOTS uses a technology called WebSockets that keeps a persistent live connection open between the server and any connected browser or app.

Subscribers join "rooms" — for example, a customer service agent can subscribe to updates for a specific shipment, and they will see every status change the moment it happens. A dispatcher can subscribe to all active routes and watch driver locations move in real time on a map.

**What this means for a customer:**
Customer service teams spend less time on "where is my order?" calls because customers can see live updates themselves. Dispatchers can react to problems the moment they occur instead of finding out 20 minutes later.

**Key capabilities:**
- Live driver GPS tracking
- Instant shipment status updates
- Selective room subscriptions (subscribe to specific shipments, routes, or regions)
- Redis-backed for scale (supports thousands of simultaneous connections)
- Graceful reconnection handling

---

### 4.5 Analytics Engine

**What it does:**
PILOTS has four analytics capabilities built into the platform:

**Demand forecasting:**
By analyzing historical order volumes, PILOTS identifies patterns — trends (orders growing week over week), seasonality (always busier on Fridays, always slower in January) — and uses them to project future demand. A warehouse manager can ask "how many units of Product X will we need in the Lagos warehouse next month?" and get a number with a confidence range, not a guess.

**Delivery time analysis:**
Instead of just reporting average delivery times (which can be misleading — a few very slow deliveries can inflate the average), PILOTS reports percentiles. "50% of deliveries complete in under 38 minutes. 95% complete in under 71 minutes. 99% complete in under 94 minutes." This tells operations teams where their real performance floor is, not just the average.

**Route performance prediction:**
Given a planned route and a departure time, PILOTS predicts how long each leg will take — using the speed profile data it has learned from real previous deliveries on similar roads at similar times. This makes ETA promises to customers more accurate.

**Time-series decomposition:**
For any metric tracked over time (orders per day, revenue per week, shipments per route), PILOTS can separate the underlying trend from seasonal patterns and random noise. This helps analysts understand what is actually changing versus what is just normal variation.

**Key capabilities:**
- Demand forecasting with confidence bands
- P50/P95/P99 delivery time percentiles
- Speed-profile-aware ETA prediction
- Time-series decomposition API
- Historical delivery stats endpoint

---

### 4.6 Fraud & Anomaly Detection

**What it does:**
PILOTS watches every metric in the system — delivery durations, order volumes per hour, route deviations, inventory changes — and learns what "normal" looks like for each one. When something deviates from normal, it raises an alert. Two complementary methods are used:

**Spike detection (Z-score):**
When a single reading is dramatically different from the historical average, it is flagged immediately. Severity scales with how far from normal the reading is:
- 2× normal deviation → Low alert
- 3× → Medium
- 4× → High
- 5× or more → Critical

This catches sudden, obvious problems: a driver who claims a 4-hour delivery when the same route normally takes 45 minutes, or a sudden spike in order cancellations from one warehouse.

**Drift detection (CUSUM):**
Some fraud doesn't happen all at once — it creeps in gradually. A driver who adds 3 extra kilometers to every route doesn't look suspicious on any single day, but over 3 months that's thousands of dollars of fuel fraud. PILOTS uses a statistical technique called CUSUM (Cumulative Sum control chart) that accumulates small deviations over time and triggers an alert when the cumulative drift exceeds a threshold. This is the same method used in industrial quality control and financial fraud detection.

**Baseline training:**
For every metric, PILOTS maintains a learned statistical baseline using Welford's online algorithm — a method that updates the average and standard deviation incrementally with each new data point, without needing to store every historical reading. This means fraud detection gets more accurate over time without any manual configuration.

**Key capabilities:**
- Per-organization, per-metric baselines
- Configurable alert thresholds
- Batch anomaly scanning
- CUSUM drift analysis API
- Severity classification (low/medium/high/critical)

---

### 4.7 Infrastructure & Security

**What it does:**
These are the behind-the-scenes systems that make everything else reliable, fast, and secure.

**Multi-tenancy:**
Every single piece of data in PILOTS is tied to an organization. A user from Company A can never see, modify, or even know about data belonging to Company B. This is enforced at every layer — every database query, every API call, every cache entry — not just at login. It is architecturally impossible for data to leak between customers.

**Caching:**
Frequently-accessed data (warehouse inventory levels, organization settings, speed profiles) is stored in a fast in-memory cache so the database is not hit on every request. Cache entries expire automatically to prevent stale data.

**Background job processing:**
Some operations are too slow to complete while a user waits — for example, optimizing routes for 200 stops across 15 vehicles. These are submitted as background jobs, processed by a worker pool, and the user is notified when done. Jobs have priority levels (urgent jobs process first), automatic retry with exponential backoff if they fail, and a dead-letter queue for jobs that fail too many times.

**Scheduled jobs:**
Recurring tasks (daily demand forecast updates, weekly anomaly baseline refreshes, periodic health checks) are scheduled using a distributed locking mechanism in Redis. Even if multiple server instances are running, each scheduled job runs exactly once — not once per server.

**Health monitoring:**
A public health endpoint (`/api/v1/health`) checks database connectivity and Redis connectivity and returns a status report. This is what load balancers and uptime monitors use to decide whether to route traffic to a server instance.

**Key security properties:**
- Parameterized database queries throughout (no SQL injection possible)
- JWTs (JSON Web Tokens) for authentication — stateless, expirable, revocable
- Refresh token rotation
- Per-organization rate limiting
- Strict input validation on every endpoint
- No external package dependencies for core logic (no supply-chain attack surface)

---

## 5. Who It's For

PILOTS serves three customer tiers with the same underlying platform, but different feature emphasis and pricing.

### Tier 1 — Small & Growing (1–5 warehouses, up to 500 orders/day)

**Who they are:**
E-commerce brands, local courier startups, small distributors. They are outgrowing spreadsheets but can't afford enterprise software. They often have a founder or one operations person running everything.

**What they need most:**
- Order-to-warehouse matching that doesn't require manual work every morning
- Basic shipment tracking so customers can see where their orders are
- Simple delivery analytics to understand what's working

**How they use PILOTS:**
They connect their online store (Shopify, WooCommerce) via the API. Orders flow in automatically. PILOTS allocates each order to the right warehouse, a driver picks it up, and the customer gets a tracking link. The founder checks the analytics dashboard once a week to see performance trends.

**Value proposition:**
"Stop doing manually in 2 hours what PILOTS does automatically in 2 seconds."

---

### Tier 2 — Mid-Market (5–50 warehouses, 500–10,000 orders/day)

**Who they are:**
Regional logistics companies, mid-size 3PLs, distribution arms of retail chains. They have operations teams, dispatchers, and warehouse managers. They've probably tried to build internal tools and found it too expensive to maintain.

**What they need most:**
- Multi-vehicle route optimization across a real fleet
- Real-time driver tracking for their dispatch team
- Fraud detection (at this scale, driver fraud and warehouse shrinkage are measurable problems)
- Demand forecasting to manage inventory levels across multiple locations

**How they use PILOTS:**
Dispatchers use the live dashboard to monitor all active routes. Warehouse managers track inventory levels and get alerts when a SKU is running low based on forecasted demand. The operations manager reviews the fraud dashboard weekly. Executive reports pull from the analytics API.

**Value proposition:**
"The intelligence of a dedicated data science team, at the cost of one SaaS subscription."

---

### Tier 3 — Enterprise (50+ warehouses, 10,000+ orders/day)

**Who they are:**
Large 3PLs, national carriers, the logistics divisions of large retail or manufacturing companies. They may have existing systems but are looking for a modern intelligence layer to sit on top of them, or are replacing aging legacy software.

**What they need most:**
- API-first architecture to integrate with existing systems (ERP, WMS, TMS)
- Custom anomaly detection thresholds per region or business unit
- White-labeling capability (their brand, not PRISM's)
- SLA-backed uptime guarantees
- Dedicated onboarding and support

**How they use PILOTS:**
Typically via API integration into their existing tech stack. PILOTS handles the intelligence layer — optimization, prediction, fraud detection — while their existing systems handle billing, HR, and customer management. Or they fully migrate onto PILOTS and decommission legacy systems.

**Value proposition:**
"Enterprise-grade logistics intelligence without the enterprise implementation timeline or price tag."

---

## 6. How It Works

A non-technical explanation of the system architecture.

### The three-layer stack

PILOTS is built in three layers, like a building:

**The basement — data storage:**
Two databases power PILOTS:
- **PostgreSQL**: The permanent record of everything — organizations, users, warehouses, orders, shipments, routes, events. Think of it as a very large, very organized filing cabinet.
- **Redis**: A fast in-memory store for data that needs to be accessed instantly — active driver locations, cached warehouse inventory, job queues, real-time WebSocket connections. Think of it as a whiteboard that gets updated constantly.

**The middle floor — the engines:**
This is where the intelligence lives. Eight proprietary engines, each doing one specific thing:
1. Route optimizer — finds the best paths
2. Allocation engine — matches orders to warehouses
3. Tracking engine — records and enforces shipment states
4. Analytics engine — forecasts, percentiles, decomposition
5. Fraud detector — Z-score and CUSUM anomaly detection
6. Cache layer — makes reads fast
7. Event bus — connects engines without coupling them
8. Job queue — handles work in the background

**The top floor — the API:**
Every feature in PILOTS is accessible via a clean, documented HTTP API. 40+ endpoints covering auth, routes, shipments, drivers, warehouses, orders, analytics, fraud, and health. The client apps (dashboard, mobile app, customer portal) all sit on top of this API.

### How a single order flows through the system

Here is the life of one order from creation to delivery:

1. A customer places an order on an e-commerce site. The site sends the order to PILOTS via API.
2. PILOTS creates the order record and immediately runs the allocation algorithm — checking all available warehouses against distance, stock levels, and current utilization. It picks the best one and assigns the order.
3. The warehouse receives the allocation. Staff pick and pack the order.
4. A driver is assigned. PILOTS adds this stop to the driver's route optimization queue.
5. The route optimizer calculates the most efficient sequence for all stops on that driver's run.
6. The driver starts the route. Their app begins sending GPS updates every 30 seconds.
7. Every GPS update is broadcast in real time to any subscriber watching that route (dispatcher, customer service, the customer themselves).
8. At each stop, the driver records a delivery event. The shipment state machine advances.
9. When all stops are complete, the route is marked done. The actual travel times are recorded and fed back into the speed profile learning engine — making future predictions on that corridor more accurate.
10. The analytics engine aggregates the delivery data. The fraud engine checks the route duration against the baseline for that driver and route type. If anything looks anomalous, an alert is raised.

The entire flow, from order creation to fraud check on completion, happens automatically. Human operators only need to intervene when something goes wrong — and PILOTS tells them when and where.

---

## 7. Business Model

### Pricing structure

PILOTS is sold as a monthly SaaS subscription with three tiers:

| Tier | Target | Pricing Model |
|---|---|---|
| **Starter** | Small businesses, up to 500 orders/day | Flat monthly fee |
| **Growth** | Mid-market, 500–10,000 orders/day | Per-active-user + usage |
| **Enterprise** | 10,000+ orders/day | Custom annual contract |

Exact pricing TBD based on market validation, but the model follows standard B2B SaaS:
- Annual contracts with monthly billing option (annual at a discount)
- Usage-based overages above tier limits
- Add-on modules (advanced fraud detection, white-labeling, dedicated support)

### Revenue drivers

1. **Subscription ARR**: The core recurring revenue base
2. **Seat expansion**: As customers grow their teams, they add more users
3. **Volume expansion**: As order volumes grow, customers naturally move to higher tiers
4. **Add-on modules**: Advanced analytics, custom integrations, white-labeling for enterprise
5. **Professional services**: Onboarding, custom integration, training for large enterprise clients

### Unit economics thesis

The value PILOTS delivers (fuel savings from route optimization, fraud prevented, hours saved on manual dispatch, stockout costs avoided from demand forecasting) should significantly exceed the subscription cost at every tier. For a mid-market logistics company running 2,000 orders/day with 20 drivers, conservative estimates suggest PILOTS pays for itself in reduced fuel costs alone, before counting fraud prevention and labor savings.

---

## 8. Market Opportunity

### The global logistics technology market

The logistics technology sector is one of the largest and fastest-growing software markets in the world. Physical goods still need to move from place to place — that demand is not going away. But the software that coordinates that movement is, in most of the world, decades out of date.

Key market facts:
- The global logistics market is valued at approximately $10 trillion annually
- Logistics technology (software, automation, analytics) represents a rapidly growing share
- Emerging markets (Africa, Southeast Asia, Latin America) are particularly underserved — high logistics volume, low software penetration
- The rise of e-commerce has dramatically increased the number of small and mid-size shippers who need logistics software but cannot afford enterprise solutions

### Why now

Three forces are converging to create the right moment for PILOTS:

1. **E-commerce growth**: More businesses are shipping physical goods to customers. The volume of last-mile deliveries globally has increased dramatically post-2020 and continues to grow.

2. **Emerging market logistics boom**: Africa in particular is experiencing rapid growth in logistics infrastructure — new roads, new warehouses, new courier companies. These new operators are not locked into legacy software the way Western enterprises are. They can adopt modern tools from day one.

3. **AI/ML accessibility**: The algorithms that power PILOTS (optimization, forecasting, anomaly detection) were, 10 years ago, only accessible to companies with large data science teams. Today, they can be implemented from scratch by a small engineering team and delivered as a SaaS product at low cost.

### PRISM's positioning

PRISM is not trying to sell to Fortune 500 companies first. The go-to-market strategy is:
- **Land with Tier 1** (small businesses who have the most pain and the lowest switching cost)
- **Expand to Tier 2** (as those businesses grow, or as mid-market players see the results)
- **Enterprise as a later motion** (after strong case studies, brand recognition, and a full feature set are established)

This mirrors the successful playbook of Shopify, Stripe, and other developer/SMB-first platforms that eventually moved upmarket.

---

## 9. Competitive Landscape

### Direct competitors

**Project44 / FourKites** (enterprise visibility platforms)
- Focus: Real-time shipment visibility for large enterprises
- Weakness: Enterprise-only, extremely expensive, no optimization or fraud detection
- PRISM advantage: Full-stack (not just visibility), accessible to SMBs, built-in intelligence

**Shippo / EasyPost** (SMB shipping APIs)
- Focus: Label generation, carrier rate shopping for small shippers
- Weakness: Purely transactional — no routing, no analytics, no fraud, no forecasting
- PRISM advantage: End-to-end platform, not just label generation

**SAP TM / Oracle TMS** (legacy enterprise)
- Focus: Comprehensive enterprise logistics management
- Weakness: Costs hundreds of thousands per year, 6–18 month implementations, no modern API
- PRISM advantage: Modern API-first architecture, fraction of the cost, deployable in days

**Locus / LogiNext** (mid-market route optimization)
- Focus: Route planning and dispatch for mid-size fleets
- Weakness: Narrow focus on routing only, no warehouse allocation, no fraud detection
- PRISM advantage: Full platform — routing is one of eight integrated engines, not the whole product

### PRISM's sustainable moat

The competitive advantage is not any single feature — it is the combination and integration of all features in one platform, plus the data network effects:

- Every delivery a PRISM customer makes teaches the speed profile engine
- Every anomaly detected improves the fraud baseline
- Every demand cycle makes the forecasting model more accurate

Over time, a PRISM customer who has been on the platform for 2 years has dramatically more accurate predictions and fraud detection than a new customer — because the models are trained on their specific routes, drivers, and patterns. This creates switching costs that are not just contractual but operational.

---

## 10. Roadmap

### What is built today (Weeks 1–5)

The complete backend platform is production-ready:

| Capability | Status |
|---|---|
| Authentication & multi-tenancy | ✅ Live |
| Order management & warehouse allocation | ✅ Live |
| Route optimization (VRP solver) | ✅ Live |
| Speed profile learning | ✅ Live |
| Shipment tracking & event log | ✅ Live |
| Exception detection | ✅ Live |
| Real-time WebSocket updates | ✅ Live |
| Redis cache layer | ✅ Live |
| Typed event bus | ✅ Live |
| Background job queue (priority + retry + DLQ) | ✅ Live |
| Distributed scheduler | ✅ Live |
| Demand forecasting | ✅ Live |
| Delivery time prediction | ✅ Live |
| Percentile analytics | ✅ Live |
| Fraud detection (Z-score + CUSUM) | ✅ Live |
| Statistical baseline training | ✅ Live |
| Warehouses API | ✅ Live |
| Orders API | ✅ Live |
| Analytics API | ✅ Live |
| Fraud API | ✅ Live |
| Health monitoring endpoint | ✅ Live |
| Docker deployment config | ✅ Live |
| 178 automated tests | ✅ Passing |

### Week 6 — Client Layer (Next)

The backend is a brain with no face. Week 6 adds the interfaces humans actually use:

**Web dashboard (dispatchers & operations managers)**
- Live map showing all active drivers and their routes
- Shipment status board with exception highlighting
- Warehouse inventory overview
- Analytics charts (demand forecast, delivery performance, fraud alerts)
- Real-time updates via WebSocket (no page refresh needed)

**Driver mobile app**
- Optimized route display
- One-tap delivery confirmation
- GPS location broadcasting
- Exception reporting (can't access address, customer not home, etc.)

**Customer tracking portal**
- Public shipment tracking page (no login required)
- Live status updates
- Estimated arrival time

### Week 7 — Integrations & Admin

- Shopify / WooCommerce webhook integration (orders flow in automatically)
- Multi-organization admin panel
- White-labeling for enterprise customers
- Webhook outbound notifications (notify external systems when events happen)
- Advanced reporting exports (PDF, CSV, Excel)

### Week 8 — Scale & Expansion

- Multi-region deployment (Africa, Europe, Asia-Pacific data centers)
- Carrier API integrations (DHL, FedEx, local carriers)
- Advanced ML model tuning
- Customer self-serve onboarding
- Marketplace for third-party integrations

---

## 11. Success Metrics

### Product health metrics

| Metric | Target (12 months post-launch) |
|---|---|
| API uptime | 99.9% |
| P95 API response time | < 200ms |
| Route optimization time (20 stops) | < 5 seconds |
| Allocation decision time | < 500ms |

### Business metrics

| Metric | Target (12 months) |
|---|---|
| Paying customers | 50+ |
| Monthly Recurring Revenue (MRR) | Growth target set at fundraise |
| Customer churn rate | < 5% monthly |
| Net Revenue Retention | > 110% (customers expand more than they churn) |
| Time to first value (days from signup to first optimized route) | < 3 days |

### Value delivery metrics (proof PILOTS works)

| Metric | Target per customer |
|---|---|
| Route distance reduction | 15–30% vs. unoptimized |
| Manual dispatch hours saved | 2+ hours/day per dispatcher |
| Fraud/anomaly catch rate | > 80% of anomalies flagged within 24 hours |
| Demand forecast accuracy | MAPE (mean error) < 15% |
| On-time delivery improvement | 10%+ within 90 days of onboarding |

---

## Appendix: Technical Decisions

### Why proprietary technology

PILOTS is built without external framework dependencies for its core logic. The HTTP server, database query builder, WebSocket implementation, optimization algorithms, and analytics engines are all written from scratch.

This was a deliberate choice:
- **IP ownership**: Every line of core logic is owned by PRISM. No licensing fees, no third-party terms of service constraints.
- **Security**: The #1 vector for software supply chain attacks is third-party dependencies. Eliminating dependencies eliminates that attack surface for core components.
- **Control**: When a third-party library changes its API or introduces a bug, PRISM is not blocked by someone else's release schedule.
- **Performance**: Code written for a specific purpose is faster than general-purpose frameworks.

### Technology stack

- **Runtime**: Node.js 20 with TypeScript 5 (strict mode)
- **Primary database**: PostgreSQL 15
- **Cache / queue / real-time**: Redis 7
- **Deployment**: Docker + docker-compose (cloud-agnostic)
- **External dependencies**: Only `pg` (PostgreSQL driver), `ioredis` (Redis driver), and TypeScript compiler

---

*Document maintained by PRISM engineering. Last updated: April 29, 2026.*
