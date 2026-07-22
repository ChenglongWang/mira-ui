import { useMemo, useState } from 'react'

import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import { useAgentStore } from '@/stores/agentStore'
import type { WorkflowInteraction, WorkflowModuleType, WorkflowRun, WorkflowRunStatus } from '@/types'
import { cn } from '@/lib/utils'
import { importWorkflowArtifact } from '@/services/api'
import { wsClient } from '@/services/websocket'

const MODULES: Array<{
  type: WorkflowModuleType
  icon: string
  en: string
  zh: string
  enDescription: string
  zhDescription: string
}> = [
  {
    type: 'initiation', icon: '📚', en: 'Initiation', zh: '立项与调研',
    enDescription: 'Review literature, clarify the question, and propose research directions.',
    zhDescription: '调研文献、澄清问题并提出可选择的研究方向。',
  },
  {
    type: 'planning', icon: '🗺️', en: 'Planning', zh: '交互式规划',
    enDescription: 'Turn a direction into an approved, testable plan with the AI.',
    zhDescription: '与 AI 交互确认，把已有方向变成可执行计划。',
  },
  {
    type: 'experiment', icon: '🔬', en: 'Experiment', zh: '实验',
    enDescription: 'Start directly from your own specification, data, or code.',
    zhDescription: '可跳过前序模块，直接从已有方案、数据或代码开始。',
  },
  {
    type: 'delivery', icon: '📝', en: 'Delivery', zh: '结果交付',
    enDescription: 'Write, polish, analyze, or package selected project artifacts.',
    zhDescription: '基于已有材料直接写作、润色、分析或整理交付物。',
  },
]

const STATUS_STYLE: Record<WorkflowRunStatus, string> = {
  created: 'text-[var(--color-text-muted)] bg-[var(--color-bg-tertiary)]',
  queued: 'text-[var(--color-accent)] bg-[var(--color-accent)]/10',
  running: 'text-[var(--color-accent)] bg-[var(--color-accent)]/10',
  waiting_input: 'text-amber-500 bg-amber-500/10',
  paused: 'text-amber-500 bg-amber-500/10',
  completed: 'text-[var(--color-success)] bg-[var(--color-success)]/10',
  failed: 'text-[var(--color-danger)] bg-[var(--color-danger)]/10',
  cancelled: 'text-[var(--color-text-muted)] bg-[var(--color-bg-tertiary)]',
}

function moduleMeta(type: WorkflowModuleType) {
  return MODULES.find((item) => item.type === type) ?? MODULES[0]
}

const NEXT_MODULE: Partial<Record<WorkflowModuleType, WorkflowModuleType>> = {
  initiation: 'planning',
  planning: 'experiment',
  experiment: 'delivery',
}

function InteractionPanel({ projectId, run }: { projectId: string; run: WorkflowRun }) {
  const commandRun = useWorkflowStore((state) => state.commandRun)
  const lang = useSettingsStore((state) => state.language)
  const interaction = run.module_data.interaction as WorkflowInteraction | undefined
  const [selected, setSelected] = useState<unknown>(undefined)
  const [freeform, setFreeform] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (run.status !== 'waiting_input' || !interaction || interaction.response !== undefined) return null

  const choiceValue = (choice: Record<string, unknown>) => (
    choice.value ?? choice.artifact_id ?? choice.id ?? choice.label
  )
  const choiceLabel = (choice: Record<string, unknown>) => String(
    choice.label ?? choice.title ?? choice.name ?? choiceValue(choice) ?? '',
  )
  const buildResponse = () => {
    const schema = interaction.response_schema
    const value = selected ?? freeform.trim()
    if (schema.type !== 'object') return value
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : []
    const primary = required[0] ?? 'value'
    const response: Record<string, unknown> = { [primary]: value }
    const properties = schema.properties
    if (
      selected !== undefined
      && freeform.trim()
      && primary !== 'notes'
      && properties && typeof properties === 'object' && 'notes' in properties
    ) response.notes = freeform.trim()
    return response
  }
  const canSubmit = selected !== undefined || (interaction.allow_freeform && freeform.trim().length > 0)

  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="text-sm font-semibold text-[var(--color-text-primary)]">{interaction.title}</div>
      <div className="mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{interaction.prompt}</div>
      {interaction.choices.length > 0 && (
        <div className="mt-3 grid gap-2">
          {interaction.choices.map((choice, index) => {
            const value = choiceValue(choice)
            const active = selected === value
            return (
              <button
                key={String(choice.id ?? index)}
                type="button"
                onClick={() => setSelected(value)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-xs',
                  active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]',
                )}
              >
                {choiceLabel(choice)}
              </button>
            )
          })}
        </div>
      )}
      {interaction.allow_freeform && (
        <textarea
          value={freeform}
          onChange={(event) => setFreeform(event.target.value)}
          placeholder={lang === 'zh' ? '补充说明或直接输入你的决定' : 'Add notes or enter your decision'}
          className="mt-3 min-h-20 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
      )}
      <button
        type="button"
        disabled={!canSubmit || pending}
        onClick={() => {
          const response = buildResponse()
          setPending(true)
          setError(null)
          void commandRun(projectId, run.run_id, 'submit_interaction', {
            interaction_id: interaction.interaction_id,
            response,
          }).then(() => {
            if (!wsClient.connected) return
            const conversationId = `${projectId}:run:${run.run_id}`
            const continuation = lang === 'zh'
              ? `继续执行。结构化交互 ${interaction.interaction_id} 的回答已保存。`
              : `Continue execution. The response to structured interaction ${interaction.interaction_id} is saved.`
            useAgentStore.getState().addLog(conversationId, {
              id: `interaction-${Date.now()}`,
              timestamp: new Date().toISOString(),
              content: `${interaction.title}: ${JSON.stringify(response)}`,
              type: 'response',
              metadata: { _user: true, _structured_interaction: true },
            })
            useAgentStore.getState().markSessionPending(conversationId)
            const projectState = useProjectStore.getState()
            wsClient.send({
              type: 'message',
              content: continuation,
              session_id: projectId,
              user_id: 'ui_user',
              loop_mode: 'project',
              stream: useSettingsStore.getState().streamResponses,
              mode: projectState.mode,
              agent_profile: projectState.agentProfile,
              workflow_run_id: run.run_id,
              workflow_module_type: run.module_type,
            })
          }).catch((reason) => {
            setError(reason instanceof Error ? reason.message : String(reason))
          }).finally(() => setPending(false))
        }}
        className="mt-3 rounded-md bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
      >
        {pending ? (lang === 'zh' ? '提交中…' : 'Submitting…') : (lang === 'zh' ? '确认并继续' : 'Confirm and continue')}
      </button>
      {error && <div className="mt-2 text-xs text-[var(--color-danger)]">{error}</div>}
    </div>
  )
}

