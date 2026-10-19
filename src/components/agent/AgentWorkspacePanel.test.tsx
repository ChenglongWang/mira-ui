import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { AgentWorkspacePanel } from './AgentWorkspacePanel'

vi.mock('./AgentPanel', () => ({
  AgentPanel: ({ showHeader }: { showHeader?: boolean }) => (
    <div>{showHeader === false ? 'agent-panel-no-header' : 'agent-panel-with-header'}</div>
  ),
  AgentPanelActions: () => <div>agent-actions</div>,
}))
vi.mock('@/components/project/ResourceExplorer', () => ({ ResourceExplorer: () => <div>explorer</div> }))

describe('AgentWorkspacePanel', () => {
  beforeEach(() => {
    useSettingsStore.setState({ language: 'en' })
    useUiStore.setState({ workbenchTab: 'agent' })
  })

  it('puts the agent tab before the explorer tab', () => {
    render(<AgentWorkspacePanel />)
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Agent Chat', 'Files'])
  })

  it('shows the conversation without a second header and its actions in the tab strip', () => {
    render(<AgentWorkspacePanel />)
    expect(screen.getByText('agent-panel-no-header')).toBeInTheDocument()
    expect(screen.getByText('agent-actions')).toBeInTheDocument()
  })

  it('switches to the explorer and hides the conversation actions', () => {
    render(<AgentWorkspacePanel />)
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }))
    expect(screen.getByText('explorer')).toBeInTheDocument()
    expect(screen.queryByText('agent-actions')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveAttribute('aria-selected', 'true')
  })
})
