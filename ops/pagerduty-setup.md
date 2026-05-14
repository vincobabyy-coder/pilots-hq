# PagerDuty Integration Setup

## Overview
PagerDuty integration enables automated incident management and on-call escalation for PILOTS critical alerts.

## Account Setup

### 1. Create PagerDuty Account
- Go to https://www.pagerduty.com
- Sign up for Business tier (required for integrations)
- Confirm email and complete account setup

### 2. Create Escalation Policy
1. Go to Settings → Escalation Policies
2. Click "New Escalation Policy"
3. Configure levels:
   - Level 1: On-call Engineer (0 min delay)
   - Level 2: Engineering Lead (5 min delay if no response)
   - Level 3: VP Engineering (10 min delay if no response)
4. Save policy

### 3. Create Service
1. Go to Services → New Service
2. Enter service name: "PILOTS API"
3. Set escalation policy from step 2
4. Configure incident settings:
   - Auto-resolve incidents after: 1 hour (for transient issues)
   - Trigger incident on: Any alert
5. Add responders (add team members)
6. Save service

### 4. Create Integration Keys

#### For Monitoring Systems (Prometheus/Datadog)
1. In service settings, go to Integrations
2. Click "Add Integration"
3. Select "Prometheus" (or "Datadog" if using Datadog)
4. Copy the Integration Key (routing key)
5. Store in secrets manager as `PAGERDUTY_ROUTING_KEY`

#### For Custom Webhook Integration
1. Click "Add Integration"
2. Select "Webhook"
3. Configure incoming webhook
4. Copy endpoint URL
5. Store as `PAGERDUTY_WEBHOOK_URL`

## Trigger Rules Configuration

File: `ops/pagerduty-config.yml`

```yaml
services:
  - id: "pilots-api"
    name: "PILOTS API"
    escalation_policy: "on-call-policy"
    integrations:
      - type: "prometheus"
        routing_key: "${PAGERDUTY_ROUTING_KEY}"
        alert_severity_mapping:
          critical: "critical"
          warning: "warning"

# Trigger rules map monitoring alerts to PagerDuty severity
trigger_rules:
  - alert_name: "api_latency_p99_critical"
    pagerduty_severity: "critical"
    description: "API response time p99 > 5 seconds"
    escalate_after_min: 0

  - alert_name: "error_rate_critical"
    pagerduty_severity: "critical"
    description: "API error rate > 5%"
    escalate_after_min: 0

  - alert_name: "api_latency_p99_warning"
    pagerduty_severity: "warning"
    description: "API response time p99 > 1 second"
    escalate_after_min: 5

  - alert_name: "database_connection_pool_critical"
    pagerduty_severity: "critical"
    description: "Database connection pool > 95%"
    escalate_after_min: 0

  - alert_name: "redis_memory_critical"
    pagerduty_severity: "critical"
    description: "Redis memory > 95%"
    escalate_after_min: 0

  - alert_name: "webhook_processing_queue_critical"
    pagerduty_severity: "critical"
    description: "Webhook queue depth > 1000"
    escalate_after_min: 0

  - alert_name: "multi_tenant_isolation_violation"
    pagerduty_severity: "critical"
    description: "Multi-tenant isolation violation detected"
    escalate_after_min: 0
```

## Integration with Monitoring Systems

### Prometheus Integration
File: `monitoring/prometheus-pagerduty.yml`

```yaml
global:
  pagerduty_url: "https://events.pagerduty.com/v2/enqueue"

route:
  receiver: "pagerduty"
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 4h

receivers:
  - name: "pagerduty"
    pagerduty_configs:
      - service_key: "${PAGERDUTY_ROUTING_KEY}"
        description: '{{ .GroupLabels.alertname }}'
        details:
          firing: '{{ template "pagerduty.default.instances" .Alerts.Firing }}'
          resolve: '{{ template "pagerduty.default.instances" .Alerts.Resolved }}'
```

### Datadog Integration
1. Go to Datadog → Integrations
2. Search for "PagerDuty"
3. Configure:
   - API Token: Create token in PagerDuty account settings
   - Schedules sync: Enable to sync on-call schedules