function RunControls({ projectId, run }: { projectId: string; run: WorkflowRun }) {
  const commandRun = useWorkflowStore((state) => state.commandRun)
  const [pending, setPending] = useState(false)
  const [outputPath, setOutputPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const lang = useSettingsStore((state) => state.language)
  const handoffMode = useWorkflowStore((state) => state.snapshots[projectId]?.workflow.handoff_policy.mode)
  const actions: Array<{ command: string; en: string; zh: string }> = []
  if (run.status === 'created') actions.push({ command: 'enqueue', en: 'Start', zh: '开始' })
  if (run.status === 'queued' || run.status === 'running' || run.status === 'waiting_input') {
    actions.push({ command: 'pause', en: 'Pause', zh: '暂停' })
  }
  if (run.status === 'paused') actions.push({ command: 'resume', en: 'Resume', zh: '继续' })
  if (!['completed', 'cancelled'].includes(run.status)) {
    actions.push({ command: 'cancel', en: 'Cancel', zh: '取消' })
  }
  if (run.status === 'failed') actions.push({ command: 'retry', en: 'Retry', zh: '重试' })
  if (run.status === 'running' || run.status === 'waiting_input' || run.status === 'paused') {
    actions.unshift({ command: 'complete', en: 'Mark complete', zh: '完成本模块' })
  }
  return (
    <div className="space-y-2">
      {(run.status === 'running' || run.status === 'waiting_input' || run.status === 'paused') && (
        <input
          value={outputPath}
          onChange={(event) => setOutputPath(event.target.value)}
          placeholder={lang === 'zh' ? '可选：项目内输出文件路径' : 'Optional: output file path inside Project'}
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-xs text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
        />
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
        <button
          key={action.command}
          type="button"
          disabled={pending}
          onClick={() => {
            setPending(true)
            setError(null)
            void (async () => {
              if (action.command === 'complete') {
                const outputs = outputPath.trim()
                  ? [(await importWorkflowArtifact(projectId, outputPath.trim())).artifact_id]
                  : []
                const nextModule = NEXT_MODULE[run.module_type]
                await commandRun(projectId, run.run_id, 'complete', {
                  outputs,
                  suggested_handoffs: handoffMode === 'auto' && nextModule
                    ? [{ target_module_type: nextModule, input_artifact_ids: outputs }]
                    : [],
                })
              } else {
                await commandRun(projectId, run.run_id, action.command)
              }
            })().catch((reason) => {
              setError(reason instanceof Error ? reason.message : String(reason))
            }).finally(() => setPending(false))
          }}
          className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
        >
          {lang === 'zh' ? action.zh : action.en}
        </button>
        ))}
      </div>
      {error && <div className="text-xs text-[var(--color-danger)]">{error}</div>}
    </div>
  )
}

