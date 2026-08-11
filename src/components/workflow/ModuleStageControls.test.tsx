import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/api', () => ({
  commandWorkflowProject: vi.fn(),
  commandWorkflowRun: vi.fn(),
  createWorkflowRun: vi.fn(),
  fetchWorkflowSnapshot: vi.fn(),
}))

vi.mock('@/services/websocket', () => ({
  wsClient: {
    connected: true,
    send: vi.fn(),
  },
}))

import {
  commandWorkflowRun,
  createWorkflowRun,
  fetchWorkflowSnapshot,
} from '@/services/api'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { ProjectTask, WorkflowRun, WorkflowSnapshot } from '@/types'
import { ModuleStageControls } from './ModuleStageControls'

const task: ProjectTask = {
  id: 'PRJ-1',
  label: 'Project',
  status: 'in_progress',
  title: 'Project',
  coreQuestion: 'Which direction should we pursue?',
  experiments: [],
  knowledge: [],
  research: { references: [], notes: [] },
  result: {},
  startedAt: '2026-07-31T00:00:00Z',
}

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    schema_version: 1,
    workflow_contract_version: 1,
    run_id: 'source-run',
    project_id: 'PRJ-1',
    module_type: 'initiation',
    label: 'Initiation 1',
    status: 'completed',
    revision: 2,
    created_at: '2026-07-31T00:00:00Z',
    updated_at: '2026-07-31T00:01:00Z',
    inputs: [],
    outputs: ['artifact-1', 'artifact-2'],
    attempt: { number: 1 },
    attempts: [],
    conversation_key: 'ui:PRJ-1:run:source-run',
    last_project_sequence: 2,
    last_run_sequence: 2,
    module_data: { intent: 'Review the literature' },
    ...overrides,
  }
}

function makeSnapshot(run: WorkflowRun): WorkflowSnapshot {
  return {
    workflow_contract_version: 1,
    project_id: 'PRJ-1',
    project_sequence: 2,
    workflow: {
      contract_version: 1,
      status: 'active',
      revision: 2,
      last_project_sequence: 2,
      selected_run_id: run.run_id,
      handoff_policy: { mode: 'manual', interrupt_grace_seconds: 10, rules: [] },
    },
    runs: [run],
  }
}

describe('ModuleStageControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkflowStore.getState().clear()
    useProjectStore.setState({
      tasks: [task],
      appMode: 'project',
      selectedTaskId: 'PRJ-1',
      activeStage: 'research',
      mode: 'auto',
      agentProfile: 'research',
    } as never)
    useSettingsStore.setState({ language: 'en', streamResponses: true })
    useAgentStore.setState({
      connected: true,
      logsByProject: {},
      streamingBySession: {},
    })
    ;(wsClient as { connected: boolean }).connected = true
  })

  it('continues to Delivery inside the module page with one of the four legacy formats', async () => {
    const run = makeRun({ module_type: 'experiment' })
    const snapshot = makeSnapshot(run)
    useProjectStore.setState({ activeStage: 'experiment' })
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': snapshot },
      selectedRunByProject: { 'PRJ-1': run.run_id },
    })
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(snapshot)
    vi.mocked(createWorkflowRun).mockResolvedValue({
      run_id: 'delivery-run',
      project_sequence: 3,
    })

    render(<ModuleStageControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Select candidate: 2. artifact-2' }))
    fireEvent.click(screen.getByRole('button', { name: /Delivery/ }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Experiment Report/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Journal Article/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Presentation/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Meta data/ })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Goal for this run'), {
      target: { value: 'Prepare the manuscript for journal submission' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Journal Article/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create branch and start' }))

    await waitFor(() => {
      expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', {
        moduleType: 'delivery',
        enqueue: true,
        inputs: [{ artifact_id: 'artifact-2' }],
        moduleData: {
          delivery_format: 'paper_article',
          intent: 'Prepare the manuscript for journal submission',
          output_path: 'result/exports/journal_article.docx',
          output_type: 'article_docx',
          parent_run_id: 'source-run',
          upstream_selection: {
            module_type: 'experiment',
            run_id: 'source-run',
            item_id: 'artifact-2',
            label: '2. artifact-2',
          },
        },
      })
    })
    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Target format: Journal Article (.docx)'),
      workflow_run_id: 'delivery-run',
      workflow_module_type: 'delivery',
    }))
    expect(useProjectStore.getState().activeStage).toBe('result')
  })

  it('collapses and expands the module candidate outputs with one click', () => {
    const run = makeRun()
    const snapshot = makeSnapshot(run)
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': snapshot },
      selectedRunByProject: { 'PRJ-1': run.run_id },
    })

    render(<ModuleStageControls />)

    const collapse = screen.getByRole('button', { name: 'Collapse candidate outputs' })
    expect(collapse).toHaveAttribute('aria-expanded', 'true')
    expect(collapse).toHaveAttribute('aria-controls', 'module-candidate-output-list')
    expect(screen.getByRole('button', { name: 'Select candidate: 1. artifact-1' })).toBeInTheDocument()
    expect(screen.getByText('Next: continue from this result')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Experiment/ })).toBeInTheDocument()

    fireEvent.click(collapse)

    const expand = screen.getByRole('button', { name: 'Expand candidate outputs' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('2 candidates')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Select candidate: 1. artifact-1' })).not.toBeInTheDocument()
    expect(screen.queryByText('Next: continue from this result')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Experiment/ })).not.toBeInTheDocument()

    fireEvent.click(expand)

    expect(screen.getByRole('button', { name: 'Collapse candidate outputs' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'Select candidate: 1. artifact-1' })).toBeInTheDocument()
    expect(screen.getByText('Next: continue from this result')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Experiment/ })).toBeInTheDocument()
  })

  it('renders and submits structured interaction directly in the module center column', async () => {
    const run = makeRun({
      status: 'waiting_input',
      module_data: {
        interaction: {
          interaction_id: 'direction-choice',
          interaction_type: 'select',
          title: 'Choose a research direction',
          prompt: 'Select the direction to continue with.',
          choices: [
            { id: 'direction-a', label: 'Direction A', value: 'direction-a' },
            { id: 'direction-b', label: 'Direction B', value: 'direction-b' },
          ],
          response_schema: {
            type: 'object',
            required: ['selected_direction'],
            properties: { selected_direction: { type: 'string' } },
          },
          allow_freeform: false,
        },
      },
    })
    const snapshot = makeSnapshot(run)
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': snapshot },
      selectedRunByProject: { 'PRJ-1': run.run_id },
    })
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(snapshot)
    vi.mocked(commandWorkflowRun).mockResolvedValue({} as never)

    render(<ModuleStageControls />)
    fireEvent.click(screen.getByRole('button', { name: 'Direction B' }))
    expect(useWorkflowStore.getState().selectedCandidateByProject['PRJ-1']?.initiation).toEqual({
      runId: 'source-run',
      itemId: 'direction-b',
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }))

    await waitFor(() => {
      expect(commandWorkflowRun).toHaveBeenCalledWith(
        'PRJ-1',
        'source-run',
        'submit_interaction',
        2,
        {
          interaction_id: 'direction-choice',
          response: { selected_direction: 'direction-b' },
        },
      )
    })
    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('direction-choice'),
      workflow_run_id: 'source-run',
      workflow_module_type: 'initiation',
    }))
  })
})
