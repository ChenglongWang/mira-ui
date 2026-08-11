import { describe, expect, it } from 'vitest'

import type { WorkflowRun } from '@/types'
import {
  buildWorkflowCandidates,
  resolveWorkflowCandidate,
  workflowRunsForUpstreamCandidate,
} from './workflowCandidates'

function makeRun(overrides: Partial<WorkflowRun>): WorkflowRun {
  return {
    schema_version: 1,
    workflow_contract_version: 1,
    run_id: 'run-1',
    project_id: 'PRJ-1',
    module_type: 'initiation',
    label: 'Research run',
    status: 'completed',
    revision: 1,
    created_at: '2026-08-09T00:00:00Z',
    updated_at: '2026-08-09T00:00:00Z',
    inputs: [],
    outputs: ['research-bundle'],
    attempt: { number: 1 },
    attempts: [],
    conversation_key: 'ui:PRJ-1:run:run-1',
    last_project_sequence: 1,
    last_run_sequence: 1,
    module_data: {},
    ...overrides,
  }
}

describe('workflowCandidates', () => {
  it('deduplicates structured directions and interaction choices while retaining the saved choice', () => {
    const run = makeRun({
      module_data: {
        research_result: {
          directions: [
            { id: 'direction-a', title: 'Direction A', rationale: 'Fast.' },
            { id: 'direction-b', title: 'Direction B', rationale: 'High upside.' },
          ],
        },
        interaction: {
          interaction_id: 'choose-direction',
          interaction_type: 'choose_direction',
          title: 'Choose direction',
          prompt: 'Choose one',
          response_schema: { type: 'object', required: ['direction_id'] },
          choices: [
            { id: 'direction-a', label: 'Direction A' },
            { id: 'direction-b', label: 'Direction B' },
          ],
          allow_freeform: false,
          response: { direction_id: 'direction-b' },
        },
      },
    })

    const candidates = buildWorkflowCandidates([run], 'initiation')

    expect(candidates.map((candidate) => candidate.itemId)).toEqual(['direction-a', 'direction-b'])
    expect(resolveWorkflowCandidate(candidates, undefined, 'run-1')?.itemId).toBe('direction-b')
  })

  it('uses a selected artifact instead of forwarding every output', () => {
    const run = makeRun({
      module_type: 'experiment',
      outputs: ['metric-a', 'metric-b'],
      module_data: { completion_summary: 'Two experiment outcomes' },
    })
    const candidates = buildWorkflowCandidates([run], 'experiment')
    const selected = resolveWorkflowCandidate(candidates, {
      runId: 'run-1',
      itemId: 'metric-b',
    })

    expect(selected?.artifactIds).toEqual(['metric-b'])
  })

  it('loads only the downstream Runs linked to the selected item', () => {
    const researchRun = makeRun({
      module_data: {
        research_result: {
          directions: [
            { id: 'direction-a', title: 'Direction A' },
            { id: 'direction-b', title: 'Direction B' },
          ],
        },
      },
    })
    const experimentA = makeRun({
      run_id: 'experiment-a',
      module_type: 'experiment',
      outputs: ['result-a'],
      inputs: [{ artifact_id: 'research-bundle' }],
      module_data: {
        parent_run_id: 'run-1',
        upstream_selection: { run_id: 'run-1', item_id: 'direction-a' },
      },
    })
    const experimentB = makeRun({
      run_id: 'experiment-b',
      module_type: 'experiment',
      outputs: ['result-b'],
      inputs: [{ artifact_id: 'research-bundle' }],
      module_data: {
        parent_run_id: 'run-1',
        upstream_selection: { run_id: 'run-1', item_id: 'direction-b' },
      },
    })
    const runs = [researchRun, experimentA, experimentB]
    const directionB = buildWorkflowCandidates(runs, 'initiation')[1]

    expect(workflowRunsForUpstreamCandidate(runs, 'experiment', directionB).map(
      (run) => run.run_id,
    )).toEqual(['experiment-b'])
  })

  it('recovers a legacy parent-only branch only for the saved source choice', () => {
    const researchRun = makeRun({
      module_data: {
        research_result: {
          directions: [
            { id: 'direction-a', title: 'Direction A' },
            { id: 'direction-b', title: 'Direction B' },
          ],
        },
        interaction: {
          interaction_id: 'direction',
          interaction_type: 'choose_direction',
          title: 'Choose',
          prompt: 'Choose',
          response_schema: { type: 'object', required: ['direction_id'] },
          choices: [],
          allow_freeform: false,
          response: { direction_id: 'direction-a' },
        },
      },
    })
    const legacyExperiment = makeRun({
      run_id: 'legacy-experiment',
      module_type: 'experiment',
      inputs: [{ artifact_id: 'research-bundle' }],
      module_data: { parent_run_id: 'run-1' },
    })
    const runs = [researchRun, legacyExperiment]
    const [directionA, directionB] = buildWorkflowCandidates(runs, 'initiation')

    expect(workflowRunsForUpstreamCandidate(runs, 'experiment', directionA)).toEqual([legacyExperiment])
    expect(workflowRunsForUpstreamCandidate(runs, 'experiment', directionB)).toEqual([])
  })
})
