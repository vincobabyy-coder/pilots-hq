import { logger } from '../logger/logger'

export type Region = 'NG' | 'ZA' | 'KE' | 'EU'

export interface BreachNotificationRequirement {
  region: Region
  authorityName: string
  authorityUrl: string
  notificationDeadlineHours: number
  requiresUserNotification: boolean
  notes: string
}

const REQUIREMENTS: Record<Region, BreachNotificationRequirement> = {
  NG: {
    region: 'NG',
    authorityName: 'NITDA (National Information Technology Development Agency)',
    authorityUrl: 'https://nitda.gov.ng',
    notificationDeadlineHours: 72,
    requiresUserNotification: true,
    notes: 'NDPR Article 4.1(3): 72-hour notification to NITDA for breaches likely to cause harm',
  },
  ZA: {
    region: 'ZA',
    authorityName: 'Information Regulator (South Africa)',
    authorityUrl: 'https://inforegulator.org.za',
    notificationDeadlineHours: 72,
    requiresUserNotification: true,
    notes: 'POPIA Section 22: notify Regulator and data subjects as soon as reasonably possible',
  },
  KE: {
    region: 'KE',
    authorityName: 'Office of the Data Protection Commissioner',
    authorityUrl: 'https://www.odpc.go.ke',
    notificationDeadlineHours: 72,
    requiresUserNotification: true,
    notes: 'Kenya Data Protection Act 2019 Section 43: 72-hour notification to Commissioner',
  },
  EU: {
    region: 'EU',
    authorityName: 'Relevant National DPA (varies by member state)',
    authorityUrl: 'https://edpb.europa.eu',
    notificationDeadlineHours: 72,
    requiresUserNotification: true,
    notes: 'GDPR Article 33: 72-hour notification to supervisory authority from awareness of breach',
  },
}

const RETENTION_DAYS: Record<Region, Record<string, number>> = {
  NG: { tracking_events: 90, driver_location: 30, audit_logs: 2555 },
  ZA: { tracking_events: 90, driver_location: 30, audit_logs: 2555 },
  KE: { tracking_events: 90, driver_location: 30, audit_logs: 2555 },
  EU: { tracking_events: 30, driver_location: 14, audit_logs: 2555 },
}

export function getBreachRequirements(region: Region): BreachNotificationRequirement {
  const req = REQUIREMENTS[region]
  if (!req) throw new Error(`Breach requirements not defined for region: ${region}`)
  return req
}

export function logBreachDeadline(region: Region, discoveredAt: Date): void {
  const req = getBreachRequirements(region)
  const deadline = new Date(discoveredAt.getTime() + req.notificationDeadlineHours * 60 * 60 * 1000)
  logger.error('BREACH_NOTIFICATION_REQUIRED', {
    event: 'BREACH_NOTIFICATION_REQUIRED',
    region,
    authority: req.authorityName,
    authorityUrl: req.authorityUrl,
    discoveredAt: discoveredAt.toISOString(),
    deadline: deadline.toISOString(),
    deadlineHours: req.notificationDeadlineHours,
    notes: req.notes,
  })
}

export function getRetentionRequirements(region: Region): Record<string, number> {
  const ret = RETENTION_DAYS[region]
  if (!ret) throw new Error(`Retention requirements not defined for region: ${region}`)
  return ret
}