4. Create monitors with PagerDuty notification:
   ```
   @pagerduty-pilots-api
   ```

## Webhook Integration for Custom Alerts

File: `core/alerts/pagerduty-client.ts`

```typescript
import axios from 'axios'

export interface PagerDutyEvent {
  routing_key: string
  event_action: 'trigger' | 'resolve' | 'acknowledge'
  dedup_key: string
  payload: {
    summary: string
    severity: 'critical' | 'error' | 'warning' | 'info'
    source: string
    timestamp?: string
    custom_details?: Record<string, unknown>
  }
}

export async function triggerPagerDutyEvent(event: PagerDutyEvent): Promise<void> {
  try {
    await axios.post('https://events.pagerduty.com/v2/enqueue', event, {
      timeout: 10000,
    })
  } catch (error) {
    logger.error('Failed to trigger PagerDuty event', { error: (error as Error).message })
    throw error
  }
}

// Usage
export async function notifyCriticalAlert(alertName: string, details: Record<string, unknown>): Promise<void> {
  await triggerPagerDutyEvent({
    routing_key: process.env.PAGERDUTY_ROUTING_KEY!,
    event_action: 'trigger',
    dedup_key: `pilots-${alertName}-${Date.now()}`,
    payload: {
      summary: `[CRITICAL] ${alertName}`,
      severity: 'critical',
      source: 'pilots-api',
      custom_details: details,
    },
  })
}
```

## On-Call Schedule Configuration

### Create Schedule
1. Go to People → On-call schedules
2. Click "New schedule"
3. Configure:
   - Name: "PILOTS Engineering On-Call"
   - Timezone: UTC
   - Add team members
4. Set rotation:
   - Weekly rotation
   - Monday 00:00 UTC
5. Save

### Add to Escalation Policy
1. Go to Escalation Policies
2. Edit "on-call-policy"
3. In Level 1: Select schedule "PILOTS Engineering On-Call"
4. Save

## Testing

### Trigger Test Alert
```bash
curl -X POST https://events.pagerduty.com/v2/enqueue \
  -H "Content-Type: application/json" \
  -d '{
    "routing_key": "'$PAGERDUTY_ROUTING_KEY'",
    "event_action": "trigger",
    "dedup_key": "test-alert-'$(date +%s)'",
    "payload": {
      "summary": "[TEST] PILOTS API Critical Alert",
      "severity": "critical",
      "source": "pilots-api-test"
    }
  }'
```

### Verify on PagerDuty Dashboard
1. Go to Incidents
2. Confirm incident appears
3. Check that on-call engineer was notified
4. Resolve incident when done testing

## Monitoring PagerDuty Integration

### Alert Metrics to Track
- Mean time to acknowledgment (MTSA)
- Mean time to resolution (MTTR)
- Alert escalation rate
- False positive rate

### Review Metrics Monthly
1. Go to Analytics
2. Review incident trends
3. Identify high-volume alert sources
4. Optimize trigger thresholds

## Best Practices

1. **Severity Mapping**:
   - Critical: Page on-call immediately (p99 > 5s, error_rate > 5%)
   - Warning: Notify on Slack after 5 min (p99 > 1s, error_rate > 1%)

2. **Escalation Policy**:
   - Level 1: 0 min (immediate)
   - Level 2: 5 min (escalate if no response)
   - Level 3: 10 min (escalate to leadership)

3. **On-Call Coverage**:
   - Minimum 2 people per shift for coverage overlap
   - Handoff buffer: 15 minutes
   - Rotation: Weekly or bi-weekly

4. **Incident Response**:
   - Acknowledge within 5 minutes
   - Investigate root cause
   - Update incident status regularly
   - Post-mortem within 24 hours for critical incidents

5. **Reduce Alert Fatigue**:
   - Only page for truly critical issues
   - Tune threshold to match SLA targets
   - Combine related alerts with correlation rules
   - Review alert effectiveness monthly
