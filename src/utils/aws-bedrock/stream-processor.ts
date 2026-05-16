/* eslint-disable yield-star-spacing */

import type { LanguageModelV2StreamPart, LanguageModelV2CallWarning } from '@ai-sdk/provider'
import type { ToolNameMapping } from './types'
import { processClaudeStream } from './claude/claude-stream-processor'
import { processLlamaStream } from './llama/llama-stream-processor'
import { processNovaConverseStream } from './nova/nova-stream-processor'
import { processJambaStream } from './jamba/jamba-stream-processor'
import { processMistralStream } from './mistral/mistral-stream-processor'
import { processCohereStream } from './cohere/cohere-stream-processor'
import { modelIdStartsWith } from './utils'

/**
 * Creates an async generator that yields AI SDK stream parts from Bedrock stream
 *
 * Handles different event types from Claude's streaming API:
 * - content_block_start: Begins a new text or tool block
 * - content_block_delta: Streams incremental text or tool input JSON
 * - content_block_stop: Ends current block
 * - message_delta: Provides stop reason
 * - message_stop: Signals end of stream
 *
 * @param modelId - Bedrock model identifier
 * @param stream - Bedrock response stream
 * @param toolMapping - Maps base tool names to full names
 * @param toolSchemas - Tool schemas for type coercion
 */
export async function* createBedrockStream(
  modelId: string,
  stream: any,
  toolMapping: ToolNameMapping = {},
  toolSchemas: any[] = []
): AsyncGenerator<LanguageModelV2StreamPart> {
  const currentTextId = 'text-0'
  const currentToolCallId = ''
  const currentToolName = ''
  const hasTextStarted = false
  const accumulatedToolInput = ''
  const hasEmittedFinish = false
  const toolCallCount = 0
  let lastStopReason: string | undefined
  const warnings: LanguageModelV2CallWarning[] = []

  yield {
    type: 'stream-start',
    warnings
  }

  if (modelIdStartsWith(modelId, 'anthropic.')) {
    yield* processClaudeStream(
      stream,
      toolMapping,
      toolSchemas,
      {
        currentTextId,
        currentToolCallId,
        currentToolName,
        hasTextStarted,
        accumulatedToolInput,
        hasEmittedFinish,
        toolCallCount,
        lastStopReason
      }
    )
    return
  }

  if (modelIdStartsWith(modelId, 'meta.llama')) {
    yield* processLlamaStream(stream, { currentTextId, hasTextStarted, hasEmittedFinish })
    return
  }

  if (modelIdStartsWith(modelId, 'mistral.')) {
    yield* processMistralStream(stream, toolMapping)
    return
  }

  if (modelIdStartsWith(modelId, 'amazon.nova')) {
    yield* processNovaConverseStream(stream, toolMapping)
    return
  }

  if (modelIdStartsWith(modelId, 'cohere.')) {
    yield* processCohereStream(stream, toolMapping)
    return
  }

  if (modelIdStartsWith(modelId, 'ai21.')) {
    yield* processJambaStream(stream, toolMapping)
  }
}
