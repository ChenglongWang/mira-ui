import { useSettingsStore } from '@/stores/settingsStore'

export function ExperimentExecutionMode({ value, onChange, disabled = false }: {
  value: 'auto' | 'manual'
  onChange: (value: 'auto' | 'manual') => void
  disabled?: boolean
}) {
  const zh = useSettingsStore((state) => state.language) === 'zh'
  return (
    <fieldset className="mt-4 space-y-2" disabled={disabled}>
      <legend className="text-xs font-medium text-[var(--color-text-secondary)]">
        {zh ? '实验执行模式' : 'Experiment execution mode'}
      </legend>
      <div className="flex gap-2">
        {(['auto', 'manual'] as const).map((mode) => (
          <button key={mode} type="button" aria-pressed={value === mode} onClick={() => onChange(mode)}
            className={`rounded-full border px-4 py-1.5 text-xs disabled:opacity-50 ${value === mode
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
              : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'}`}>
            {mode === 'auto' ? (zh ? '自动' : 'Auto') : (zh ? '手动' : 'Manual')}
          </button>
        ))}
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        {value === 'auto'
          ? (zh ? '在已批准范围和预算内连续执行实验。' : 'Run experiments continuously within the approved scope and budget.')
          : (zh ? '每个实验结束后等待确认；可继续下一个实验或结束并汇总。' : 'After each experiment, confirm whether to continue with one more or finish and summarize.')}
      </p>
    </fieldset>
  )
}
