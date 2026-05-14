# Log Aggregation Setup: ELK Stack & Datadog

## Overview
PILOTS uses centralized log aggregation to collect, index, and analyze logs from all services. Both ELK Stack and Datadog configurations are provided.

## Option 1: ELK Stack (Self-Hosted)

### Architecture
- **Elasticsearch**: Full-text search and indexing
- **Logstash**: Log parsing, filtering, enrichment
- **Kibana**: Visualization and dashboarding

### Kubernetes Deployment

1. Install Elasticsearch:
```bash
helm repo add elastic https://helm.elastic.co
helm install elasticsearch elastic/elasticsearch \
  --namespace observability \
  --create-namespace \
  --values elasticsearch-values.yml
```

2. Install Logstash:
```bash
helm install logstash elastic/logstash \
  --namespace observability \
  --values logstash-values.yml
```

3. Install Kibana:
```bash
helm install kibana elastic/kibana \
  --namespace observability \
  --values kibana-values.yml
```

### Logstash Configuration
File: `ops/logstash.conf`

```
input {
  tcp {
    port => 5000
    codec => json
  }
  udp {
    port => 5000
    codec => json
  }
}

filter {
  # Parse JSON logs
  if [message] {
    json {
      source => "message"
    }
  }
  
  # Add timestamp
  date {
    match => [ "timestamp", "ISO8601" ]
    target => "@timestamp"
  }
  
  # Enrich with environment
  mutate {
    add_field => { "environment" => "production" }
    add_field => { "service" => "pilots-api" }
  }
}

output {
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "pilots-%{+YYYY.MM.dd}"
  }
}
```

### Fluent Bit Sidecar (Kubernetes)
File: `k8s/fluent-bit-sidecar.yml`

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluent-bit-config
data:
  fluent-bit.conf: |
    [SERVICE]
        Flush         5
        Daemon        Off
        Log_Level     info

    [INPUT]
        Name              tail
        Path              /var/log/containers/*pilots*.log
        Parser            docker
        Tag               pilots.*
        Refresh_Interval  5

    [FILTER]
        Name                kubernetes
        Match               pilots.*
        Kube_URL            https://kubernetes.default.svc:443
        Kube_CA_File        /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
        Kube_Token_File     /var/run/secrets/kubernetes.io/serviceaccount/token
        Kube_Tag_Prefix     pilots.var.log.containers.
        Merge_Log           On

    [OUTPUT]
        Name            es
        Match           pilots.*
        Host            elasticsearch.observability.svc.cluster.local
        Port            9200
        HTTP_User       elastic
        HTTP_Passwd     ${ELASTICSEARCH_PASSWORD}
        Index           pilots
        Logstash_Format On
        Type            _doc
```

## Option 2: Datadog (SaaS)

### Installation

1. Create Datadog account and get API key

2. Install Datadog Agent in Kubernetes:
```bash
helm repo add datadog https://helm.datadoghq.com
helm install datadog datadog/datadog \
  --set datadog.apiKey=$DATADOG_API_KEY \
  --set datadog.appKey=$DATADOG_APP_KEY \
  --namespace datadog \
  --create-namespace
```

3. Configure log collection in `datadog-values.yml`:
```yaml
datadog:
  apiKey: $DATADOG_API_KEY
  appKey: $DATADOG_APP_KEY
  logLevel: info

logs:
  enabled: true
  containerCollectAll: true
  
metrics:
  enabled: true

apm:
  enabled: true
```

### Log Source Configuration
File: `datadog-logs.yml`

```yaml
logs:
  - type: file
    path: /var/log/pilots/api.log
    service: pilots-api
    source: nodejs
    tags:
      - env:production
      - version:1.0.0
    
  - type: file
    path: /var/log/pilots/webhooks.log
    service: pilots-webhooks
    source: nodejs
    tags:
      - env:production
      
  - type: file
    path: /var/log/pilots/jobs.log
    service: pilots-jobs
    source: nodejs
    tags:
      - env:production
```

## Log Format Standards

All applications must output JSON-formatted logs:

```json
{
  "timestamp": "2026-05-08T10:30:45.123Z",
  "level": "info",
  "service": "pilots-api",
  "message": "Request processed",
  "duration_ms": 145,
  "request_id": "req-12345",
  "user_id": "user-67890",
  "status_code": 200
}
```

## Dashboard Configuration

### Kibana Dashboard (ELK)
1. Navigate to Kibana: http://kibana.example.com
2. Create index pattern: `pilots-*`
3. Create dashboard with:
   - API response latency (p50, p95, p99)
   - Error rate by endpoint
   - Webhook processing time
   - Rate limit hits
   - Authentication failures

### Datadog Dashboard
1. Navigate to Datadog: https://app.datadoghq.com
2. Create dashboard with:
   - Log volume by service
   - Error logs with stack traces
   - Request latency histogram
   - Rate limit metrics
   - Webhook delivery metrics

## Alerts Configuration

### ELK/Elastic Alerting
File: `elasticsearch-alerts.json`

```json
{
  "alerts": [
    {
      "name": "High Error Rate",
      "query": "level:error",
      "threshold": 10,
      "timeRange": "5m",
      "action": "notify-slack"
    },
    {
      "name": "High API Latency",
      "query": "service:pilots-api",
      "aggregation": "avg(duration_ms)",
      "threshold": 1000,
      "timeRange": "5m",
      "action": "notify-pagerduty"
    }
  ]
}
```

### Datadog Monitors
```bash
# High error rate monitor
datadog monitors create \
  --type log_alert \
  --query 'logs("service:pilots-api status:error").index("main").rollup("count").last("5m") > 50' \
  --title "High error rate on pilots-api" \
  --notify "@pagerduty" \
  --priority "2"
```

## Log Retention Policies

| Log Type | Retention | Storage |
|----------|-----------|---------|
| Standard logs | 30 days | Elasticsearch/Datadog |
| Audit logs | 1 year | S3/cold storage |
| Error logs | 90 days | Elasticsearch/Datadog |
| Debug logs | 7 days | Local rotation |

## Best Practices

1. **Structured logging**: Always use JSON format
2. **Request tracing**: Include `request_id` in all logs
3. **Sensitive data**: Never log PII, API keys, or passwords
4. **Log levels**: Use ERROR for alerts, INFO for tracking, DEBUG for troubleshooting
5. **Indexing**: Use consistent field names across services
6. **Sampling**: Sample high-volume logs (keep 10% of INFO level logs)
7. **Archive**: Archive logs older than 90 days to cost-effective storage
