import { StandardResponse } from '../types'

export function convertJambaResponse(responseBody: any): Partial<StandardResponse> {
  const choice = responseBody.choices?.[0]
  const message = choice?.message

  const content: any[] = []

  if (message?.content) {
    content.push({ type: 'text' as const, text: message.content })
  }

  if (message?.tool_calls) {
    message.tool_calls.forEach((call: any) => {
      content.push({
        type: 'tool-call' as const,
        toolCallId: call.id,
        toolName: call.function.name,
        args: typeof call.function.arguments === 'string'
          ? JSON.parse(call.function.arguments)
          : call.function.arguments
      })
    })
  }

  const finishReason = choice?.finish_reason === 'stop' ? 'stop'
    : choice?.finish_reason === 'length' ? 'length'
      : choice?.finish_reason === 'tool_calls' ? 'tool-calls' : 'stop'

  return {
    content,
    finishReason,
    usage: {
      inputTokens: responseBody.usage?.prompt_tokens || 0,
      outputTokens: responseBody.usage?.completion_tokens || 0,
      totalTokens: responseBody.usage?.total_tokens || 0
    }
  }
}
