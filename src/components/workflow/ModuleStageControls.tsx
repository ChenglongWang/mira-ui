import { useMemo, useState } from 'react'

import { t } from '@/i18n'
import {
  buildExportMessage,
  getExportConfig,
  type ExportFormat,
} from '@/lib/exportRequests'
import { wsClient } from '@/services/websocket'
import { useAgentStore } from '@/stores/agentStore'
import { useProjectStore } from '@/stores/projectStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUiStore } from '@/stores/uiStore'
import { useWorkflowStore } from '@/stores/workflowStore'
import type { PipelineStage, WorkflowModuleType, WorkflowRun } from '@/types'
import { WorkflowInteractionPanel } from './WorkflowInteractionPanel'

const MODULE_META: Record<WorkflowModuleType, {
  icon: string
  en: string
  zh: string
  stage: PipelineStage
}> = {
  initiation: { icon: '📚', en: 'Initiation', zh: '立项与调研', stage: 'research' },
  planning: { icon: '🗺️', en: 'Planning', zh: '规划', stage: 'plan' },
  experiment: { icon: '🔬', en: 'Experiment', zh: '实验', stage: 'experiment' },
  delivery: { icon: '📝', en: 'Delivery', zh: '结果交付', stage: 'result' },
}

const DOWNSTREAM_MODULES: Record<WorkflowModuleType, WorkflowModuleType[]> = {
  initiation: ['experiment', 'delivery'],
  planning: ['experiment', 'delivery'],
  experiment: ['delivery'],
  delivery: [],
}

const DELIVERY_FORMATS: Array<{
  format: ExportFormat
  icon: string
  labelKey: 'exportFormatReport' | 'exportFormatPaper' | 'exportFormatPresentation' | 'exportFormatMetadata'
}> = [
  { format: 'experiment_report', icon: '📋', labelKey: 'exportFormatReport' },
  { format: 'paper_article', icon: '📄', labelKey: 'exportFormatPaper' },
  { format: 'presentation', icon: '📊', labelKey: 'exportFormatPresentation' },
  { format: 'metadata', icon: '📦', labelKey: 'exportFormatMetadata' },
]

function startPromptFor(
  task: NonNullable<ReturnType<typeof useProjectStore.getState>['tasks'][number]>,
  moduleType: WorkflowModuleType,
  intent: string,
  deliveryFormat: ExportFormat | null,
): string {
  if (moduleType !== 'delivery' || !deliveryFormat) return intent
  return `${intent}\n\n${buildExportMessage(task, deliveryFormat)}`
}

