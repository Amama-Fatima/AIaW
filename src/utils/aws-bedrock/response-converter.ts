import type {
  LanguageModelV2CallWarning,
  LanguageModelV2FinishReason
} from '@ai-sdk/provider'
import { mapClaudeStopReason } from './utils'
import type { ToolNameMapping } from './types'

interface StandardResponse {
  content: any[]
  finishReason: LanguageModelV2FinishReason
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  request: {
    body: string
  }
  response: {
    id: string
    timestamp: Date
  }
  warnings: LanguageModelV2CallWarning[]
}

function convertClaudeResponse(
  responseBody: any,
  toolMapping: ToolNameMapping
): Partial<StandardResponse> {
  const content = responseBody.content?.map((item: any) => {
    if (item.type === 'text') {
      return { type: 'text' as const, text: item.text }
    }

    if (item.type === 'tool_use') {
      // Restore full tool name using mapping
      const baseToolName = item.name
      const fullToolName = toolMapping[baseToolName] || baseToolName

      return {
        type: 'tool-call' as const,
        toolCallId: item.id,
        toolName: fullToolName,
        args: item.input
      }
    }

    return item
  }) || []

  const finishReason = mapClaudeStopReason(responseBody.stop_reason)
  const inputTokens = responseBody.usage?.input_tokens || 0
  const outputTokens = responseBody.usage?.output_tokens || 0

  return {
    content,
    finishReason,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    }
  }
}

export function convertLlamaResponse(responseBody: any): any {
  let generatedText = responseBody.generation || ''

  // Clean up the response
  generatedText = generatedText
    .replace(/<\|start_header_id\|>.*?<\|end_header_id\|>\s*/gs, '')
    .replace(/.*<\|end_header_id\|>\s*/g, '')
    .replace(/<\|eot_id\|>/g, '')
    .trim()

  let toolCallMatch = null

  toolCallMatch = generatedText.match(/\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"parameters"\s*:\s*(\{[^}]*\}|\{.*?\})\s*\}/s)

  if (!toolCallMatch) {
    toolCallMatch = generatedText.match(/\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{[^}]*\}|\{.*?\})\s*\}/s)
  }

  if (!toolCallMatch) {
    const jsonMatch = generatedText.match(/\{[^}]*"tool"[^}]*\}/s)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0])
        if (parsed.tool) {
          toolCallMatch = [
            jsonMatch[0],
            parsed.tool,
            JSON.stringify(parsed.parameters || parsed.args || {})
          ]
        }
      } catch (e) {
        console.error('Failed to parse potential tool call JSON:', e)
      }
    }
  }

  if (!toolCallMatch) {
    const multiLineMatch = generatedText.match(/\{\s*"tool"\s*:\s*"([^"]+)"[\s\S]*?"parameters"\s*:\s*(\{[\s\S]*?\})\s*\}/m)
    if (multiLineMatch) {
      toolCallMatch = multiLineMatch
    }
  }

  let content: any[]
  if (toolCallMatch) {
    const toolName = toolCallMatch[1]
    let toolParams
    try {
      toolParams = JSON.parse(toolCallMatch[2])
    } catch (e) {
      console.error('Failed to parse tool parameters:', toolCallMatch[2])
      toolParams = {}
    }

    content = [{
      type: 'tool-call' as const,
      toolCallId: `call_${Date.now()}`,
      toolName,
      args: toolParams
    }]
  } else {
    content = [{ type: 'text' as const, text: generatedText }]
  }

  const finishReason = responseBody.stop_reason === 'stop' ? 'stop' : 'length'
  const inputTokens = responseBody.prompt_token_count || 0
  const outputTokens = responseBody.generation_token_count || 0

  return {
    content,
    finishReason,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    }
  }
}

