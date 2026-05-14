# PostgreSQL Read Replica Setup for PILOTS

## Overview
This document describes how to set up a PostgreSQL streaming replication read replica for the PILOTS platform to distribute read load and improve query performance.

## Architecture
- **Primary Database**: Handles all write operations (INSERT, UPDATE, DELETE)
- **Read Replica**: Handles SELECT queries from analytics, reports, and read-heavy API endpoints
- **Streaming Replication**: WAL (Write-Ahead Logging) streamed from primary to replica in real-time
- **Replication Lag**: Typically < 1 second for most workloads

## Prerequisites
- PostgreSQL 12+ on both primary and replica
- Network connectivity between primary and replica on port 5432
- Sufficient disk space on replica (at least as much as primary)
- User with superuser or REPLICATION role on primary

## Setup Steps

### 1. Primary Database Configuration
Edit `/etc/postgresql/*/main/postgresql.conf`:

```ini
# Enable WAL archiving and streaming replication
wal_level = replica
max_wal_senders = 3
max_replication_slots = 2
wal_keep_size = 1GB

# Listening addresses
listen_addresses = '0.0.0.0'
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 32MB
```

Edit `/etc/postgresql/*/main/pg_hba.conf` to allow replication connections:

```
# Allow replication connections from replica IP
host    replication     replication_user    REPLICA_IP/32    md5
host    all             all                 0.0.0.0/0        md5
```

Restart primary:
```bash
sudo systemctl restart postgresql
```

### 2. Create Replication User
On primary database:

```sql
CREATE USER replication_user WITH REPLICATION ENCRYPTED PASSWORD 'secure_password';
```

### 3. Base Backup
On replica server, create base backup from primary:

```bash
sudo -u postgres pg_basebackup \
  -h PRIMARY_IP \
  -U replication_user \
  -D /var/lib/postgresql/MAJOR_VERSION/main \
  -Fp \
  -Xs \
  -v \
  -P
```

### 4. Configure Replica
Edit `/var/lib/postgresql/MAJOR_VERSION/main/recovery.conf` on replica:

```ini
standby_mode = 'on'
primary_conninfo = 'host=PRIMARY_IP port=5432 user=replication_user password=secure_password'
recovery_target_timeline = 'latest'
```

Ensure correct permissions:
```bash
sudo chown postgres:postgres /var/lib/postgresql/MAJOR_VERSION/main/recovery.conf
sudo chmod 600 /var/lib/postgresql/MAJOR_VERSION/main/recovery.conf
```

### 5. Start Replica
```bash
sudo systemctl start postgresql
```

### 6. Verify Replication
On primary, check replication status:
```sql
SELECT slot_name, slot_type, active FROM pg_replication_slots;
SELECT pid, usename, application_name, state FROM pg_stat_replication;
```

On replica, verify read-only mode:
```sql
SELECT pg_is_in_recovery();
-- Should return: true
```

### 7. Configure Application
In `DATABASE_READ_REPLICA_URL` environment variable, set the replica connection string:

```
DATABASE_URL=postgresql://user:password@primary.example.com:5432/pilots
DATABASE_READ_REPLICA_URL=postgresql://user:password@replica.example.com:5432/pilots
```

In application, route read-heavy queries to replica:
```typescript
const primaryDb = new Pool({ connectionString: process.env.DATABASE_URL })
const replicaDb = new Pool({ connectionString: process.env.DATABASE_READ_REPLICA_URL })

// Analytics queries use replica
const reports = await replicaDb.query('SELECT ... FROM analytics')

// Write queries use primary
await primaryDb.query('INSERT INTO orders ...')
```

## Monitoring

### Check Replication Lag
```sql
-- On primary
SELECT slot_name, restart_lsn, confirmed_flush_lsn FROM pg_replication_slots;

-- On replica
SELECT now() - pg_last_xact_replay_timestamp() AS replication_lag;
```

### Alert Thresholds
- Replication lag > 5 seconds: Warning
- Replication lag > 30 seconds: Critical
- Replication slots full: Critical

## Failover Procedure (if primary fails)

1. Promote replica to primary:
```bash
sudo -u postgres pg_ctl promote -D /var/lib/postgresql/MAJOR_VERSION/main
```

2. Verify replica is now primary (read-write):
```sql
SELECT pg_is_in_recovery();
-- Should return: false
```

3. Update application connection strings to new primary
4. Set up new replica from new primary

## Best Practices

- **Monitor replication lag** continuously; alert if > 5 seconds
- **Test failover procedures** monthly in staging environment
- **Use connection pooling** (PgBouncer, Pgpool) for replica connections
- **Backup replica regularly** in case of corruption
- **Review slow query logs** on replica to optimize reads
- **Use read-only replicas** to prevent accidental writes

## Troubleshooting

### Replica lagging
- Check network connectivity between primary and replica
- Verify `max_wal_senders` and `wal_keep_size` on primary
- Check disk space on replica

### Replication stopped
- Check PostgreSQL logs on both primary and replica
- Verify replication user credentials in `recovery.conf`
- Ensure primary is not in backup mode

### Replica out of sync
- Perform full resync: delete all files on replica and run `pg_basebackup` again
- Restart replica PostgreSQL service
