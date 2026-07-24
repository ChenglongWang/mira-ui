import { create } from 'zustand'

import { commandWorkflowProject, commandWorkflowRun, createWorkflowRun, fetchWorkflowSnapshot } from '@/services/api'
import type { WorkflowModuleType, WorkflowSnapshot, WorkflowSocketMessage } from '@/types'

interface WorkflowState {
  snapshots: Record<string, WorkflowSnapshot | undefined>
  loadingByProject: Record<string, boolean>
  errorByProject: Record<string, string | null>
  activityByRun: Record<string, string | undefined>
  selectedRunByProject: Record<string, string | null | undefined>
  loadProject: (projectId: string) => Promise<void>
  createRun: (
    projectId: string,
    moduleType: WorkflowModuleType,
    intent?: string,
    options?: {
      inputArtifactIds?: string[]
      parentRunId?: string
      enqueue?: boolean
      moduleData?: Record<string, unknown>
    },
  ) => Promise<string>
  commandRun: (projectId: string, runId: string, commandType: string, payload?: Record<string, unknown>) => Promise<void>
  setHandoffMode: (projectId: string, mode: 'manual' | 'auto') => Promise<void>
  selectRun: (projectId: string, runId: string) => void
  handleSocketMessage: (message: WorkflowSocketMessage) => void
  cursorFor: (projectId: string) => number
  removeProject: (projectId: string) => void
  clear: () => void
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  snapshots: {},
  loadingByProject: {},
  errorByProject: {},
  activityByRun: {},
  selectedRunByProject: {},

  loadProject: async (projectId) => {
    set((state) => ({
      loadingByProject: { ...state.loadingByProject, [projectId]: true },
      errorByProject: { ...state.errorByProject, [projectId]: null },
    }))
    try {
      const snapshot = await fetchWorkflowSnapshot(projectId)
      set((state) => {
        const current = state.snapshots[projectId]
        const accepted = !current || snapshot.project_sequence >= current.project_sequence
          ? snapshot
          : current
        return {
          snapshots: { ...state.snapshots, [projectId]: accepted },
          loadingByProject: { ...state.loadingByProject, [projectId]: false },
          selectedRunByProject: {
            ...state.selectedRunByProject,
            [projectId]: state.selectedRunByProject[projectId]
              ?? accepted.workflow.selected_run_id
              ?? accepted.runs.at(-1)?.run_id
              ?? null,
          },
        }
      })
    } catch (error) {
      set((state) => ({
        loadingByProject: { ...state.loadingByProject, [projectId]: false },
        errorByProject: {
          ...state.errorByProject,
          [projectId]: error instanceof Error ? error.message : String(error),
        },
      }))
    }
  },

  createRun: async (projectId, moduleType, intent, options) => {
    const receipt = await createWorkflowRun(projectId, {
      moduleType,
      moduleData: {
        ...options?.moduleData,
        ...(intent?.trim() ? { intent: intent.trim() } : {}),
        ...(options?.parentRunId ? { parent_run_id: options.parentRunId } : {}),
      },
      inputs: options?.inputArtifactIds?.map((artifact_id) => ({ artifact_id })),
      enqueue: options?.enqueue,
    })
    set((state) => ({
      selectedRunByProject: { ...state.selectedRunByProject, [projectId]: receipt.run_id },
    }))
    await get().loadProject(projectId)
    return receipt.run_id
  },

  commandRun: async (projectId, runId, commandType, payload) => {
    const run = get().snapshots[projectId]?.runs.find((item) => item.run_id === runId)
    if (!run) throw new Error(`Run not found: ${runId}`)
    await commandWorkflowRun(projectId, runId, commandType, run.revision, payload)
    await get().loadProject(projectId)
  },

  setHandoffMode: async (projectId, mode) => {
    const workflow = get().snapshots[projectId]?.workflow
    if (!workflow) throw new Error(`Workflow not found: ${projectId}`)
    await commandWorkflowProject(projectId, 'set_handoff_policy', workflow.revision, {
      handoff_policy: { ...workflow.handoff_policy, mode },
    })
    await get().loadProject(projectId)
  },

  selectRun: (projectId, runId) => set((state) => ({
    selectedRunByProject: { ...state.selectedRunByProject, [projectId]: runId },
  })),

  handleSocketMessage: (message) => {
    if (message.message_type === 'workflow_event' && message.project_id) {
      const current = get().snapshots[message.project_id]
      if (current && message.project_sequence <= current.project_sequence) return
      void get().loadProject(message.project_id)
      return
    }
    if (message.message_type === 'snapshot_required' && message.project_id) {
      void get().loadProject(message.project_id)
      return
    }
    if (message.message_type === 'activity' && message.run_id) {
      set((state) => {
        const next = { ...state.activityByRun }
        if (message.summary) next[message.run_id as string] = message.summary
        else delete next[message.run_id as string]
        return { activityByRun: next }
      })
    }
  },

  cursorFor: (projectId) => get().snapshots[projectId]?.project_sequence ?? 0,
  removeProject: (projectId) => set((state) => {
    const snapshots = { ...state.snapshots }
    const loadingByProject = { ...state.loadingByProject }
    const errorByProject = { ...state.errorByProject }
    const selectedRunByProject = { ...state.selectedRunByProject }
    delete snapshots[projectId]
    delete loadingByProject[projectId]
    delete errorByProject[projectId]
    delete selectedRunByProject[projectId]
    return { snapshots, loadingByProject, errorByProject, selectedRunByProject }
  }),
  clear: () => set({
    snapshots: {}, loadingByProject: {}, errorByProject: {}, activityByRun: {}, selectedRunByProject: {},
  }),
}))
