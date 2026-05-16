import { getMaxOutputTokens } from '../utils'

function extractBaseToolName(fullName: string): string {
  const match = fullName.match(/^[a-zA-Z0-9]+-(.+)$/) || fullName.match(/^[a-zA-Z0-9]+_(.+)$/)
  const result = match ? match[1] : fullName
  return result
}

export function convertToMistralFormat(
  prompt: any[],
  settings: any
): {
  body: any;
  toolMapping: { [key: string]: string };
  useConverseApi: boolean
} {
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

  const messages = finalPrompt.map((msg: any) => {
    const processedContent = Array.isArray(msg.content)
      ? msg.content.map((c: any) => {
        if (c.type === 'text') {
          return { text: c.text }
        }

        if (c.type === 'tool-call') {
          let inputObject
          try {
            inputObject = typeof c.input === 'string' ? JSON.parse(c.input) : c.input
          } catch (e) {
            inputObject = {}
          }

          return {
            toolUse: {
              toolUseId: c.toolCallId,
              name: c.toolName,
              input: inputObject
            }
          }
        }

        if (c.type === 'tool-result') {
          let resultContent
          const resultData = c.output?.value || c.result || c.content || c

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
              content: resultContent,
              status: 'success'
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

  let toolConfig: any
  const toolNameMapping: { [safeName: string]: string } = {}

  if (settings.tools && settings.tools.length > 0) {
    const tools = settings.tools.map((tool: any) => {
      const baseName = extractBaseToolName(tool.name)
      const safeName = baseName.replace(/-/g, '_')

      if (safeName !== tool.name) {
        toolNameMapping[safeName] = tool.name
      }

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
