import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/api', () => ({
  commandWorkflowProject: vi.fn(),
  commandWorkflowRun: vi.fn(),
  createWorkflowRun: vi.fn(),
  fetchWorkflowSnapshot: vi.fn(),
  importWorkflowArtifact: vi.fn(),
}))

vi.mock('@/services/websocket', () => ({
  wsClient: {
    connected: true,
    send: vi.fn(),
  },
}))

import { createWorkflowRun, fetchWorkflowSnapshot } from '@/services/api'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { ProjectTask, WorkflowSnapshot } from '@/types'
import { WorkflowWorkspace } from './WorkflowWorkspace'

const task: ProjectTask = {
  id: 'PRJ-1',
  label: 'Project',
  status: 'in_progress',
  title: 'Project',
  coreQuestion: 'Why?',
  experiments: [],
  knowledge: [],
  research: { references: [], notes: [] },
  result: {},
  startedAt: '2026-07-23T00:00:00Z',
}

const snapshot: WorkflowSnapshot = {
  workflow_contract_version: 1,
  project_id: 'PRJ-1',
  project_sequence: 1,
  workflow: {
    contract_version: 1,
    status: 'active',
    revision: 1,
    last_project_sequence: 1,
    selected_run_id: 'run-1',
    handoff_policy: { mode: 'manual', interrupt_grace_seconds: 10, rules: [] },
  },
  runs: [{
    schema_version: 1,
    workflow_contract_version: 1,
    run_id: 'run-1',
    project_id: 'PRJ-1',
    module_type: 'initiation',
    label: 'Initiation 1',
    status: 'queued',
    revision: 1,
    created_at: '2026-07-23T00:00:00Z',
    updated_at: '2026-07-23T00:00:00Z',
    inputs: [],
    outputs: [],
    attempt: { number: 0 },
    attempts: [],
    conversation_key: 'ui:PRJ-1:run:run-1',
    last_project_sequence: 1,
    last_run_sequence: 1,
    module_data: { intent: 'Find a direction' },
  }],
}

