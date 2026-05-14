import { EventEmitter } from 'events'

// OBD-II PID codes
const PID = {
  SPEED: '0x0D',
  RPM: '0x0C',
  COOLANT_TEMP: '0x05',
  FUEL_LEVEL: '0x2F',
  ENGINE_LOAD: '0x04',
  TROUBLE_CODES: '0x19', // DTC codes
}

export interface ObdReading {
  speed: number
  rpm: number
  coolantTemp: number
  fuelLevel: number
  errors: string[]
  timestamp: number
}

export class ObdReader extends EventEmitter {
  private mockMode: boolean
  private isConnected: boolean = false

  constructor(mockMode: boolean = true) {
    super()
    this.mockMode = mockMode
  }

  async connect(serialPort?: string): Promise<void> {
    if (this.mockMode) {
      this.isConnected = true
      return
    }

    // In a real implementation, initialize serialport connection
    // For now, just set connected flag
    this.isConnected = true
  }

  async disconnect(): Promise<void> {
    this.isConnected = false
  }

  async readPid(pid: string): Promise<string> {
    if (!this.isConnected) {
      throw new Error('OBD not connected')
    }

    if (this.mockMode) {
      return this.mockReadPid(pid)
    }

    // Real serialport implementation would go here
    return ''
  }

  private mockReadPid(pid: string): string {
    // Mock PID responses based on standard OBD format
    // Format: 41 PID DATA...
    switch (pid) {
      case PID.SPEED:
        // Speed in km/h: data / 2.55
        return '41 0D ' + Math.floor(Math.random() * 200).toString(16).padStart(2, '0')

      case PID.RPM:
        // RPM: ((A * 256) + B) / 4
        const rpmHigh = Math.floor(Math.random() * 255)
        const rpmLow = Math.floor(Math.random() * 255)
        return `41 0C ${rpmHigh.toString(16).padStart(2, '0')} ${rpmLow.toString(16).padStart(2, '0')}`

      case PID.COOLANT_TEMP:
        // Temp: A - 40 (celsius)
        const tempRaw = 40 + Math.floor(Math.random() * 60)
        return '41 05 ' + tempRaw.toString(16).padStart(2, '0')

      case PID.FUEL_LEVEL:
        // Fuel: (A / 255) * 100 (percentage)
        return '41 2F ' + Math.floor(Math.random() * 255).toString(16).padStart(2, '0')

      case PID.TROUBLE_CODES:
        // Return mock DTC codes
        return '49 02 0301 0501' // 2 codes

      default:
        return ''
    }
  }

  async readAllPids(): Promise<ObdReading> {
    const speedHex = this.parseHexResponse(await this.readPid(PID.SPEED))
    const rpmHex = this.parseHexResponse(await this.readPid(PID.RPM))
    const tempHex = this.parseHexResponse(await this.readPid(PID.COOLANT_TEMP))
    const fuelHex = this.parseHexResponse(await this.readPid(PID.FUEL_LEVEL))
    const codesHex = this.parseHexResponse(await this.readPid(PID.TROUBLE_CODES))

    return {
      speed: this.decodeSpeed(speedHex),
      rpm: this.decodeRpm(rpmHex),
      coolantTemp: this.decodeTemp(tempHex),
      fuelLevel: this.decodeFuel(fuelHex),
      errors: this.decodeTroubleCodes(codesHex),
      timestamp: Date.now(),
    }
  }

  private parseHexResponse(response: string): number[] {
    // Parse "41 0D 50" -> [0x41, 0x0D, 0x50]
    const parts = response.trim().split(/\s+/)
    return parts.map((p) => parseInt(p, 16))
  }

  private decodeSpeed(bytes: number[]): number {
    if (bytes.length < 3) return 0
    // PID 0x0D: speed = A / 2.55 (km/h)
    return bytes[2] / 2.55
  }

  private decodeRpm(bytes: number[]): number {
    if (bytes.length < 4) return 0
    // PID 0x0C: RPM = ((A * 256) + B) / 4
    const a = bytes[2]
    const b = bytes[3]
    return ((a * 256 + b) / 4) * 0.25 // rough approximation
  }

  private decodeTemp(bytes: number[]): number {
    if (bytes.length < 3) return 0
    // PID 0x05: temp = A - 40 (celsius)
    return bytes[2] - 40
  }

  private decodeFuel(bytes: number[]): number {
    if (bytes.length < 3) return 0
    // PID 0x2F: fuel = (A / 255) * 100 (percentage)
    return (bytes[2] / 255) * 100
  }

  private decodeTroubleCodes(bytes: number[]): string[] {
    // Parse DTC codes from 0x19 response
    // Format: 49 02 [code1_hi code1_lo code2_hi code2_lo ...]
    if (bytes.length < 2) return []

    const codes: string[] = []
    const numCodes = bytes[1]

    // Each code is 2 bytes
    for (let i = 0; i < numCodes && i * 2 + 2 < bytes.length; i++) {
      const hi = bytes[i * 2 + 2]
      const lo = bytes[i * 2 + 3]
      const code = `${hi.toString(16).padStart(2, '0')}${lo.toString(16).padStart(2, '0')}`.toUpperCase()
      codes.push(code)
    }

    return codes
  }
}
