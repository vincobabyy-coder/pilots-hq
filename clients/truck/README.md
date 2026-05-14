# PILOTS Truck Client

Embedded Linux client for PILOTS that reads vehicle telemetry from OBD-II ports and syncs with the PILOTS backend via WebSocket.

## Features

- **OBD-II Reader**: Parses vehicle telemetry (RPM, speed, fuel, coolant temp, error codes)
- **GPS Integration**: Real-time location tracking with accuracy estimation
- **WebSocket Sync**: Real-time telemetry push to backend with automatic reconnect
- **Offline-First**: SQLite queue for graceful handling of connection drops
- **Alert Detection**:
  - Hard braking (deceleration > 0.5g)
  - Geofence violations
  - Maintenance alerts (low fuel, engine codes)
- **Fully Typed**: Complete TypeScript implementation with test coverage

## Setup

```bash
# Install dependencies
npm install

# Build
npm run build

# Start (mock mode, no hardware required)
npm start

# Or with environment variables
VEHICLE_ID=TRUCK-001 WS_URL=ws://localhost:8080/ws npm start

# Run tests
npm test
```

## Configuration

Environment variables:

- `VEHICLE_ID`: Truck identifier (default: `TRUCK-001`)
- `WS_URL`: Backend WebSocket URL (default: `ws://localhost:8080/ws`)
- `SERIAL_PORT`: OBD-II serial port (e.g., `/dev/ttyUSB0`)
- `MOCK_MODE`: Use mock data instead of hardware (default: `true`)
- `DB_PATH`: SQLite database path (default: `/tmp/truck_telemetry.db`)

## Architecture

```
src/
├── index.ts       Main truck client orchestrator
├── obd.ts         OBD-II reader (PID parsing)
├── gps.ts         GPS location module
├── ws-client.ts   WebSocket connection manager
├── queue.ts       SQLite offline sync queue
├── alerts.ts      Alert detection engine
└── types.ts       Type definitions
```

## WebSocket API

### Client → Server

**Telemetry (every 5 seconds)**:
```json
{
  "type": "truck_telemetry",
  "vehicleId": "TRUCK-001",
  "timestamp": 1704067200000,
  "gps": {"latitude": 6.5244, "longitude": 3.3792, "accuracy": 8.5},
  "speed": 65,
  "fuel": 75.5,
  "coolantTemp": 92,
  "rpm": 2500,
  "errors": []
}
```

**Alerts**:
```json
{
  "type": "alert",
  "vehicleId": "TRUCK-001",
  "timestamp": 1704067200000,
  "severity": "warning",
  "message": "Hard braking detected: 6.2 m/s^2",
  "data": {"deceleration": 6.2, "speedBefore": 80, "speedAfter": 45}
}
```

### Server → Client

**Route Update**:
```json
{
  "type": "route_update",
  "routeId": "RT-001",
  "waypoints": [...]
}
```

**Geofence Update**:
```json
{
  "type": "geofence_update",
  "zones": [
    {
      "id": "ZONE-1",
      "name": "Downtown",
      "latitude": 6.5244,
      "longitude": 3.3792,
      "radiusKm": 0.5,
      "alertOnViolation": true
    }
  ]
}
```

## Hardware Support

### OBD-II Reader
- **CAN Bus**: Direct connection via OBD-II CAN interface
- **Serial Adapter**: USB/serial OBD-II adapters (FTDI-based)
- **Mock Mode**: Generates realistic test data when no hardware present

### GPS
- **Integrated GPS**: GPS module connected to serial port
- **USB GPS**: Standalone USB GPS device
- **Mock Mode**: Generates coordinates near Lagos with realistic variance

## Testing

Run the test suite:

```bash
npm test
```

Tests cover:
- OBD PID parsing and data validation
- GPS distance calculations
- Hard brake detection
- Geofence violations
- Maintenance alert triggering

## Production Checklist

- [ ] Test with actual OBD-II hardware
- [ ] Verify GPS accuracy and timezone handling
- [ ] Test WebSocket reconnection scenarios
- [ ] Validate queue persistence across restarts
- [ ] Monitor CPU and memory usage on embedded device
- [ ] Set up logging aggregation to backend
- [ ] Configure device-specific serial port paths
- [ ] Add systemd service file for auto-start

## Notes

- Telemetry is sent every 5 seconds (configurable)
- Queued data syncs when connection restored
- Hard brake threshold: 0.5g (5 m/s²)
- Fuel low threshold: 20%
- Backend heartbeat: 30 seconds
- Max retry attempts: 10 with exponential backoff
