function extractBaseToolName(fullName: string): string {
  const match = fullName.match(/^[a-zA-Z0-9]+-(.+)$/) || fullName.match(/^[a-zA-Z0-9]+_(.+)$/)
  const result = match ? match[1] : fullName

  return result
}

export function convertNovaMessage(msg: any): any {
  if (msg.role === 'tool') {
    return {
      role: 'user',
      content: msg.content.map((c: any) => ({
        toolResult: {
          toolUseId: c.toolCallId,
          content: createNovaToolResultContent(c),
          status: 'success'
        }
      }))
    }
  }

  const processedContent = Array.isArray(msg.content)
    ? msg.content.map(convertNovaContentBlock)
    : [{ text: typeof msg.content === 'string' ? msg.content : '' }]

  return {
    role: msg.role === 'system' ? 'user' : msg.role,
    content: processedContent
  }
}

export function createNovaToolConfig(tools: any[]): { toolConfig?: any; toolMapping: { [safeName: string]: string } } {
  const toolMapping: { [safeName: string]: string } = {}

  if (!tools || tools.length === 0) {
    return { toolMapping }
  }

  return {
    toolMapping,
    toolConfig: {
      tools: tools.map((tool: any) => {
        const baseName = extractBaseToolName(tool.name)
        const safeName = baseName.replace(/-/g, '_')

        if (safeName !== tool.name) {
          toolMapping[safeName] = tool.name
        }

        const originalSchema = tool.inputSchema || tool.parameters
        const cleanedSchema = cleanNovaSchema(originalSchema)

        return {
          toolSpec: {
            name: safeName,
            description: tool.description || '',
            inputSchema: {
              json: cleanedSchema
            }
          }
        }
      }),
      toolChoice: { auto: {} }
    }
  }
}

function convertNovaContentBlock(c: any): any {
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

  if (c.type === 'file' && c.mimeType?.startsWith('image/')) {
    return {
      image: {
        format: c.mimeType.split('/')[1] || 'jpeg',
        source: { bytes: c.data }
      }
    }
  }

  return c
}

/**
 * Nova only supports: type, properties, required at top level
 */
function cleanNovaSchema(schema: any): any {
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
      cleaned.properties[key] = cleanNovaSchemaProperty(value)
    }
  }

  if (schema.required) {
    cleaned.required = schema.required
  }

  return cleaned
}

/**
 * Clean individual property schemas
 */
function cleanNovaSchemaProperty(prop: any): any {
  if (!prop || typeof prop !== 'object') {
    return prop
  }

  const cleaned: any = {}

  const allowedFields = ['type', 'description', 'enum', 'items', 'properties', 'required']

  for (const field of allowedFields) {
    if (prop[field] !== undefined) {
      if (field === 'properties') {
        cleaned.properties = {}
        for (const [key, value] of Object.entries(prop.properties)) {
          cleaned.properties[key] = cleanNovaSchemaProperty(value)
        }
      } else if (field === 'items') {
        cleaned[field] = cleanNovaSchemaProperty(prop[field])
      } else {
        cleaned[field] = prop[field]
      }
    }
  }

  return cleaned
}

function createNovaToolResultContent(toolResult: any): any[] {
  const resultData = extractToolResultData(toolResult)

  if (Array.isArray(resultData)) {
    const textContent = resultData
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text || item.contentText)
      .filter(Boolean)
      .join('\n')

    return textContent ? stringToNovaContent(textContent) : [{ json: resultData }]
  }

  if (typeof resultData === 'string') {
    return stringToNovaContent(resultData)
  }

  if (resultData && typeof resultData === 'object') {
    return [{ json: resultData }]
  }

  return [{ text: String(resultData || '') }]
}

function extractToolResultData(toolResult: any): any {
  if (toolResult.output?.type === 'content' && Array.isArray(toolResult.output.value)) {
    return toolResult.output.value
  }

  return toolResult.result ?? toolResult.content ?? toolResult
}

function stringToNovaContent(text: string): any[] {
  try {
    return [{ json: JSON.parse(text) }]
  } catch {
    return [{ text }]
  }
}
