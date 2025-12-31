/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable brace-style */
/* eslint-disable yield-star-spacing */

import type { LanguageModelV2StreamPart, LanguageModelV2CallWarning } from '@ai-sdk/provider'
import { mapClaudeStopReason } from './utils'
import { coerceToolInput } from './tool-coercion'
import type { ToolNameMapping } from './types'
import { processNovaConverseStream } from './streams/nova-converse-stream'

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

  // Emit stream-start
  yield {
    type: 'stream-start',
    warnings
  }

  // Process Claude streaming events
  if (modelId.startsWith('anthropic.')) {
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

  // Process other model streams
  if (modelId.startsWith('meta.llama') || modelId.startsWith('us.meta.llama')) {
    yield* processLlamaStream(stream, { currentTextId, hasTextStarted, hasEmittedFinish })
    return
  }

  if (modelId.startsWith('mistral.') || modelId.startsWith('us.mistral.')) {
    yield* processMistralStream(stream, { currentTextId, hasTextStarted, hasEmittedFinish })
    return
  }

  if (modelId.startsWith('amazon.nova')) {
    yield* processNovaConverseStream(stream, toolMapping)
    return
  }

  if (modelId.startsWith('ai21.')) {
    yield* processJambaStream(stream, { currentTextId, currentToolCallId, hasTextStarted, accumulatedToolInput, hasEmittedFinish })
    return
  }

  // Generic stream processing
  yield* processGenericStream(stream, { currentTextId, hasTextStarted })
}

/**
 * Processes Claude (Anthropic) streaming events
 */
async function* processClaudeStream(
  stream: any,
  toolMapping: ToolNameMapping,
  toolSchemas: any[],
  state: any
): AsyncGenerator<LanguageModelV2StreamPart> {
  for await (const event of stream) {
    if (!event.chunk) continue

    const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes))

    if (chunk.type === 'content_block_start') {
      if (chunk.content_block?.type === 'text') {
        state.currentTextId = `text-${chunk.index}`
        yield { type: 'text-start', id: state.currentTextId }
        state.hasTextStarted = true
      } else if (chunk.content_block?.type === 'tool_use') {
        state.currentToolCallId = chunk.content_block.id
        const baseToolName = chunk.content_block.name
        state.currentToolName = toolMapping[baseToolName] || baseToolName
        state.accumulatedToolInput = ''
        state.toolCallCount++

        yield {
          type: 'tool-input-start',
          id: state.currentToolCallId,
          toolName: state.currentToolName
        }
      }
    } else if (chunk.type === 'content_block_delta') {
      if (chunk.delta?.type === 'text_delta') {
        const textDelta = chunk.delta.text || ''

        if (!state.hasTextStarted) {
          yield { type: 'text-start', id: state.currentTextId }
          state.hasTextStarted = true
        }
        yield {
          type: 'text-delta',
          id: state.currentTextId,
          delta: textDelta
        }
      } else if (chunk.delta?.type === 'input_json_delta') {
        const jsonDelta = chunk.delta.partial_json || ''
        state.accumulatedToolInput += jsonDelta

        yield {
          type: 'tool-input-delta',
          id: state.currentToolCallId,
          delta: jsonDelta
        }
      }
    } else if (chunk.type === 'content_block_stop') {
      if (state.hasTextStarted) {
        yield { type: 'text-end', id: state.currentTextId }
        state.hasTextStarted = false
      } else if (state.currentToolCallId) {
        try {
          const rawInput = JSON.parse(state.accumulatedToolInput || '{}')
          const coercedInput = coerceToolInput(state.currentToolName, rawInput, toolSchemas)

          yield { type: 'tool-input-end', id: state.currentToolCallId }
          yield {
            type: 'tool-call',
            toolCallId: state.currentToolCallId,
            toolName: state.currentToolName,
            input: JSON.stringify(coercedInput)
          }
        } catch (e) {
          console.error('❌ Failed to yield tool call:', e)
        }

        state.accumulatedToolInput = ''
        state.currentToolCallId = ''
        state.currentToolName = ''
      }
    } else if (chunk.type === 'message_delta') {
      if (chunk.delta?.stop_reason) {
        state.lastStopReason = chunk.delta.stop_reason
      }
    }
  }

  // Finalization
  if (state.hasTextStarted) {
    yield { type: 'text-end', id: state.currentTextId }
  }

  if (!state.hasEmittedFinish) {
    const finalFinishReason = state.lastStopReason
      ? mapClaudeStopReason(state.lastStopReason)
      : 'stop'
    yield {
      type: 'finish',
      finishReason: finalFinishReason,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    }
  }
}

/**
 * Processes Llama streaming events
 */