export function ModuleStageControls() {
  const projectId = useProjectStore((state) => state.selectedTaskId)
  const activeStage = useProjectStore((state) => state.activeStage)
  const task = useProjectStore((state) => (
    state.tasks.find((item) => item.id === state.selectedTaskId)
  ))
  const mode = useProjectStore((state) => state.mode)
  const agentProfile = useProjectStore((state) => state.agentProfile)
  const setActiveStage = useProjectStore((state) => state.setActiveStage)
  const lang = useSettingsStore((state) => state.language)
  const streamResponses = useSettingsStore((state) => state.streamResponses)
  const connected = useAgentStore((state) => state.connected)
  const setAgentPanelCollapsed = useUiStore((state) => state.setAgentPanelCollapsed)
  const snapshot = useWorkflowStore((state) => (
    projectId ? state.snapshots[projectId] : undefined
  ))
  const selectedRunId = useWorkflowStore((state) => (
    projectId ? state.selectedRunByProject[projectId] : null
  ))
  const createRun = useWorkflowStore((state) => state.createRun)
  const selectedRun = useMemo(
    () => snapshot?.runs.find((run) => run.run_id === selectedRunId),
    [selectedRunId, snapshot?.runs],
  )
  const [targetModule, setTargetModule] = useState<WorkflowModuleType | null>(null)
  const [intent, setIntent] = useState('')
  const [deliveryFormat, setDeliveryFormat] = useState<ExportFormat | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (
    !projectId
    || !task
    || !selectedRun
    || MODULE_META[selectedRun.module_type].stage !== activeStage
  ) return null

  const downstream = DOWNSTREAM_MODULES[selectedRun.module_type]
  const interactionVisible = Boolean(selectedRun.status === 'waiting_input'
    && selectedRun.module_data.interaction
    && typeof selectedRun.module_data.interaction === 'object')

  if (!interactionVisible && (selectedRun.status !== 'completed' || downstream.length === 0)) {
    return null
  }

  const openTarget = (moduleType: WorkflowModuleType) => {
    const label = lang === 'zh' ? MODULE_META[moduleType].zh : MODULE_META[moduleType].en.toLowerCase()
    setTargetModule(moduleType)
    setIntent(
      lang === 'zh'
        ? `基于上游模块结果继续${label}。`
        : `Continue with ${label} using the upstream module results.`,
    )
    setDeliveryFormat(null)
    setError(null)
  }

  const closeDialog = () => {
    if (pending) return
    setTargetModule(null)
    setDeliveryFormat(null)
    setError(null)
  }

  const startDownstreamRun = async () => {
    if (!targetModule) return
    const normalizedIntent = intent.trim()
    if (!normalizedIntent) {
      setError(lang === 'zh' ? '请填写本次运行目标。' : 'Describe the goal for this run.')
      return
    }
    if (targetModule === 'delivery' && !deliveryFormat) {
      setError(lang === 'zh' ? '请选择需要的交付物形式。' : 'Choose a deliverable format.')
      return
    }
    if (!connected || !wsClient.connected) {
      setError(
        lang === 'zh'
          ? 'Agent 对话尚未连接，请等待连接后重试。'
          : 'Agent chat is not connected. Wait for it to reconnect and try again.',
      )
      return
    }

    const moduleData: Record<string, unknown> = {}
    if (targetModule === 'delivery' && deliveryFormat) {
      const config = getExportConfig(deliveryFormat)
      moduleData.delivery_format = deliveryFormat
      moduleData.output_path = config.outputPath
      moduleData.output_type = config.outputType
    }
    setPending(true)
    setError(null)
    try {
      const runId = await createRun(projectId, targetModule, normalizedIntent, {
        enqueue: true,
        moduleData,
        inputArtifactIds: selectedRun.outputs,
        parentRunId: selectedRun.run_id,
      })
      const prompt = startPromptFor(task, targetModule, normalizedIntent, deliveryFormat)
      const conversationId = `${projectId}:run:${runId}`
      useAgentStore.getState().addLog(conversationId, {
        id: `module-start-${Date.now()}`,
        timestamp: new Date().toISOString(),
        content: prompt,
        type: 'response',
        metadata: {
          _user: true,
          workflow_run_id: runId,
          workflow_module_type: targetModule,
        },
      })
      useAgentStore.getState().markSessionPending(conversationId)
      setAgentPanelCollapsed(false)
      setActiveStage(MODULE_META[targetModule].stage)
      wsClient.send({
        type: 'message',
        content: prompt,
        session_id: projectId,
        user_id: 'ui_user',
        loop_mode: 'project',
        stream: streamResponses,
        mode,
        agent_profile: agentProfile,
        workflow_run_id: runId,
        workflow_module_type: targetModule,
      })
      setTargetModule(null)
      setDeliveryFormat(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="max-h-[45vh] shrink-0 overflow-y-auto border-b border-[var(--color-border)] bg-[var(--color-bg-primary)] px-6 py-4">
      <div className="mx-auto max-w-2xl">
        {interactionVisible && (
          <WorkflowInteractionPanel
            key={String((selectedRun.module_data.interaction as { interaction_id?: unknown }).interaction_id ?? selectedRun.run_id)}
            projectId={projectId}
            run={selectedRun}
          />
        )}

        {selectedRun.status === 'completed' && downstream.length > 0 && (
          <div className={interactionVisible ? 'mt-4' : ''}>
            <div className="mb-2 text-xs font-medium text-[var(--color-text-secondary)]">
              {lang === 'zh' ? '下一步：从当前结果继续' : 'Next: continue from this result'}
            </div>
            <div className="flex flex-wrap gap-2">
              {downstream.map((moduleType) => (
                <button
                  key={moduleType}
                  type="button"
                  onClick={() => openTarget(moduleType)}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:border-[var(--color-accent)]/50 hover:bg-[var(--color-bg-hover)]"
                >
                  {MODULE_META[moduleType].icon}{' '}
                  {lang === 'zh' ? MODULE_META[moduleType].zh : MODULE_META[moduleType].en}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {targetModule && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="downstream-module-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog()
          }}
        >
          <div className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="text-2xl">{MODULE_META[targetModule].icon}</span>
              <div className="min-w-0 flex-1">
                <h3 id="downstream-module-title" className="text-base font-semibold text-[var(--color-text-primary)]">
                  {lang === 'zh'
                    ? `继续到${MODULE_META[targetModule].zh}`
                    : `Continue to ${MODULE_META[targetModule].en}`}
                </h3>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {lang === 'zh'
                    ? `将继承当前 Run 的 ${selectedRun.outputs.length} 个产物，并创建新的分支。`
                    : `Creates a new branch with ${selectedRun.outputs.length} inherited artifact(s).`}
                </p>
              </div>
              <button
                type="button"
                aria-label={lang === 'zh' ? '关闭' : 'Close'}
                onClick={closeDialog}
                disabled={pending}
                className="rounded-md px-2 py-1 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)]"
              >
                ×
              </button>
            </div>

            <label className="mt-5 block text-xs font-medium text-[var(--color-text-secondary)]" htmlFor="downstream-run-intent">
              {lang === 'zh' ? '本次运行目标' : 'Goal for this run'}
            </label>
            <textarea
              id="downstream-run-intent"
              value={intent}
              disabled={pending}
              onChange={(event) => setIntent(event.target.value)}
              className="mt-2 min-h-24 w-full resize-y rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent)]"
            />

            {targetModule === 'delivery' && (
              <fieldset className="mt-4">
                <legend className="text-xs font-medium text-[var(--color-text-secondary)]">
                  {lang === 'zh' ? '选择交付物形式' : 'Choose deliverable format'}
                </legend>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {DELIVERY_FORMATS.map((option) => {
                    const config = getExportConfig(option.format)
                    const active = deliveryFormat === option.format
                    return (
                      <button
                        key={option.format}
                        type="button"
                        aria-pressed={active}
                        disabled={pending}
                        onClick={() => {
                          setDeliveryFormat(option.format)
                          setError(null)
                        }}
                        className={[
                          'rounded-xl border p-3 text-left',
                          active
                            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                            : 'border-[var(--color-border)] bg-[var(--color-bg-primary)] hover:bg-[var(--color-bg-hover)]',
                        ].join(' ')}
                      >
                        <div className="text-sm font-medium text-[var(--color-text-primary)]">
                          {option.icon} {t(option.labelKey, lang)}
                        </div>
                        <div className="mt-1 truncate font-mono text-[10px] text-[var(--color-text-muted)]">
                          {config.outputPath}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            )}

            {error && (
              <div className="mt-3 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/5 p-3 text-xs text-[var(--color-danger)]">
                {error}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={closeDialog}
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)]"
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={pending || !intent.trim() || (targetModule === 'delivery' && !deliveryFormat)}
                onClick={() => void startDownstreamRun()}
                className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {pending
                  ? (lang === 'zh' ? '正在启动…' : 'Starting…')
                  : (lang === 'zh' ? '创建分支并开始' : 'Create branch and start')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
