import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '@/services/api'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { ResourceExplorer } from './ResourceExplorer'

vi.mock('@/components/artifacts', () => ({ ArtifactPreview: () => null }))

describe('ResourceExplorer file identity', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useSettingsStore.setState({ language: 'en' })
    useUiStore.setState({ chatCenterPreviewFile: null })
    useProjectStore.setState({
      appMode: 'project', selectedTaskId: 'PRJ-A', tasks: [], projectsLoaded: true,
    })
  })

  it('browses filenames that match Object prototype properties', async () => {
    vi.spyOn(api, 'fetchProjectFilesResult').mockResolvedValue({
      ok: true,
      truncated: false,
      files: ['constructor/one.txt', '__proto__/two.txt', 'toString/three.txt'].map((path) => ({
        name: path.split('/').pop()!, path, size: 1, mtime: 1, is_dir: false,
      })),
    })
    render(<ResourceExplorer />)
    fireEvent.click(await screen.findByText('constructor'))
    fireEvent.click(screen.getByText('__proto__'))
    fireEvent.click(screen.getByText('toString'))
    expect(screen.getByText('one.txt')).toBeInTheDocument()
    expect(screen.getByText('two.txt')).toBeInTheDocument()
    expect(screen.getByText('three.txt')).toBeInTheDocument()
  })

  it('keeps files selectable without exposing single-file deletion', async () => {
    vi.spyOn(api, 'fetchProjectFilesResult').mockResolvedValue({
      ok: true,
      truncated: false,
      files: [{ name: 'a.txt', path: 'a.txt', size: 1, mtime: 1, is_dir: false }],
    })
    render(<ResourceExplorer />)
    fireEvent.click(await screen.findByText('a.txt'))
    expect(screen.getByRole('button', { name: 'Close preview' })).toBeInTheDocument()
    expect(screen.queryByTitle('Delete')).not.toBeInTheDocument()
    expect(screen.queryByText('🗑')).not.toBeInTheDocument()
  })

  it('keeps same-named project files separate and routes the selected project', async () => {
    useProjectStore.setState({
      appMode: 'normal',
      tasks: [{ id: 'PRJ-A', label: 'same' }, { id: 'PRJ-B', label: 'same' }] as ReturnType<typeof useProjectStore.getState>['tasks'],
    })
    vi.spyOn(api, 'fetchProjectFiles').mockResolvedValue([
      { name: 'a.csv', path: 'data/a.csv', size: 1, mtime: 1, is_dir: false },
    ])
    render(<ResourceExplorer />)
    const projects = await screen.findAllByText('same')
    expect(projects).toHaveLength(2)
    projects.forEach((project) => fireEvent.click(project))
    screen.getAllByText('data').forEach((directory) => fireEvent.click(directory))
    const files = screen.getAllByText('a.csv')
    expect(files).toHaveLength(2)
    fireEvent.click(files[1])
    expect(useUiStore.getState().chatCenterPreviewFile).toMatchObject({
      projectId: 'PRJ-B', relativePath: 'data/a.csv', path: 'PRJ-B/data/a.csv',
    })
  })

  it('shows matches inside collapsed folders while filtering', async () => {
    vi.spyOn(api, 'fetchProjectFilesResult').mockResolvedValue({
      ok: true,
      truncated: false,
      files: [{ name: 'metrics.json', path: 'experiments/exp001/metrics.json', size: 1, mtime: 1, is_dir: false }],
    })
    render(<ResourceExplorer />)
    await screen.findByText('experiments')
    expect(screen.queryByText('metrics.json')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Filter files…'), { target: { value: 'metrics' } })
    expect(screen.getByText('metrics.json')).toBeInTheDocument()
  })

  it('ignores a slow listing for a project that is no longer selected', async () => {
    let resolveOld: (value: Awaited<ReturnType<typeof api.fetchProjectFilesResult>>) => void = () => {}
    vi.spyOn(api, 'fetchProjectFilesResult').mockImplementation((sessionId) => {
      if (sessionId === 'PRJ-A') return new Promise((resolve) => { resolveOld = resolve })
      return Promise.resolve({
        ok: true,
        truncated: false,
        files: [{ name: 'new.txt', path: 'new.txt', size: 1, mtime: 1, is_dir: false }],
      })
    })
    render(<ResourceExplorer />)
    act(() => useProjectStore.setState({ selectedTaskId: 'PRJ-B' }))
    await screen.findByText('new.txt')
    await act(async () => resolveOld({
      ok: true,
      truncated: false,
      files: [{ name: 'old.txt', path: 'old.txt', size: 1, mtime: 1, is_dir: false }],
    }))
    expect(screen.getByText('new.txt')).toBeInTheDocument()
    expect(screen.queryByText('old.txt')).not.toBeInTheDocument()
  })

  it('keeps the chat preview open when task statuses refresh', async () => {
    const file = { name: 'a.csv', path: 'data/a.csv', size: 1, mtime: 1, is_dir: false }
    const tasks = [{ id: 'PRJ-A', label: 'a' }] as ReturnType<typeof useProjectStore.getState>['tasks']
    useProjectStore.setState({ appMode: 'normal', tasks })
    const fetchFiles = vi.spyOn(api, 'fetchProjectFiles').mockResolvedValue([file])
    render(<ResourceExplorer />)
    await screen.findByText('a')
    const preview = { ...file, projectId: 'PRJ-A', relativePath: 'data/a.csv' }
    act(() => useUiStore.getState().setChatCenterPreviewFile(preview))
    act(() => useProjectStore.setState({ tasks: tasks.map((task) => ({ ...task })) }))
    expect(useUiStore.getState().chatCenterPreviewFile).toEqual(preview)
    expect(fetchFiles).toHaveBeenCalledTimes(1)
  })

  it('says when the engine truncated the listing', async () => {
    vi.spyOn(api, 'fetchProjectFilesResult').mockResolvedValue({
      ok: true,
      truncated: true,
      files: [{ name: 'a.txt', path: 'a.txt', size: 1, mtime: 1, is_dir: false }],
    })
    render(<ResourceExplorer />)
    expect(await screen.findByText(/too many files/)).toBeInTheDocument()
  })
})
