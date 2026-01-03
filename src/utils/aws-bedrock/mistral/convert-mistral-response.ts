import type { StandardResponse } from '../types'

export function convertMistralResponse(
  responseBody: any,
  toolMapping: { [key: string]: string } = {}
): Partial<StandardResponse> {
  const content: Array<{ type: 'text'; text: string } | { type: 'tool-call'; toolCallId: string; toolName: string; input: any }> = []

  if (responseBody.output && responseBody.output.message) {
    const message = responseBody.output.message

    if (message.content && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block.text) {
          content.push({
            type: 'text',
            text: block.text
          })
        }

        if (block.toolUse) {
          const toolUse = block.toolUse
          const originalToolName = toolMapping[toolUse.name] || toolUse.name

          const inputString = typeof toolUse.input === 'string'
            ? toolUse.input
            : JSON.stringify(toolUse.input)

          content.push({
            type: 'tool-call',
            toolCallId: toolUse.toolUseId,
            toolName: originalToolName,
            input: inputString
          })
        }
      }
    }
  }

  let finishReason: 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' = 'stop'

  if (responseBody.stopReason) {
    if (responseBody.stopReason === 'tool_use') {
      finishReason = 'tool-calls'
    } else if (responseBody.stopReason === 'max_tokens') {
      finishReason = 'length'
    } else if (responseBody.stopReason === 'content_filtered') {
      finishReason = 'content-filter'
    }
  }

  const usage = {
    inputTokens: responseBody.usage?.inputTokens || 0,
    outputTokens: responseBody.usage?.outputTokens || 0,
    totalTokens: responseBody.usage?.totalTokens || 0
  }

  return {
    content,
    finishReason,
    usage
  }
}
