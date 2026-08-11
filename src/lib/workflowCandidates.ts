import type { WorkflowInteraction, WorkflowModuleType, WorkflowRun } from '@/types'

export type WorkflowCandidateKind = 'choice' | 'artifact' | 'run'

export interface WorkflowCandidateItem {
  itemId: string
  runId: string
  moduleType: WorkflowModuleType
  label: string
  description?: string
  artifactIds: string[]
  status: WorkflowRun['status']
  kind: WorkflowCandidateKind
  selectedByRun: boolean
  updatedAt: string
}

export interface WorkflowCandidateSelection {
  runId: string
  itemId: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function choiceValue(choice: Record<string, unknown>): string {
  const value = choice.value ?? choice.artifact_id ?? choice.id ?? choice.label
  return value === undefined || value === null ? '' : String(value)
}

function interactionSelection(interaction: WorkflowInteraction | undefined): string | null {
  if (!interaction || interaction.response === undefined) return null
  if (interaction.response_schema.type !== 'object') return String(interaction.response)
  const response = asRecord(interaction.response)
  if (!response) return null
  const required = Array.isArray(interaction.response_schema.required)
    ? interaction.response_schema.required.filter((item): item is string => typeof item === 'string')
    : []
  const primary = required[0] ?? 'value'
  const selected = response[primary]
  return selected === undefined || selected === null ? null : String(selected)
}

function outputLabel(run: WorkflowRun, artifactId: string, index: number): string {
  const outputPath = text(run.module_data.output_path)
  if (run.outputs.length === 1 && outputPath) {
    return outputPath.split('/').filter(Boolean).at(-1) ?? outputPath
  }
  const completionSummary = text(run.module_data.completion_summary)
  if (run.outputs.length === 1 && completionSummary) return completionSummary
  const shortId = artifactId.length > 18 ? `${artifactId.slice(0, 15)}…` : artifactId
  return run.outputs.length > 1 ? `${index + 1}. ${shortId}` : shortId
}

function runFallbackLabel(run: WorkflowRun): string {
  return text(run.module_data.completion_summary)
    || text(run.module_data.intent)
    || run.label
}

export function buildWorkflowCandidates(
  runs: WorkflowRun[],
  moduleType: WorkflowModuleType,
): WorkflowCandidateItem[] {
  const candidates: WorkflowCandidateItem[] = []
  const moduleRuns = runs
    .filter((run) => run.module_type === moduleType)
    .slice()
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))

  for (const run of moduleRuns) {
    const interaction = asRecord(run.module_data.interaction) as WorkflowInteraction | null
    const resolvedSelection = interactionSelection(interaction ?? undefined)
    const seenItemIds = new Set<string>()
    const researchResult = asRecord(run.module_data.research_result)
    const directions = Array.isArray(researchResult?.directions)
      ? researchResult.directions.map(asRecord).filter((item): item is Record<string, unknown> => item !== null)
      : []

    for (const direction of directions) {
      const itemId = text(direction.id) || text(direction.title)
      if (!itemId || seenItemIds.has(itemId)) continue
      seenItemIds.add(itemId)
      candidates.push({
        itemId,
        runId: run.run_id,
        moduleType,
        label: text(direction.title) || itemId,
        description: text(direction.rationale) || text(direction.next_step) || undefined,
        artifactIds: [...run.outputs],
        status: run.status,
        kind: 'choice',
        selectedByRun: resolvedSelection === itemId,
        updatedAt: run.updated_at,
      })
    }

    for (const choice of interaction?.choices ?? []) {
      const itemId = choiceValue(choice)
      if (!itemId || seenItemIds.has(itemId)) continue
      seenItemIds.add(itemId)
      const artifactId = text(choice.artifact_id)
      candidates.push({
        itemId,
        runId: run.run_id,
        moduleType,
        label: text(choice.label) || text(choice.title) || text(choice.name) || itemId,
        description: text(choice.description) || text(choice.rationale) || undefined,
        artifactIds: artifactId ? [artifactId] : [...run.outputs],
        status: run.status,
        kind: 'choice',
        selectedByRun: resolvedSelection === itemId,
        updatedAt: run.updated_at,
      })
    }

    // Structured choices are the candidates; their Run outputs are supporting
    // handoff material, not extra alternatives. Runs without structured
    // choices expose each output Artifact as its own selectable candidate.
    if (seenItemIds.size === 0) {
      for (const [index, artifactId] of run.outputs.entries()) {
        seenItemIds.add(artifactId)
        candidates.push({
          itemId: artifactId,
          runId: run.run_id,
          moduleType,
          label: outputLabel(run, artifactId, index),
          description: text(run.module_data.completion_summary) || undefined,
          artifactIds: [artifactId],
          status: run.status,
          kind: 'artifact',
          selectedByRun: false,
          updatedAt: run.updated_at,
        })
      }
    }

    if (seenItemIds.size === 0 && !['failed', 'cancelled'].includes(run.status)) {
      candidates.push({
        itemId: run.run_id,
        runId: run.run_id,
        moduleType,
        label: runFallbackLabel(run),
        artifactIds: [...run.outputs],
        status: run.status,
        kind: 'run',
        selectedByRun: false,
        updatedAt: run.updated_at,
      })
    }
  }
  return candidates
}