describe('WorkflowWorkspace module entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWorkflowStore.getState().clear()
    useProjectStore.setState({
      tasks: [task],
      appMode: 'project',
      selectedTaskId: 'PRJ-1',
      activeStage: 'modules',
      mode: 'auto',
      agentProfile: 'research',
    } as never)
    useSettingsStore.setState({ language: 'en', streamResponses: true })
    useUiStore.setState({ agentPanelCollapsed: true })
    useAgentStore.setState({
      connected: true,
      logsByProject: {},
      streamingBySession: {},
    })
    vi.mocked(createWorkflowRun).mockResolvedValue({ run_id: 'run-1', project_sequence: 1 })
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(snapshot)
  })

  it('collects a goal, creates an enqueued run, opens its module, and sends the first message', async () => {
    render(<WorkflowWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: /Initiation.*Start module/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    const intent = screen.getByLabelText('Goal for this run')
    expect(intent).toHaveValue('Why?')
    fireEvent.change(intent, { target: { value: 'Find three testable research directions' } })
    fireEvent.change(screen.getByLabelText('Your references'), {
      target: { value: 'https://doi.org/10.1000/example' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start and open module' }))

    await waitFor(() => {
      expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', {
        moduleType: 'initiation',
        moduleData: {
          intent: 'Find three testable research directions',
          literature_review: {
            enabled: true,
            sources: [
              'pubmed',
              'google_scholar',
              'arxiv',
              'semantic_scholar',
              'crossref',
              'europe_pmc',
            ],
          },
          references: 'https://doi.org/10.1000/example',
        },
        inputs: undefined,
        enqueue: true,
      })
    })
    expect(useProjectStore.getState().activeStage).toBe('research')
    expect(useUiStore.getState().agentPanelCollapsed).toBe(false)
    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      content: expect.stringContaining('Selected sources: PubMed, Google Scholar'),
      session_id: 'PRJ-1',
      loop_mode: 'project',
      workflow_run_id: 'run-1',
      workflow_module_type: 'initiation',
    }))
    const visiblePrompt = useAgentStore.getState().logsByProject['PRJ-1:run:run-1']?.[0]?.content
    expect(visiblePrompt).toContain('Find three testable research directions')
    expect(visiblePrompt).toContain('User references:\nhttps://doi.org/10.1000/example')
    expect(visiblePrompt).toContain('structured research result')
    expect(visiblePrompt).toContain('auditable reference cards')
  })

  it('passes experiment limits and stopping conditions into the ModuleRun', async () => {
    render(<WorkflowWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: /Experiment.*Start module/i }))
    fireEvent.click(screen.getByRole('button', { name: '+ Add stopping condition' }))
    fireEvent.change(screen.getByLabelText('Stopping metric 1'), {
      target: { value: 'accuracy' },
    })
    fireEvent.change(screen.getByLabelText('Stopping operator 1'), {
      target: { value: '>=' },
    })
    fireEvent.change(screen.getByLabelText('Stopping value 1'), {
      target: { value: '0.95' },
    })
    fireEvent.change(screen.getByLabelText('Maximum experiments'), {
      target: { value: '8' },
    })
    fireEvent.change(screen.getByLabelText('Token limit'), {
      target: { value: '50000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start and open module' }))

    await waitFor(() => {
      expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', {
        moduleType: 'experiment',
        moduleData: {
          intent: 'Why?',
          automation_policy: {
            logic: 'AND',
            goals: [{ metric: 'accuracy', operator: '>=', value: 0.95 }],
            maxExperiments: 8,
            maxTokens: 50000,
          },
        },
        inputs: undefined,
        enqueue: true,
      })
    })
  })

  it('starts a continued branch with inherited artifacts instead of leaving it queued', async () => {
    const completedSnapshot: WorkflowSnapshot = {
      ...snapshot,
      project_sequence: 2,
      workflow: { ...snapshot.workflow, selected_run_id: 'source-run' },
      runs: [{
        ...snapshot.runs[0],
        run_id: 'source-run',
        status: 'completed',
        revision: 2,
        outputs: ['artifact-1', 'artifact-2'],
        module_data: {
          intent: 'Find a direction',
          completion_summary: 'Three directions selected.',
        },
      }],
    }
    vi.mocked(fetchWorkflowSnapshot).mockResolvedValue(completedSnapshot)
    vi.mocked(createWorkflowRun).mockResolvedValue({
      run_id: 'delivery-run',
      project_sequence: 3,
    })
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': completedSnapshot },
      selectedRunByProject: { 'PRJ-1': 'source-run' },
    })

    render(<WorkflowWorkspace />)

    const handoffHeading = await screen.findByText('Continue from this result (new branch)')
    const handoffSection = handoffHeading.parentElement
    expect(handoffSection).not.toBeNull()
    fireEvent.click(
      Array.from(handoffSection!.querySelectorAll('button')).find(
        (button) => button.textContent?.includes('Delivery'),
      )!,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Inherits 2 artifact/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Goal for this run'), {
      target: { value: 'Write a concise research report from the selected direction' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Journal Article/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Start and open module' }))

    await waitFor(() => {
      expect(createWorkflowRun).toHaveBeenCalledWith('PRJ-1', {
        moduleType: 'delivery',
        enqueue: true,
        moduleData: {
          delivery_format: 'paper_article',
          intent: 'Write a concise research report from the selected direction',
          output_path: 'result/exports/journal_article.docx',
          output_type: 'article_docx',
          parent_run_id: 'source-run',
        },
        inputs: [{ artifact_id: 'artifact-1' }, { artifact_id: 'artifact-2' }],
      })
    })
    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      content: expect.stringContaining('Target format: Journal Article (.docx)'),
      workflow_run_id: 'delivery-run',
      workflow_module_type: 'delivery',
    }))
  })

  it('can start an already queued run so existing stranded branches recover', async () => {
    useWorkflowStore.setState({
      snapshots: { 'PRJ-1': snapshot },
      selectedRunByProject: { 'PRJ-1': 'run-1' },
    })

    render(<WorkflowWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))

    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      content: expect.stringContaining('Find a direction'),
      workflow_run_id: 'run-1',
      workflow_module_type: 'initiation',
    }))
  })

  it('uses the research brief language for the visible initiation prompt', async () => {
    render(<WorkflowWorkspace />)

    fireEvent.click(screen.getByRole('button', { name: /Initiation.*Start module/i }))
    fireEvent.change(screen.getByLabelText('Goal for this run'), {
      target: { value: '调研近三年的肝纤维化分级研究' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Start and open module' }))

    await waitFor(() => {
      expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
        content: expect.stringContaining('请执行本次立项与文献调研'),
      }))
    })
    expect(wsClient.send).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('结构化研究结果'),
    }))
  })

  it('keeps the dialog open and explains when the agent socket is disconnected', async () => {
    useAgentStore.setState({ connected: false })
    ;(wsClient as { connected: boolean }).connected = false
    render(<WorkflowWorkspace />)

    expect(screen.queryByRole('button', { name: /Planning.*Start module/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Experiment.*Start module/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Start and open module' }))

    expect(await screen.findByText(/Agent chat is not connected yet/)).toBeInTheDocument()
    expect(createWorkflowRun).not.toHaveBeenCalled()
    ;(wsClient as { connected: boolean }).connected = true
  })
})