export function WorkflowWorkspace() {
  const projectId = useProjectStore((state) => state.selectedTaskId)
  const task = useProjectStore((state) => state.tasks.find((item) => item.id === state.selectedTaskId))
  const lang = useSettingsStore((state) => state.language)
  const snapshot = useWorkflowStore((state) => projectId ? state.snapshots[projectId] : undefined)
  const loading = useWorkflowStore((state) => projectId ? state.loadingByProject[projectId] : false)
  const error = useWorkflowStore((state) => projectId ? state.errorByProject[projectId] : null)
  const selectedRunId = useWorkflowStore((state) => projectId ? state.selectedRunByProject[projectId] : null)
  const activityByRun = useWorkflowStore((state) => state.activityByRun)
  const createRun = useWorkflowStore((state) => state.createRun)
  const selectRun = useWorkflowStore((state) => state.selectRun)
  const setHandoffMode = useWorkflowStore((state) => state.setHandoffMode)
  const [creating, setCreating] = useState<WorkflowModuleType | null>(null)
  const [policyPending, setPolicyPending] = useState(false)
  const selectedRun = useMemo(
    () => snapshot?.runs.find((run) => run.run_id === selectedRunId) ?? null,
    [selectedRunId, snapshot?.runs],
  )

  if (!projectId) return null

  return (
    <div className="h-full overflow-y-auto bg-[var(--color-bg-primary)]">
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {lang === 'zh' ? '从任意模块开始' : 'Start from any module'}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            {lang === 'zh'
              ? '每次启动都会创建独立的 ModuleRun；同一模块可重复运行和形成分支。'
              : 'Each start creates an independent ModuleRun. Repeat modules freely to form branches.'}
            </p>
          </div>
          {snapshot && (
            <label className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs text-[var(--color-text-secondary)]">
              <span>{lang === 'zh' ? '模块完成后' : 'After completion'}</span>
              <select
                value={snapshot.workflow.handoff_policy.mode}
                disabled={policyPending}
                onChange={(event) => {
                  setPolicyPending(true)
                  void setHandoffMode(projectId, event.target.value as 'manual' | 'auto')
                    .finally(() => setPolicyPending(false))
                }}
                className="bg-transparent font-medium text-[var(--color-accent)] outline-none"
              >
                <option value="manual">{lang === 'zh' ? '由我选择下一步' : 'Let me choose'}</option>
                <option value="auto">{lang === 'zh' ? '自动创建建议模块' : 'Create suggested Run'}</option>
              </select>
            </label>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MODULES.map((module) => (
            <button
              key={module.type}
              type="button"
              disabled={creating !== null || snapshot?.workflow.status === 'archived'}
              onClick={() => {
                setCreating(module.type)
                void createRun(projectId, module.type, task?.coreQuestion)
                  .finally(() => setCreating(null))
              }}
              className="min-h-40 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-left transition hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
            >
              <div className="text-2xl">{module.icon}</div>
              <div className="mt-3 text-sm font-semibold text-[var(--color-text-primary)]">
                {lang === 'zh' ? module.zh : module.en}
              </div>
              <div className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
                {lang === 'zh' ? module.zhDescription : module.enDescription}
              </div>
              <div className="mt-3 text-xs font-medium text-[var(--color-accent)]">
                {creating === module.type
                  ? (lang === 'zh' ? '创建中…' : 'Creating…')
                  : (lang === 'zh' ? '新建运行 →' : 'New run →')}
              </div>
            </button>
          ))}
        </div>

        {error && (
          <div className="rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3 text-xs text-[var(--color-danger)]">
            {error}
          </div>
        )}

        <div className="grid min-h-80 gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(360px,1.2fr)]">
          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]">
            <div className="border-b border-[var(--color-border)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {lang === 'zh' ? '模块运行' : 'Module runs'}
            </div>
            <div className="divide-y divide-[var(--color-border)]">
              {loading && !snapshot && <div className="p-4 text-xs text-[var(--color-text-muted)]">Loading…</div>}
              {snapshot?.runs.length === 0 && (
                <div className="p-5 text-xs leading-relaxed text-[var(--color-text-muted)]">
                  {lang === 'zh' ? '还没有运行。请从上方选择任意模块开始。' : 'No runs yet. Choose any module above to begin.'}
                </div>
              )}
              {snapshot?.runs.slice().reverse().map((run) => {
                const meta = moduleMeta(run.module_type)
                return (
                  <button
                    key={run.run_id}
                    type="button"
                    onClick={() => selectRun(projectId, run.run_id)}
                    className={cn(
                      'w-full px-4 py-3 text-left hover:bg-[var(--color-bg-hover)]',
                      selectedRunId === run.run_id && 'bg-[var(--color-accent)]/5',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span>{meta.icon}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-text-primary)]">{run.label}</span>
                      <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', STATUS_STYLE[run.status])}>
                        {run.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="mt-1 truncate pl-7 text-[10px] font-mono text-[var(--color-text-muted)]">{run.run_id}</div>
                  </button>
                )
              })}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5">
            {!selectedRun ? (
              <div className="flex h-full items-center justify-center text-xs text-[var(--color-text-muted)]">
                {lang === 'zh' ? '选择一个 ModuleRun 查看和控制' : 'Select a ModuleRun to inspect and control'}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <div className="text-2xl">{moduleMeta(selectedRun.module_type).icon}</div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-[var(--color-text-primary)]">{selectedRun.label}</h3>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      {lang === 'zh' ? moduleMeta(selectedRun.module_type).zhDescription : moduleMeta(selectedRun.module_type).enDescription}
                    </p>
                  </div>
                </div>

                {activityByRun[selectedRun.run_id] && (
                  <div className="truncate rounded-md bg-[var(--color-accent)]/8 px-3 py-2 text-xs text-[var(--color-accent)]">
                    {activityByRun[selectedRun.run_id]}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg bg-[var(--color-bg-tertiary)] p-3">
                    <div className="text-[var(--color-text-muted)]">{lang === 'zh' ? '状态' : 'Status'}</div>
                    <div className="mt-1 font-medium text-[var(--color-text-primary)]">{selectedRun.status.replace('_', ' ')}</div>
                  </div>
                  <div className="rounded-lg bg-[var(--color-bg-tertiary)] p-3">
                    <div className="text-[var(--color-text-muted)]">{lang === 'zh' ? '版本' : 'Revision'}</div>
                    <div className="mt-1 font-mono text-[var(--color-text-primary)]">{selectedRun.revision}</div>
                  </div>
                </div>

                {typeof selectedRun.module_data.intent === 'string' && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-[var(--color-text-secondary)]">
                      {lang === 'zh' ? '本次目标' : 'Run intent'}
                    </div>
                    <div className="rounded-lg border border-[var(--color-border)] p-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
                      {selectedRun.module_data.intent}
                    </div>
                  </div>
                )}

                <InteractionPanel key={String((selectedRun.module_data.interaction as WorkflowInteraction | undefined)?.interaction_id ?? selectedRun.run_id)} projectId={projectId} run={selectedRun} />

                {Boolean(selectedRun.module_data.recovery) && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-600">
                    {lang === 'zh'
                      ? '检测到上一次执行在安全边界确认前中断。为避免重复外部操作，本模块已暂停；请检查当前材料后再点击“继续”。'
                      : 'The previous attempt ended before confirming a safe boundary. This Run is paused to avoid repeating uncertain external work; inspect it before choosing Resume.'}
                  </div>
                )}

                {selectedRun.module_data.auto_handoff === true && (
                  <div className="rounded-lg border border-[var(--color-accent)]/25 bg-[var(--color-accent)]/5 p-3 text-xs leading-relaxed text-[var(--color-text-secondary)]">
                    {lang === 'zh'
                      ? '这是根据 Project 衔接策略自动创建的下游 Run。宽限期内你可以取消；之后发送消息即可开始。'
                      : 'This downstream Run was created by the Project handoff policy. You may cancel it during the grace period, then start it by sending a message.'}
                  </div>
                )}

                {(selectedRun.checkpoint_ref || selectedRun.attempts.length > 0) && (
                  <div className="rounded-lg border border-[var(--color-border)] p-3 text-xs">
                    <div className="font-medium text-[var(--color-text-secondary)]">
                      {lang === 'zh' ? '恢复状态' : 'Recovery state'}
                    </div>
                    <div className="mt-1 text-[var(--color-text-muted)]">
                      {lang === 'zh' ? `已记录 ${selectedRun.attempts.length} 次执行` : `${selectedRun.attempts.length} execution attempt(s) recorded`}
                      {selectedRun.checkpoint_ref && (
                        <span className="ml-2 font-mono">checkpoint {selectedRun.checkpoint_ref.slice(0, 8)}</span>
                      )}
                    </div>
                  </div>
                )}

                <RunControls projectId={projectId} run={selectedRun} />

                {selectedRun.status === 'completed' && (
                  <div>
                    <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
                      {lang === 'zh' ? '从此结果继续（创建新分支）' : 'Continue from this result (new branch)'}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {MODULES.map((module) => (
                        <button
                          key={module.type}
                          type="button"
                          disabled={creating !== null}
                          onClick={() => {
                            setCreating(module.type)
                            void createRun(projectId, module.type, undefined, {
                              inputArtifactIds: selectedRun.outputs,
                              parentRunId: selectedRun.run_id,
                            }).finally(() => setCreating(null))
                          }}
                          className="rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-hover)] disabled:opacity-50"
                        >
                          {module.icon} {lang === 'zh' ? module.zh : module.en}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