export function resolveWorkflowCandidate(
  candidates: WorkflowCandidateItem[],
  selection: WorkflowCandidateSelection | null | undefined,
  selectedRunId?: string | null,
): WorkflowCandidateItem | null {
  if (selection === null) return null
  if (selection) {
    const explicit = candidates.find((candidate) => (
      candidate.runId === selection.runId && candidate.itemId === selection.itemId
    ))
    if (explicit) return explicit
  }
  const selectedByRun = candidates.find((candidate) => candidate.selectedByRun)
  if (selectedByRun) return selectedByRun
  const currentRunCandidates = candidates.filter((candidate) => candidate.runId === selectedRunId)
  if (currentRunCandidates.length === 1) return currentRunCandidates[0]
  return candidates.length === 1 ? candidates[0] : null
}

function candidateArtifactSignature(candidate: WorkflowCandidateItem): string {
  return [...candidate.artifactIds].sort().join('\u0000')
}

/**
 * Return only target-module Runs that belong to the branch started from the
 * selected upstream candidate. New Runs carry an exact `upstream_selection`.
 * Older/automatic handoffs are recovered from `parent_run_id`, unique input
 * artifacts, or the interaction choice saved on the source Run.
 */
export function workflowRunsForUpstreamCandidate(
  runs: WorkflowRun[],
  targetModuleType: WorkflowModuleType,
  upstreamCandidate: WorkflowCandidateItem,
): WorkflowRun[] {
  const siblingCandidates = buildWorkflowCandidates(runs, upstreamCandidate.moduleType)
    .filter((candidate) => candidate.runId === upstreamCandidate.runId)
  const artifactSignature = candidateArtifactSignature(upstreamCandidate)
  const hasUniqueArtifactSignature = artifactSignature.length > 0 && siblingCandidates.filter(
    (candidate) => candidateArtifactSignature(candidate) === artifactSignature,
  ).length === 1

  return runs.filter((run) => {
    if (run.module_type !== targetModuleType) return false
    if (text(run.module_data.parent_run_id) !== upstreamCandidate.runId) return false

    const savedSelection = asRecord(run.module_data.upstream_selection)
    const savedRunId = text(savedSelection?.run_id)
    const savedItemId = text(savedSelection?.item_id)
    if (savedRunId || savedItemId) {
      return (!savedRunId || savedRunId === upstreamCandidate.runId)
        && (!savedItemId || savedItemId === upstreamCandidate.itemId)
    }

    if (hasUniqueArtifactSignature) {
      const inputIds = new Set(run.inputs.map((input) => input.artifact_id))
      if (
        upstreamCandidate.artifactIds.length > 0
        && upstreamCandidate.artifactIds.every((artifactId) => inputIds.has(artifactId))
      ) return true
    }

    return siblingCandidates.length === 1 || upstreamCandidate.selectedByRun
  })
}
