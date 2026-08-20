import type { ColorProfile } from '@chromashift/core'
import type { Display } from '@chromashift/native-client/protocol'
import { describe, expect, it } from 'vitest'
import { buildDisplayRows } from './display-rows.js'

const connectedDisplay: Display = {
  id: 'display:connected',
  name: 'Connected display',
  windowsDisplayName: '\\\\.\\DISPLAY1',
  monitorDevicePath: 'monitor-path',
  manufacturer: 'TST',
  productCode: '0001',
  serialNumber: 'serial',
  adapter: {
    id: 'adapter',
    name: 'Test adapter',
    vendor: 'nvidia',
    deviceId: 'device'
  },
  connection: 'DisplayPort',
  primary: true,
  hdr: false,
  advancedColorSupported: true,
  bitsPerColorChannel: 8,
  refreshRate: 144
}

describe('buildDisplayRows', () => {
  it('shows connected displays and keeps disconnected targets out of the editor', () => {
    const profile: ColorProfile = {
      id: 'profile',
      name: 'Profile',
      enabled: true,
      applications: [],
      displays: [
        { displayId: connectedDisplay.id, color: { brightness: 55 } },
        { displayId: 'display:disconnected', color: { contrast: 60 } }
      ]
    }

    expect(buildDisplayRows(profile, { displays: [connectedDisplay] })).toEqual([
      {
        displayId: connectedDisplay.id,
        display: connectedDisplay,
        target: profile.displays[0]
      }
    ])
    expect(profile.displays).toHaveLength(2)
  })
})