function convertMistralResponse(responseBody: any): Partial<StandardResponse> {
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

function convertNovaResponse(responseBody: any): Partial<StandardResponse> {
  const output = responseBody.output?.message

  const content = output?.content?.map((item: any, idx: number) => {
    console.log(`\n📝 Processing content item ${idx}:`, Object.keys(item))

    if (item.text) {
      return { type: 'text' as const, text: item.text }
    }

    if (item.toolUse) {
      // Ensure input is stringified JSON
      const inputString = typeof item.toolUse.input === 'string'
        ? item.toolUse.input
        : JSON.stringify(item.toolUse.input)

      const toolCall = {
        type: 'tool-call' as const,
        toolCallId: item.toolUse.toolUseId,
        toolName: item.toolUse.name,
        input: inputString
      }

      return toolCall
    }

    return null
  }).filter(Boolean) || []

  console.log(`\n📊 Total content items: ${content.length}`)
  content.forEach((c, i) => {
    console.log(`  ${i}: ${c.type}`)
  })

  const inputTokens = responseBody.usage?.inputTokens || 0
  const outputTokens = responseBody.usage?.outputTokens || 0

  // Check stop reason
  const stopReason = output?.stopReason

  let finishReason: 'stop' | 'length' | 'tool-calls' | 'content-filter' = 'stop'

  if (stopReason === 'tool_use') {
    finishReason = 'tool-calls'
  } else if (stopReason === 'max_tokens') {
    finishReason = 'length'
  } else if (stopReason === 'end_turn') {
    finishReason = 'stop'
  } else {
    console.log('  ⚠️ Unknown stop reason, defaulting to: stop')
  }

  const result = {
    content,
    finishReason,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens
    }
  }

  return result
}

function convertCohereResponse(responseBody: any): Partial<StandardResponse> {
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

function convertJambaResponse(responseBody: any): Partial<StandardResponse> {
  const choice = responseBody.choices?.[0]
  const message = choice?.message

  const content: any[] = []

  if (message?.content) {
    content.push({ type: 'text' as const, text: message.content })
  }

  // Handle tool calls if present
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

/**
 * Converts generic model response to AI SDK format
 */
function convertGenericResponse(responseBody: any): Partial<StandardResponse> {
  const text = responseBody.completions?.[0]?.data?.text ||
    responseBody.generation || ''

  const toolCallMatch = text.match(/\{"tool":\s*"([^"]+)",\s*"parameters":\s*(\{.*?\})\}/s)

  let content: any[]
  if (toolCallMatch) {
    content = [{
      type: 'tool-call' as const,
      toolCallId: `call_${Date.now()}`,
      toolName: toolCallMatch[1],
      args: JSON.parse(toolCallMatch[2])
    }]
  } else {
    content = [{ type: 'text' as const, text }]
  }

  return {
    content,
    finishReason: 'stop',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  }
}

/**
 * Main response converter - routes to model-specific converter
 *
 * @param modelId - Bedrock model identifier
 * @param responseBody - Raw response from Bedrock API
 * @param requestBody - Original request body
 * @param toolMapping - Tool name mapping (for Claude)
 * @returns Standardized AI SDK response
 */
export function convertBedrockResponse(
  modelId: string,
  responseBody: any,
  requestBody: any,
  toolMapping: ToolNameMapping = {}
): StandardResponse {
  let partial: Partial<StandardResponse>

  if (modelId.startsWith('anthropic.')) {
    partial = convertClaudeResponse(responseBody, toolMapping)
  } else if (modelId.startsWith('meta.llama') || modelId.startsWith('us.meta.llama')) {
    partial = convertLlamaResponse(responseBody)
  } else if (modelId.startsWith('mistral.') || modelId.startsWith('us.mistral.')) {
    partial = convertMistralResponse(responseBody)
  } else if (modelId.startsWith('amazon.nova')) {
    partial = convertNovaResponse(responseBody)
  } else if (modelId.startsWith('cohere.')) {
    partial = convertCohereResponse(responseBody)
  } else if (modelId.startsWith('ai21.')) {
    partial = convertJambaResponse(responseBody)
  } else {
    partial = convertGenericResponse(responseBody)
  }

  return {
    content: partial.content || [],
    finishReason: partial.finishReason || 'stop',
    usage: partial.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    request: {
      body: JSON.stringify(requestBody)
    },
    response: {
      id: responseBody.id || `res_${Date.now()}`,
      timestamp: new Date()
    },
    warnings: []
  }
}