export async function* processLlamaStream(
  stream: any,
  state: any
): AsyncGenerator<any> {
  let accumulatedText = ''

  for await (const event of stream) {
    if (!event.chunk) continue

    const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes))
    const textDelta = chunk.generation || ''

    if (textDelta) {
      accumulatedText += textDelta

      if (!state.hasTextStarted) {
        yield { type: 'text-start', id: state.currentTextId }
        state.hasTextStarted = true
      }
      yield { type: 'text-delta', id: state.currentTextId, delta: textDelta }
    }

    if (chunk.stop_reason && !state.hasEmittedFinish) {
      if (state.hasTextStarted) {
        yield { type: 'text-end', id: state.currentTextId }
      }

      const cleaned = accumulatedText
        .replace(/<\|start_header_id\|>.*?<\|end_header_id\|>\s*/gs, '')
        .replace(/.*<\|end_header_id\|>\s*/g, '')
        .replace(/<\|eot_id\|>/g, '')
        .trim()

      let toolCallMatch = cleaned.match(/\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"parameters"\s*:\s*(\{[^}]*\}|\{.*?\})\s*\}/s)

      if (!toolCallMatch) {
        toolCallMatch = cleaned.match(/\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{[^}]*\}|\{.*?\})\s*\}/s)
      }

      if (toolCallMatch) {
        const toolName = toolCallMatch[1]
        let toolParams
        try {
          toolParams = JSON.parse(toolCallMatch[2])
        } catch (e) {
          toolParams = {}
        }

        const toolCallId = `call_${Date.now()}`

        yield { type: 'tool-input-start', id: toolCallId, toolName }
        yield { type: 'tool-input-delta', id: toolCallId, delta: JSON.stringify(toolParams) }
        yield { type: 'tool-input-end', id: toolCallId }
        yield {
          type: 'tool-call',
          toolCallId,
          toolName,
          input: JSON.stringify(toolParams)
        }
      }

      yield {
        type: 'finish',
        finishReason: chunk.stop_reason === 'stop' ? 'stop' : 'length',
        usage: {
          inputTokens: chunk.prompt_token_count || 0,
          outputTokens: chunk.generation_token_count || 0,
          totalTokens: (chunk.prompt_token_count || 0) + (chunk.generation_token_count || 0)
        }
      }
      state.hasEmittedFinish = true
    }
  }
}

/**
 * Processes Amazon Nova streaming events
 */
async function* processNovaStream(
  stream: any,
  state: any
): AsyncGenerator<LanguageModelV2StreamPart> {
  let chunkCount = 0

  for await (const event of stream) {
    chunkCount++
    console.log(`\n📦 Chunk ${chunkCount} received`)

    if (!event.chunk) {
      continue
    }

    let chunk
    try {
      chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes))
    } catch (e) {
      console.error('  ❌ Failed to parse chunk:', e)
      continue
    }

    // Handle tool use start
    if (chunk.contentBlockStart?.start?.toolUse) {
      const toolUse = chunk.contentBlockStart.start.toolUse
      state.currentToolCallId = toolUse.toolUseId
      state.currentToolName = toolUse.name
      state.accumulatedToolInput = ''

      yield {
        type: 'tool-input-start',
        id: state.currentToolCallId,
        toolName: state.currentToolName
      }
    } // Handle tool input delta
    else if (chunk.contentBlockDelta?.delta?.toolUse) {
      const toolDelta = chunk.contentBlockDelta.delta.toolUse.input || ''
      state.accumulatedToolInput += toolDelta

      yield {
        type: 'tool-input-delta',
        id: state.currentToolCallId,
        delta: toolDelta
      }
    }
    // Handle text delta
    else if (chunk.contentBlockDelta?.delta?.text) {
      const textDelta = chunk.contentBlockDelta.delta.text

      if (!state.hasTextStarted) {
        yield { type: 'text-start', id: state.currentTextId }
        state.hasTextStarted = true
      }

      yield {
        type: 'text-delta',
        id: state.currentTextId,
        delta: textDelta
      }
    }
    // Handle content block stop
    else if (chunk.contentBlockStop) {
      if (state.hasTextStarted) {
        yield { type: 'text-end', id: state.currentTextId }
        state.hasTextStarted = false
      } else if (state.currentToolCallId) {
        try {
          const parsedInput = JSON.parse(state.accumulatedToolInput || '{}')

          yield { type: 'tool-input-end', id: state.currentToolCallId }

          const toolCall = {
            type: 'tool-call' as const,
            toolCallId: state.currentToolCallId,
            toolName: state.currentToolName,
            input: JSON.stringify(parsedInput)
          }

          yield toolCall
        } catch (e) {
          yield { type: 'tool-input-end', id: state.currentToolCallId }
          yield {
            type: 'tool-call',
            toolCallId: state.currentToolCallId,
            toolName: state.currentToolName,
            input: '{}'
          }
        }

        // Reset state
        state.accumulatedToolInput = ''
        state.currentToolCallId = ''
        state.currentToolName = ''
      }
    }
    // Handle message stop
    else if (chunk.messageStop) {
      if (!state.hasEmittedFinish) {
        const stopReason = chunk.messageStop.stopReason
        let finishReason: 'stop' | 'length' | 'tool-calls' = 'stop'

        if (stopReason === 'tool_use') {
          finishReason = 'tool-calls'
        } else if (stopReason === 'max_tokens') {
          finishReason = 'length'
        }

        yield {
          type: 'finish',
          finishReason,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
        }
        state.hasEmittedFinish = true
        console.log('  ✅ Yielded finish')
      }
    }
    // Handle metadata
    else if (chunk.metadata) {
      console.log('  ℹ️ METADATA')
      console.log('    - Usage:', chunk.metadata.usage)
      console.log('    - Metrics:', chunk.metadata.metrics)
    } else {
      console.log('  ⚠️ Unknown chunk type:', Object.keys(chunk))
    }
  }

  // Finalization
  console.log('\n🏁 Stream ended, finalizing...')

  if (state.hasTextStarted) {
    console.log('  - Closing open text block')
    yield { type: 'text-end', id: state.currentTextId }
  }

  if (!state.hasEmittedFinish) {
    console.log('  - Emitting final finish event')
    yield {
      type: 'finish',
      finishReason: 'stop',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    }
  }

  console.log('🌊 === NOVA STREAM PROCESSING END ===\n')
}

