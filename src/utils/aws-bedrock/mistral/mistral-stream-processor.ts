import type { LanguageModelV2StreamPart } from '@ai-sdk/provider'

export async function* processMistralStream(
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
