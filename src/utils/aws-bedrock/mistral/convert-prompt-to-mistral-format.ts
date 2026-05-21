import { getMaxOutputTokens } from '../utils'

function simpleHash(value: string): string {
  let hash = 0

  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(31, hash) + value.charCodeAt(i) | 0
  }

  return Math.abs(hash).toString(36)
}

function createSafeToolName(fullName: string, usedNames: Set<string>): string {
  const normalized = fullName
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/-/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'tool'

  const maxNameLength = 64
  const hash = simpleHash(fullName)
  const baseName = normalized.length > maxNameLength
    ? `${normalized.slice(0, maxNameLength - hash.length - 1)}_${hash}`
    : normalized

  let candidate = baseName
  let suffix = 2

  while (usedNames.has(candidate)) {
    const suffixText = `_${suffix++}`
    candidate = `${baseName.slice(0, maxNameLength - suffixText.length)}${suffixText}`
  }

  usedNames.add(candidate)

  return candidate
}

export function convertToMistralFormat(
  prompt: any[],
  settings: any,
  modelId = ''
): {
  body: any;
  toolMapping: { [key: string]: string };
  useConverseApi: boolean
} {
  const useTextToolHistory = modelId.includes('magistral')

  const normalizedPrompt = prompt.map(msg => {
    if (msg.role === 'tool') {
      return { ...msg, role: 'user' }
    }
    return msg
  })

  const mergedPrompt: any[] = []

  for (let i = 0; i < normalizedPrompt.length; i++) {
    const current = normalizedPrompt[i]

    if (i + 1 < normalizedPrompt.length && current.role === 'assistant' && normalizedPrompt[i + 1].role === 'assistant') {
      mergedPrompt.push({
        role: 'assistant',
        content: [...current.content, ...normalizedPrompt[i + 1].content]
      })
      i++
    } else {
      mergedPrompt.push(current)
    }
  }

  const finalPrompt: any[] = []

  for (let i = 0; i < mergedPrompt.length; i++) {
    const current = mergedPrompt[i]

    if (current.role === 'user' && i + 1 < mergedPrompt.length && mergedPrompt[i + 1].role === 'user') {
      const currentHasToolResult = current.content.some((c: any) => c.type === 'tool-result')
      const nextHasText = mergedPrompt[i + 1].content.some((c: any) => c.type === 'text')

      if (currentHasToolResult && nextHasText) {
        finalPrompt.push(current)
        finalPrompt.push({
          role: 'assistant',
          content: [{ type: 'text', text: 'Understood.' }]
        })
        continue
      }
    }

    finalPrompt.push(current)
  }

  const toolNameMapping: { [safeName: string]: string } = {}
  const originalToSafeToolName: { [originalName: string]: string } = {}
  let toolConfig: any

  if (settings.tools && settings.tools.length > 0) {
    const usedToolNames = new Set<string>()
    const tools = settings.tools.map((tool: any) => {
      const safeName = createSafeToolName(tool.name, usedToolNames)

      toolNameMapping[safeName] = tool.name
      originalToSafeToolName[tool.name] = safeName

      const originalSchema = tool.inputSchema || tool.parameters
      const cleanedSchema = cleanMistralSchema(originalSchema)

      return {
        toolSpec: {
          name: safeName,
          description: tool.description || '',
          inputSchema: {
            json: cleanedSchema
          }
        }
      }
    })

    toolConfig = {
      tools,
      toolChoice: { auto: {} }
    }
  }

  const messages = finalPrompt.map((msg: any) => {
    const processedContent = Array.isArray(msg.content)
      ? msg.content.map((c: any) => {
        if (c.type === 'text') {
          return { text: useTextToolHistory ? replaceToolNameAliases(c.text, originalToSafeToolName) : c.text }
        }

        if (c.type === 'tool-call') {
          let inputObject
          try {
            inputObject = typeof c.input === 'string' ? JSON.parse(c.input) : c.input
          } catch (e) {
            inputObject = {}
          }

          return {
            ...(useTextToolHistory
              ? {
                  text: `[TOOL_CALLS]${originalToSafeToolName[c.toolName] || c.toolName}${JSON.stringify(inputObject)}`
                }
              : {
                  toolUse: {
                    toolUseId: c.toolCallId,
                    name: originalToSafeToolName[c.toolName] || c.toolName,
                    input: inputObject
                  }
                })
          }
        }

        if (c.type === 'tool-result') {
          const resultData = c.output?.value || c.result || c.content || c
          const resultText = stringifyToolResult(resultData)

          if (useTextToolHistory) {
            return {
              text: `Tool result for ${originalToSafeToolName[c.toolName] || c.toolName}:\n${resultText}`
            }
          }

          let resultContent

          if (Array.isArray(resultData)) {
            const textContent = resultData
              .filter((item: any) => item.type === 'text')
              .map((item: any) => item.text || item.contentText)
              .join('\n')

            resultContent = textContent ? [{ text: textContent }] : [{ json: resultData }]
          } else if (typeof resultData === 'string') {
            try {
              resultContent = [{ json: JSON.parse(resultData) }]
            } catch {
              resultContent = [{ text: resultData }]
            }
          } else if (resultData && typeof resultData === 'object') {
            resultContent = [{ json: resultData }]
          } else {
            resultContent = [{ text: String(resultData || '') }]
          }

          return {
            toolResult: {
              toolUseId: c.toolCallId,
              content: resultContent
            }
          }
        }

        return c
      })
      : [{ text: typeof msg.content === 'string' ? msg.content : '' }]

    let finalContent = processedContent
    if (msg.role === 'assistant') {
      const hasToolUse = processedContent.some((c: any) => c.toolUse)
      const hasText = processedContent.some((c: any) => c.text)

      if (hasToolUse && hasText) {
        finalContent = processedContent.filter((c: any) => c.toolUse)
      }
    }

    return {
      role: msg.role === 'system' ? 'user' : msg.role,
      content: finalContent
    }
  })

  const body: any = {
    messages,
    inferenceConfig: {
      maxTokens: getMaxOutputTokens(settings, 2048),
      temperature: settings.temperature ?? 0.7,
      topP: settings.topP ?? 0.9
    }
  }

  if (toolConfig) {
    body.toolConfig = toolConfig
  }

  const useConverseApi = true

  return {
    body,
    toolMapping: toolNameMapping,
    useConverseApi
  }
}

function cleanMistralSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  const cleaned: any = {}

  if (schema.type) {
    cleaned.type = schema.type
  }

  if (schema.properties) {
    cleaned.properties = {}
    for (const [key, value] of Object.entries(schema.properties)) {
      cleaned.properties[key] = cleanMistralSchemaProperty(value)
    }
  }

  if (schema.required) {
    cleaned.required = schema.required
  }

  return cleaned
}

function cleanMistralSchemaProperty(prop: any): any {
  if (!prop || typeof prop !== 'object') {
    return prop
  }

  const cleaned: any = {}
  const allowedFields = ['type', 'description', 'enum', 'items', 'properties', 'required']

  for (const field of allowedFields) {
    if (prop[field] !== undefined) {
      if (field === 'items' || field === 'properties') {
        cleaned[field] = cleanMistralSchemaProperty(prop[field])
      } else {
        cleaned[field] = prop[field]
      }
    }
  }

  return cleaned
}

function stringifyToolResult(resultData: any): string {
  if (Array.isArray(resultData)) {
    const textContent = resultData
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text || item.contentText)
      .filter(Boolean)
      .join('\n')

    return textContent || JSON.stringify(resultData)
  }

  if (typeof resultData === 'string') {
    return resultData
  }

  if (resultData && typeof resultData === 'object') {
    return JSON.stringify(resultData)
  }

  return String(resultData || '')
}

function replaceToolNameAliases(text: string, originalToSafeToolName: { [originalName: string]: string }): string {
  let result = text

  for (const [originalName, safeName] of Object.entries(originalToSafeToolName)) {
    if (originalName === safeName) continue

    result = result.split(originalName).join(safeName)
  }

  return result
}
