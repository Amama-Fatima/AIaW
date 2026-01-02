import { StandardResponse } from '../types'

export function convertMistralResponse(responseBody: any): Partial<StandardResponse> {
  const generatedText = responseBody.outputs?.[0]?.text || ''

  const toolCallMatch = generatedText.match(/\[TOOL_CALL\]\s*(\{.*?\})/s)

  let content: any[]
  if (toolCallMatch) {
    try {
      const toolCall = JSON.parse(toolCallMatch[1])
      content = [{
        type: 'tool-call' as const,
        toolCallId: `call_${Date.now()}`,
        toolName: toolCall.name,
        args: toolCall.arguments
      }]
    } catch {
      content = [{ type: 'text' as const, text: generatedText }]
    }
  } else {
    content = [{ type: 'text' as const, text: generatedText }]
  }

  return {
    content,
    finishReason: responseBody.stop_reason || 'stop',
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    }
  }
}
