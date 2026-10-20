import { render, screen } from '@testing-library/react'
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
