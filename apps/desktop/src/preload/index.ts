import { contextBridge, ipcRenderer } from 'electron'
import type { Display, DisplayCapabilityReport, ForegroundApplication, SystemInfo } from '@chromashift/native-client'

export type NativeStatus =
  | {
      state: 'ready'
      info: SystemInfo
      currentApplication: ForegroundApplication | null
      lastForegroundEvent: ForegroundApplication | null
      displays: Display[]
      capabilityReports: Record<string, DisplayCapabilityReport>
      automaticActivation:
        | {
            state: 'enabled'
            configurationPath: string
            initialOutcome: 'activated' | 'skipped' | 'partialFailure' | 'failed' | null
          }
        | { state: 'disabled'; configurationPath: string; message: string }
    }
  | { state: 'error'; message: string }
  | { state: 'starting' }

export interface ChromaShiftApi {
  getNativeStatus(): Promise<NativeStatus>
  requestExit(): Promise<boolean>
}

const api: ChromaShiftApi = {
  getNativeStatus: () => ipcRenderer.invoke('diagnostics:get-native-status') as Promise<NativeStatus>,
  requestExit: () => ipcRenderer.invoke('application:request-exit') as Promise<boolean>
}

contextBridge.exposeInMainWorld('chromaShift', api)
