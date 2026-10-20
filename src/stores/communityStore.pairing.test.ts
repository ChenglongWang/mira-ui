import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/community', () => ({
  fetchCommunityStatus: vi.fn(),
  fetchCommunityApprovals: vi.fn(async () => []),
  setCommunityAutonomy: vi.fn(),
  decideCommunityApproval: vi.fn(),
  onboardCommunity: vi.fn(),
  startCommunityPairing: vi.fn(),
  pollCommunityPairing: vi.fn(),
}))

import { useCommunityStore } from './communityStore'
import { useUiStore } from './uiStore'
import type { CommunityStatus } from '@/services/community'
import { fetchCommunityStatus, pollCommunityPairing, startCommunityPairing } from '@/services/community'

const status = (profile_onboarded?: boolean): CommunityStatus => ({
  enabled: true, logged_in: true, agent_id: 'a1', api_base: 'http://x', autonomy_mode: 'hitl',
  code_host: 'github', domains: ['rag'], pending_count: 0, member_status: 'pending', profile_onboarded,
})

async function joinAndAuthorize(profileOnboarded?: boolean) {
  vi.mocked(startCommunityPairing).mockResolvedValue({ user_code: 'C', poll_token: 'p', verification_url: 'u', interval: 1 })
  vi.mocked(pollCommunityPairing).mockResolvedValue({ status: 'authorized', agent_id: 'a1' })
  vi.mocked(fetchCommunityStatus).mockResolvedValue(status(profileOnboarded))
  await useCommunityStore.getState().startPairing({ domains: ['rag'], participation: ['review'] })
  await vi.runAllTimersAsync()
}

describe('community pairing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'open').mockImplementation(() => null)
    useUiStore.setState({ onboardingOpen: false })
    useCommunityStore.setState({ status: null, pairing: { active: false, verificationUrl: null, userCode: null, error: null } })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('sends the public profile with the pairing request', async () => {
    await joinAndAuthorize(true)
    expect(startCommunityPairing).toHaveBeenCalledWith({ profile: { domains: ['rag'], participation: ['review'] } })
  })

  it('opens the profile wizard after joining when there is no private profile yet', async () => {
    await joinAndAuthorize(false)
    expect(useCommunityStore.getState().status?.logged_in).toBe(true)
    expect(useUiStore.getState().onboardingOpen).toBe(true)
  })

  it('leaves users with a profile (or an older engine) alone', async () => {
    await joinAndAuthorize(true)
    expect(useUiStore.getState().onboardingOpen).toBe(false)
    await joinAndAuthorize(undefined)
    expect(useUiStore.getState().onboardingOpen).toBe(false)
  })

  it('returns to the join form with the reason when pairing cannot start', async () => {
    vi.mocked(startCommunityPairing).mockResolvedValue({ error: 'pairing failed: bio must be a string of at most 500 characters' })
    await useCommunityStore.getState().startPairing({ bio: 'x' })
    const { pairing } = useCommunityStore.getState()
    expect(pairing.active).toBe(false)
    expect(pairing.error).toMatch(/bio must be/)
  })
})
