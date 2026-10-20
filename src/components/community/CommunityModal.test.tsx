import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CommunityModal } from './CommunityModal'
import { useCommunityStore } from '@/stores/communityStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'

describe('CommunityModal approval inbox', () => {
  beforeEach(() => {
    useSettingsStore.setState({ language: 'en' })
    useUiStore.setState({ communityOpen: true })
    useCommunityStore.setState({
      status: {
        enabled: true, logged_in: true, agent_id: 'agent-1', api_base: 'http://x', autonomy_mode: 'hitl',
        code_host: 'github', domains: [], pending_count: 2, member_status: 'active',
      },
      approvals: [
        {
          id: 'p1', action: 'persona_update', status: 'pending', created_at: '2026-10-20T00:00:00Z',
          payload: { draft: 'x', workspace: '/w', diff: '+- **Domains**: plugins, agents\n' },
        },
        {
          id: 'w1', action: 'claim_work_order', status: 'pending', created_at: '2026-10-20T00:00:00Z',
          payload: { work_order_id: 'fb5c1242-b58a-4e06' },
        },
      ],
      loading: false,
      error: null,
      refresh: vi.fn(async () => {}),
    })
  })

  it('shows the persona diff and labels new engine actions', () => {
    render(<CommunityModal />)
    expect(screen.getByTestId('community-persona-diff').textContent).toContain('**Domains**: plugins, agents')
    expect(screen.getByText('Community persona')).toBeTruthy()
    expect(screen.getByText('Claim work order')).toBeTruthy()
    expect(screen.getByText('fb5c1242')).toBeTruthy()
    expect(screen.getByText('A new autonomy mode takes effect after the engine restarts.')).toBeTruthy()
  })
})

describe('CommunityModal join form', () => {
  const startPairing = vi.fn(async () => {})

  beforeEach(() => {
    startPairing.mockClear()
    useSettingsStore.setState({ language: 'en' })
    useUiStore.setState({ communityOpen: true })
    useCommunityStore.setState({
      status: {
        enabled: true, logged_in: false, agent_id: '', api_base: 'http://x', autonomy_mode: 'hitl',
        code_host: 'github', domains: ['rag'], pending_count: 0,
      },
      approvals: [],
      loading: false,
      error: null,
      pairing: { active: false, verificationUrl: null, userCode: null, error: null },
      refresh: vi.fn(async () => {}),
      startPairing,
    })
  })

  it('collects the public profile and passes it to pairing', () => {
    render(<CommunityModal />)
    expect((screen.getByPlaceholderText('plugins, agents') as HTMLInputElement).value).toBe('rag')
    fireEvent.change(screen.getByPlaceholderText('python, react'), { target: { value: 'Python， go, python' } })
    fireEvent.click(screen.getByLabelText('Develop'))
    fireEvent.change(screen.getByRole('textbox', { name: 'One line about you' }), { target: { value: ' Builds RAG tools ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Join the community' }))
    expect(startPairing).toHaveBeenCalledWith({
      domains: ['rag'],
      tech_stack: ['Python', 'go', 'python'],
      participation: ['answer', 'review', 'discuss'],
      bio: 'Builds RAG tools',
    })
  })

  it('needs at least one way to take part', () => {
    render(<CommunityModal />)
    for (const label of ['Answer questions', 'Review code', 'Develop', 'Discuss']) {
      fireEvent.click(screen.getByLabelText(label))
    }
    expect(screen.getByText('Pick at least one.')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Join the community' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows why pairing could not start, on the form', () => {
    useCommunityStore.setState({ pairing: { active: false, verificationUrl: null, userCode: null, error: 'pairing failed: bad bio' } })
    render(<CommunityModal />)
    expect(screen.getByText('pairing failed: bad bio')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Join the community' })).toBeTruthy()
  })
})
