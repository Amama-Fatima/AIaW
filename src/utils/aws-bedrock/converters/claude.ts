import { processMessagesForClaude } from '../message-processing'
import { processToolsForClaude } from '../tool-schema'
import { ConvertedPrompt } from '../types'

/**
 * Converts AI SDK prompt to Claude/Anthropic Bedrock format
 *
 * Claude format structure:
 * {
 *   anthropic_version: 'bedrock-2023-05-31',
 *   max_tokens: number,
 *   messages: [{ role: 'user' | 'assistant', content: [...] }],
 *   system?: string,
 *   temperature?: number,
 *   top_p?: number,
 *   tools?: [{ name, description, input_schema }]
 * }
 *
 * @param prompt - AI SDK message array
 * @param settings - Generation settings (maxTokens, temperature, etc.)
 * @returns Converted prompt with body and tool mapping
 */
export function convertToClaudeFormat(prompt: any[], settings: any): ConvertedPrompt {
  // Process messages through 3-step pipeline
  const messages = processMessagesForClaude(prompt)

  // Extract system message (Claude has dedicated field)
  const systemMessage = prompt.find((msg: any) => msg.role === 'system')

  // Build base request body
  const body: any = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: settings.maxTokens || 4096,
    messages,
    temperature: settings.temperature,
    top_p: settings.topP
  }

  // Add system message if present
  if (systemMessage) {
    body.system = typeof systemMessage.content === 'string'
      ? systemMessage.content
      : systemMessage.content[0]?.text
  }

  // Process and add tools if provided
  let toolMapping = {}
  if (settings.tools && settings.tools.length > 0) {
    const processed = processToolsForClaude(settings.tools)
    body.tools = processed.tools
    toolMapping = processed.toolMapping
  }

  return { body, toolMapping }
}
