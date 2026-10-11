import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ProjectQueue } from './ProjectQueue'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useOrganizationStore } from '@/stores/organizationStore'

const initialProjectState = useProjectStore.getState()
const initialSettingsState = useSettingsStore.getState()
const initialUiState = useUiStore.getState()
const initialChatState = useChatStore.getState()
const initialOrganizationState = useOrganizationStore.getState()

describe('ProjectQueue mode switch', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useProjectStore.setState(initialProjectState, true)
    useSettingsStore.setState(initialSettingsState, true)
    useUiStore.setState(initialUiState, true)
    useChatStore.setState(initialChatState, true)
    useOrganizationStore.setState(initialOrganizationState, true)
    useChatStore.setState({ chats: [], activeChatId: null, workspaceKey: 'test' })
    useSettingsStore.setState({ language: 'en' })
  })

  it('hides manual and auto controls in normal mode', () => {
    useProjectStore.setState({ appMode: 'normal', mode: 'auto' })

    render(<ProjectQueue />)

    expect(screen.queryByRole('button', { name: 'Manual' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Auto' })).not.toBeInTheDocument()
  })

  it('does not expose the legacy global execution toggle in project mode', () => {
    useProjectStore.setState({ appMode: 'project', mode: 'auto' })

    render(<ProjectQueue />)

    expect(screen.queryByRole('button', { name: 'Manual' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Auto' })).not.toBeInTheDocument()
  })

  it('groups chats in shared folders and filters by title', () => {
    useProjectStore.setState({ appMode: 'normal' })
    useChatStore.setState({
      workspaceKey: 'ws',
      chats: [
        { id: 'chat-lung', title: 'Lung cancer staging', createdAt: 1, updatedAt: 2 },
        { id: 'chat-brain', title: 'Glioma imaging', createdAt: 1, updatedAt: 1 },
      ],
      activeChatId: 'chat-lung',
    })
    useOrganizationStore.setState({
      folders: [{ id: 'folder-lung', name: 'Lung cancer', created_at: 'x', updated_at: 'x' }],
      assignments: { chat: { 'chat-lung': 'folder-lung' }, project: {} },
    })

    render(<ProjectQueue />)

    expect(screen.getByText('Lung cancer')).toBeInTheDocument()
    expect(screen.getByText('Uncategorized')).toBeInTheDocument()
    const search = screen.getByPlaceholderText('Search folders and titles...')
    fireEvent.change(search, { target: { value: 'Glioma' } })
    expect(screen.queryByText('Lung cancer staging')).not.toBeInTheDocument()
    expect(screen.getByText('Glioma imaging')).toBeInTheDocument()
  })

  it('moves a dragged chat into a folder', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
      text: async () => '',
    })))
    useProjectStore.setState({ appMode: 'normal' })
    useChatStore.setState({
      workspaceKey: 'ws',
      chats: [{ id: 'chat-1', title: 'Question', createdAt: 1, updatedAt: 1 }],
      activeChatId: 'chat-1',
    })
    useOrganizationStore.setState({
      loaded: true,
      folders: [{ id: 'folder-1', name: 'Topic', created_at: 'x', updated_at: 'x' }],
      assignments: { chat: {}, project: {} },
    })
    const data = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
    }

    render(<ProjectQueue />)

    const source = screen.getByText('Question').closest('[draggable="true"]')
    const target = screen.getByText('Topic').closest('div')
    expect(source).not.toBeNull()
    expect(target).not.toBeNull()
    fireEvent.dragStart(source!, { dataTransfer })
    fireEvent.drop(target!, { dataTransfer })

    await waitFor(() => {
      expect(useOrganizationStore.getState().assignments.chat['chat-1']).toBe('folder-1')
    })
    vi.unstubAllGlobals()
  })

  it('enters a conversation instead of leaving the project start page active', () => {
    useProjectStore.setState({
      appMode: 'project',
      selectedTaskId: 'PRJ-1',
      tasks: [{
        id: 'PRJ-1',
        label: 'Project',
        title: 'Project',
        status: 'in_progress',
        coreQuestion: 'Question',
        experiments: [],
        knowledge: [],
        research: { references: [], notes: [] },
        result: {},
        startedAt: new Date().toISOString(),
      }],
    } as never)

    render(<ProjectQueue />)
    fireEvent.click(screen.getByRole('button', { name: /^Chats/ }))

    expect(useProjectStore.getState().appMode).toBe('normal')
    expect(useChatStore.getState().activeChatId).not.toBeNull()
  })

  it('enters project mode and selects a project at the module start page', () => {
    useProjectStore.setState({
      appMode: 'normal',
      selectedTaskId: null,
      activeStage: 'research',
      tasks: [{
        id: 'PRJ-1',
        label: 'Project',
        title: 'Project',
        status: 'in_progress',
        coreQuestion: 'Question',
        experiments: [],
        knowledge: [],
        research: { references: [], notes: [] },
        result: {},
        startedAt: new Date().toISOString(),
      }],
    } as never)

    render(<ProjectQueue />)
    fireEvent.click(screen.getByRole('button', { name: /^Projects/ }))

    expect(useProjectStore.getState().appMode).toBe('project')
    expect(useProjectStore.getState().selectedTaskId).toBe('PRJ-1')
    expect(useProjectStore.getState().activeStage).toBe('modules')
  })

  it('asks for a name and directory before creating a lightweight project and opening its overview', async () => {
    useProjectStore.setState({
      appMode: 'project',
      selectedTaskId: null,
      activeStage: 'research',
      tasks: [],
    } as never)
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'PRJ-new',
      display_name: 'New project',
      project_dir: '/tmp/projects/PRJ-new',
      has_plan: false,
      run_mode: 'auto',
      agent_profile: 'research',
      contract_version: 1,
    }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    render(<ProjectQueue />)
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))

    expect(screen.getByRole('dialog', { name: 'New project' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Create Project' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Lung CT Study' } })
    fireEvent.change(screen.getByLabelText('Project Location'), { target: { value: '/tmp/my projects' } })
    expect(screen.getByText('Project directory: /tmp/my projects/lung-ct-study')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }))

    await waitFor(() => expect(useProjectStore.getState().selectedTaskId).toBe('PRJ-new'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      project_id: 'lung-ct-study',
      display_name: 'Lung CT Study',
      project_parent_dir: '/tmp/my projects',
    })
    expect(useUiStore.getState().systemMessages.at(-1)?.text).toBe('Created “New project” at /tmp/projects/PRJ-new')
    expect(useProjectStore.getState().activeStage).toBe('modules')
    expect(useProjectStore.getState().tasks[0]).toMatchObject({
      id: 'PRJ-new',
      label: 'New project',
      coreQuestion: '',
    })
    expect(useUiStore.getState().newProjectOpen).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
