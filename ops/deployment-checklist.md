# PILOTS Platform - Deployment Checklist

## Pre-Deployment Verification

### Code Quality
- [ ] All TypeScript compilation errors resolved (`npm run build` passes)
- [ ] All unit and integration tests passing (285+ tests)
- [ ] Code review completed (security, performance, correctness)
- [ ] No critical security issues found in OWASP top 10 scan
- [ ] Branch protection rules enforced (no direct pushes to main/staging)

### Security Hardening
- [ ] JWT tokens configured with 15-min access, 7-day refresh token rotation
- [ ] IP/User-Agent binding enabled to prevent token theft
- [ ] Rate limiting configured: 100 req/min per IP, 1 SMS/hour per number
- [ ] Brute force protection: 5 failed logins → 15-min account lock
- [ ] Multi-tenant isolation enforced: org_id filtering on all queries
- [ ] Webhook signature verification working: Shopify (HMAC), Stripe (signing secret), Twilio (auth token)
- [ ] Idempotency protection enabled: 24-hour cache for webhook deduplication
- [ ] Secrets manager integration verified (JWT_SECRET, ENCRYPTION_KEY loaded)

### Database
- [ ] All migrations applied to staging database
- [ ] PostgreSQL backup configured with 30-day retention
- [ ] Database indexes created for foreign keys and frequently queried columns
- [ ] Row-level security (RLS) policies enabled for multi-tenant isolation
- [ ] Connection pooling configured (min 5, max 20 connections)
- [ ] Read replica configured (optional for high-volume reads)

### Infrastructure
- [ ] Redis cluster configured for distributed rate limiting and session storage
- [ ] Redis Sentinel HA enabled (optional for production)
- [ ] Load balancer health checks configured
- [ ] SSL/TLS certificates valid and configured
- [ ] CORS origins whitelist matches frontend deployment domains
- [ ] Environment variables all set (no dev defaults in production)

### Monitoring & Alerting
- [ ] Prometheus scrape targets configured
- [ ] Log aggregation set up (ELK, Datadog, or CloudWatch)
- [ ] Alert thresholds configured per monitoring/thresholds.json
- [ ] PagerDuty integration enabled for critical alerts
- [ ] Slack webhook configured for warning-level alerts
- [ ] Dashboard created for API health, webhooks, security, infrastructure
- [ ] Incident response playbook reviewed by team

### Performance Testing
- [ ] Load tests completed with artillery (420+ seconds)
  - [ ] Warmup phase: 5 req/s for 30 seconds ✓
  - [ ] Sustained load: 50 req/s for 300 seconds
  - [ ] Spike testing: 200 req/s for 60 seconds
  - [ ] Cooldown: 5 req/s for 30 seconds
- [ ] P99 latency < 1000ms under normal load
- [ ] P95 latency < 500ms under normal load
- [ ] Error rate < 1% under sustained load
- [ ] No memory leaks detected
- [ ] Connection pool stable under spike load

### Integration Testing
- [ ] Shopify webhook integration verified (signature verification works)
- [ ] Stripe webhook integration verified (event parsing works)
- [ ] Twilio SMS integration verified (message parsing works)
- [ ] All webhooks tested with sample payloads
- [ ] Webhook idempotency verified (duplicate requests return cached response)
- [ ] Rate limiting verified on auth endpoints
- [ ] Token rotation working (refresh token invalidates old token)

## Staging Deployment

### Pre-Deployment
- [ ] Staging environment matches production configuration
- [ ] Database seeded with test data (warehouses, users, test orders)
- [ ] Secrets loaded from secrets manager (not env file)
- [ ] Feature flags configured appropriately

### Deployment Steps
- [ ] Build Docker image: `docker build -t pilots:latest .`
- [ ] Push to container registry: `docker push pilots:latest`
- [ ] Update Kubernetes deployment manifest with new image tag
- [ ] Apply deployment: `kubectl apply -f k8s/deployment.yml`
- [ ] Wait for pods to become ready: `kubectl get pods -l app=pilots`
- [ ] Verify service endpoints: `kubectl get service pilots-api`

### Post-Deployment Verification
- [ ] Health check endpoint returns 200: `curl /api/health`
- [ ] API responds to requests: `curl /api/orders` (with auth)
- [ ] Webhook endpoints accessible: `POST /api/webhooks/shopify/orders/create`
- [ ] Rate limiting is active: Send 150 requests in 1 minute, verify 429 response
- [ ] Authentication flow works: Login → Access token + Refresh token
- [ ] Database connection pool healthy: `SHOW MAX_CONNECTIONS` in psql
- [ ] Logs flowing to aggregation service
- [ ] Monitoring dashboards showing data
- [ ] Alerts firing correctly (test with synthetic alert)

## Production Deployment

### Final Checks
- [ ] Deployment approval from product/security leads
- [ ] Runbook reviewed and accessible to on-call engineer
- [ ] Rollback plan documented and tested
- [ ] Estimated deployment window: 30 minutes
- [ ] Maintenance mode notification ready for users

### Blue-Green Deployment
- [ ] Blue (old) environment healthy and handling traffic
- [ ] Green (new) environment deployed and verified
- [ ] Canary deployment: route 5% traffic to green for 5 minutes
- [ ] Monitor error rates and latency during canary
- [ ] If stable: shift 25% → 50% → 100% traffic over 15 minutes
- [ ] If issues detected: rollback to blue (< 2 minutes)

### Post-Deployment
- [ ] Verify all 285 tests passing in production logs
- [ ] Monitor error rates for 1 hour (should be < 1%)
- [ ] Monitor webhook delivery rates (should be > 99%)
- [ ] Check critical alerts: none should be firing
- [ ] Database performance stable (query times normal)
- [ ] Redis memory usage stable
- [ ] Confirm no security alerts from WAF/IDS
- [ ] Update deployment log with timestamp and commit hash

## Rollback Procedure

If critical issues detected within 1 hour of deployment:
1. Shift traffic back to blue environment: `kubectl set image deployment/pilots-api pilots-api=pilots:previous`
2. Verify health: `curl /api/health`
3. Monitor error rates return to normal
4. Document incident in postmortem
5. Create hotfix branch from main for the issue
6. Re-test and re-deploy after fix is verified

## Monitoring Post-Deployment

### 24-Hour Observation Period
- [ ] Monitor API latency (p99, p95, p50) — should be stable
- [ ] Monitor error rates — should stay < 1%
- [ ] Monitor webhook processing queue — should stay < 50 items
- [ ] Monitor database connection pool — should not hit max connections
- [ ] Monitor Redis memory — should not exceed 80% utilization
- [ ] Monitor authentication success rate — should stay > 98%

### Weekly After Production Deploy
- [ ] Review error logs for patterns
- [ ] Check webhook delivery reports
- [ ] Review incident reports (if any)
- [ ] Analyze load test results vs production metrics
- [ ] Plan optimizations for next iteration

---

**Deployment Lead:** [Name]
**Approved By:** [Security Lead], [Product Lead]
**Deployment Date/Time:** [Date] [Time] UTC
**Rollback Trigger:** Error rate > 5% OR Latency p99 > 5 seconds
