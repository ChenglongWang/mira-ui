import { useEffect } from 'react'

import { workflowWsClient } from '@/services/workflowWebsocket'
import { useProjectStore } from '@/stores/projectStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useSettingsStore } from '@/stores/settingsStore'

export function useWorkflowWebSocket() {
  const projectId = useProjectStore((state) => state.selectedTaskId)
  const appMode = useProjectStore((state) => state.appMode)
  const engineStatus = useSettingsStore((state) => state.engineStatus)

  useEffect(() => workflowWsClient.onMessage((message) => {
    useWorkflowStore.getState().handleSocketMessage(message)
  }), [])

  useEffect(() => {
    if (appMode !== 'project' || !projectId || engineStatus !== 'compatible') {
      workflowWsClient.stop()
      return
    }
    void useWorkflowStore.getState().loadProject(projectId)
    workflowWsClient.subscribe(projectId, () => useWorkflowStore.getState().cursorFor(projectId))
    return () => workflowWsClient.stop()
  }, [appMode, engineStatus, projectId])
}