/**
 * Processes AI21 Jamba streaming events
 */

async function* processJambaStream(
  stream: any,
  state: any
): AsyncGenerator<LanguageModelV2StreamPart> {
  for await (const event of stream) {
    if (!event.chunk) continue

    const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes))
    const choice = chunk.choices?.[0]

    if (choice?.delta?.content) {
      const textDelta = choice.delta.content

      if (!state.hasTextStarted) {
        yield { type: 'text-start', id: state.currentTextId }
        state.hasTextStarted = true
      }
      yield { type: 'text-delta', id: state.currentTextId, delta: textDelta }
    }

    // Handle tool calls
    if (choice?.delta?.tool_calls) {
      for (const toolCall of choice.delta.tool_calls) {
        if (toolCall.function) {
          if (!state.currentToolCallId) {
            state.currentToolCallId = toolCall.id || `call_${Date.now()}`
            state.currentToolName = toolCall.function.name
            state.accumulatedToolInput = ''

            yield {
              type: 'tool-input-start',
              id: state.currentToolCallId,
              toolName: state.currentToolName
            }
          }

          if (toolCall.function.arguments) {
            state.accumulatedToolInput += toolCall.function.arguments
            yield {
              type: 'tool-input-delta',
              id: state.currentToolCallId,
              delta: toolCall.function.arguments
            }
          }
        }
      }
    }

    if (choice?.finish_reason && !state.hasEmittedFinish) {
      if (state.hasTextStarted) {
        yield { type: 'text-end', id: state.currentTextId }
        state.hasTextStarted = false
      }

      if (state.currentToolCallId) {
        yield { type: 'tool-input-end', id: state.currentToolCallId }

        try {
          yield {
            type: 'tool-call',
            toolCallId: state.currentToolCallId,
            toolName: state.currentToolName,
            input: state.accumulatedToolInput
          }
        } catch (e) {
          console.error('Failed to yield Jamba tool call:', e)
        }

        state.accumulatedToolInput = ''
        state.currentToolCallId = ''
      }

      const finishReason = choice.finish_reason === 'stop' ? 'stop'
        : choice.finish_reason === 'length' ? 'length'
          : choice.finish_reason === 'tool_calls' ? 'tool-calls' : 'stop'

      yield {
        type: 'finish',
        finishReason,
        usage: {
          inputTokens: chunk.usage?.prompt_tokens || 0,
          outputTokens: chunk.usage?.completion_tokens || 0,
          totalTokens: chunk.usage?.total_tokens || 0
        }
      }
      state.hasEmittedFinish = true
    }
  }
}

/**
 * Process Mistral streaming events
 */
async function* processMistralStream(
  stream: any,
  state: any
): AsyncGenerator<LanguageModelV2StreamPart> {
  for await (const event of stream) {
    if (!event.chunk) continue

    try {
      const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes))

      const textDelta = chunk.outputs?.[0]?.text || ''

      if (textDelta) {
        if (!state.hasTextStarted) {
          yield { type: 'text-start', id: state.currentTextId }
          state.hasTextStarted = true
        }
        yield { type: 'text-delta', id: state.currentTextId, delta: textDelta }
      }

      if (chunk.stop_reason) {
        if (!state.hasEmittedFinish) {
          yield {
            type: 'finish',
            finishReason: chunk.stop_reason === 'stop' ? 'stop' : 'length',
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0
            }
          }
          state.hasEmittedFinish = true
        }
      }
    } catch (error) {
      console.error('Error parsing Mistral stream chunk:', error)
    }
  }

  if (!state.hasEmittedFinish) {
    yield {
      type: 'finish',
      finishReason: 'stop',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      }
    }
  }
}

/**
 * Generic stream processor for unknown model types
 */
async function* processGenericStream(
  stream: any,
  state: any
): AsyncGenerator<LanguageModelV2StreamPart> {
  for await (const event of stream) {
    if (!event.chunk) continue

    const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes))
    const textDelta = chunk.outputText || chunk.text || chunk.generation || ''

    if (textDelta) {
      if (!state.hasTextStarted) {
        yield { type: 'text-start', id: state.currentTextId }
        state.hasTextStarted = true
      }
      yield { type: 'text-delta', id: state.currentTextId, delta: textDelta }
    }
  }
}
