import { StandardResponse } from '../types'

export function convertCohereResponse(responseBody: any): Partial<StandardResponse> {
  const text = responseBody.text || ''
  const toolCalls = responseBody.tool_calls || []

  const content: any[] = []

  if (text) {
    content.push({ type: 'text' as const, text })
  }

  toolCalls.forEach((call: any) => {
    content.push({
      type: 'tool-call' as const,
      toolCallId: call.id || `call_${Date.now()}`,
      toolName: call.name,
      args: call.parameters
    })
  })

  return {
    content,
    finishReason: 'stop',
    usage: {
      inputTokens: responseBody.meta?.tokens?.input_tokens || 0,
      outputTokens: responseBody.meta?.tokens?.output_tokens || 0,
      totalTokens: (responseBody.meta?.tokens?.input_tokens || 0) +
        (responseBody.meta?.tokens?.output_tokens || 0)
    }
  }
}
