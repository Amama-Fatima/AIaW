import type { LanguageModelV2StreamPart } from '@ai-sdk/provider'

export async function* processJambaStream(
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
