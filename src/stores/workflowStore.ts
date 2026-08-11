import { create } from 'zustand'

import { commandWorkflowProject, commandWorkflowRun, createWorkflowRun, fetchWorkflowSnapshot } from '@/services/api'
import {
  buildWorkflowCandidates,
  resolveWorkflowCandidate,
  workflowRunsForUpstreamCandidate,
  type WorkflowCandidateItem,
  type WorkflowCandidateSelection,
} from '@/lib/workflowCandidates'
import type { WorkflowModuleType, WorkflowSnapshot, WorkflowSocketMessage } from '@/types'

function isGenericActivityPing(summary: string): boolean {
  return /^mira is working(?:\.\.\.)?$/i.test(summary.trim())
}

function selectionFor(candidate: WorkflowCandidateItem | null): WorkflowCandidateSelection | null {
  return candidate ? { runId: candidate.runId, itemId: candidate.itemId } : null
}

interface WorkflowState {
  snapshots: Record<string, WorkflowSnapshot | undefined>
  loadingByProject: Record<string, boolean>
  errorByProject: Record<string, string | null>
  activityByRun: Record<string, string | undefined>
  selectedRunByProject: Record<string, string | null | undefined>
  selectedCandidateByProject: Record<
    string,
    Partial<Record<WorkflowModuleType, WorkflowCandidateSelection | null>> | undefined
  >
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
  selectCandidate: (
    projectId: string,
    moduleType: WorkflowModuleType,
    selection: WorkflowCandidateSelection,
  ) => void
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
  selectedCandidateByProject: {},

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
    set((state) => {
      const candidates = { ...state.selectedCandidateByProject[projectId] }
      candidates[moduleType] = { runId: receipt.run_id, itemId: receipt.run_id }
      if (moduleType === 'initiation' || moduleType === 'planning') {
        candidates.experiment = null
        candidates.delivery = null
      } else if (moduleType === 'experiment') {
        candidates.delivery = null
      }
      return {
        selectedRunByProject: { ...state.selectedRunByProject, [projectId]: receipt.run_id },
        selectedCandidateByProject: {
          ...state.selectedCandidateByProject,
          [projectId]: candidates,
        },
      }
    })
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

  selectCandidate: (projectId, moduleType, selection) => set((state) => {
    const current = { ...state.selectedCandidateByProject[projectId] }
    current[moduleType] = selection
    const runs = state.snapshots[projectId]?.runs ?? []
    const sourceCandidate = resolveWorkflowCandidate(
      buildWorkflowCandidates(runs, moduleType),
      selection,
    )

    // Switch the downstream columns to this candidate's existing branch. If
    // no matching Run exists, keep the stage deliberately blank until the
    // user continues and creates one.
    if (moduleType === 'initiation' || moduleType === 'planning') {
      const experimentCandidates = sourceCandidate
        ? buildWorkflowCandidates(
            workflowRunsForUpstreamCandidate(runs, 'experiment', sourceCandidate),
            'experiment',
          )
        : []
      const experimentCandidate = resolveWorkflowCandidate(
        experimentCandidates,
        current.experiment ?? undefined,
      )
      current.experiment = selectionFor(experimentCandidate)

      const deliveryCandidates = experimentCandidate
        ? buildWorkflowCandidates(
            workflowRunsForUpstreamCandidate(runs, 'delivery', experimentCandidate),
            'delivery',
          )
        : []
      current.delivery = selectionFor(resolveWorkflowCandidate(
        deliveryCandidates,
        current.delivery ?? undefined,
      ))
    } else if (moduleType === 'experiment') {
      const deliveryCandidates = sourceCandidate
        ? buildWorkflowCandidates(
            workflowRunsForUpstreamCandidate(runs, 'delivery', sourceCandidate),
            'delivery',
          )
        : []
      current.delivery = selectionFor(resolveWorkflowCandidate(
        deliveryCandidates,
        current.delivery ?? undefined,
      ))
    }
    return {
      selectedRunByProject: { ...state.selectedRunByProject, [projectId]: selection.runId },
      selectedCandidateByProject: {
        ...state.selectedCandidateByProject,
        [projectId]: current,
      },
    }
  }),

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
        const runId = message.run_id as string
        if (!message.summary) {
          delete next[runId]
        } else if (!isGenericActivityPing(message.summary) || !next[runId]) {
          // A heartbeat proves liveness but must not overwrite the last useful
          // one-line tool/progress description for this Run.
          next[runId] = message.summary
        }
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
    const selectedCandidateByProject = { ...state.selectedCandidateByProject }
    delete snapshots[projectId]
    delete loadingByProject[projectId]
    delete errorByProject[projectId]
    delete selectedRunByProject[projectId]
    delete selectedCandidateByProject[projectId]
    return {
      snapshots,
      loadingByProject,
      errorByProject,
      selectedRunByProject,
      selectedCandidateByProject,
    }
  }),
  clear: () => set({
    snapshots: {},
    loadingByProject: {},
    errorByProject: {},
    activityByRun: {},
    selectedRunByProject: {},
    selectedCandidateByProject: {},
  }),
}))
