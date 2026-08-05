import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const renderWord = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const pptxLoad = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const pptxRender = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('docx-preview', () => ({
  renderAsync: renderWord,
}))

vi.mock('pptxviewjs', () => ({
  PPTXViewer: class {
    loadFile = pptxLoad
    render = pptxRender
    getSlideCount = () => 2
    getCurrentSlideIndex = () => 0
    goToSlide = vi.fn().mockResolvedValue(undefined)
    destroy = vi.fn()
  },
}))

import type { WorkflowRun } from '@/types'
import { DeliverablePreview } from './DeliverablePreview'

function makeRun(outputPath: string): WorkflowRun {
  return {
    schema_version: 1,
    workflow_contract_version: 1,
    run_id: 'delivery-run',
    project_id: 'PRJ-1',
    module_type: 'delivery',
    label: 'Delivery',
    status: 'running',
    revision: 1,
    created_at: '2026-07-31T00:00:00Z',
    updated_at: '2026-07-31T00:00:00Z',
    inputs: [],
    outputs: [],
    attempt: { number: 1 },
    attempts: [],
    conversation_key: 'ui:PRJ-1:run:delivery-run',
    last_project_sequence: 1,
    last_run_sequence: 1,
    module_data: { output_path: outputPath },
  }
}

describe('DeliverablePreview', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('opens a generated Word document inline as soon as the output path exists', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['docx']),
    }))
    render(
      <DeliverablePreview
        projectId="PRJ-1"
        run={makeRun('result/exports/article.docx')}
        lang="en"
      />,
    )

    await waitFor(() => expect(screen.getByTestId('word-preview')).toBeInTheDocument())
    await waitFor(() => expect(renderWord).toHaveBeenCalled())
  })

  it('renders a generated PowerPoint inline with slide navigation state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }))
    render(
      <DeliverablePreview
        projectId="PRJ-1"
        run={makeRun('result/exports/slides.pptx')}
        lang="en"
      />,
    )

    await waitFor(() => expect(screen.getByTestId('powerpoint-preview')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument())
    expect(pptxLoad).toHaveBeenCalled()
    expect(pptxRender).toHaveBeenCalled()
  })
})
