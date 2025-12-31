/**
 * Extracts base tool name by removing MCP namespace prefix
 */
function extractBaseToolName(fullName: string): string {
  const match = fullName.match(/^[a-zA-Z0-9]+-(.+)$/) || fullName.match(/^[a-zA-Z0-9]+_(.+)$/)
  const result = match ? match[1] : fullName

  return result
}

/**
 * Converts prompt to Amazon Nova Converse API format
 */
export function convertToNovaFormat(prompt: any[], settings: any): { body: any; toolMapping: { [key: string]: string }; useConverseApi: boolean } {
  const messages = prompt.map((msg: any) => {
    if (msg.role === 'tool') {
      return {
        role: 'user',
        content: msg.content.map((c: any) => {
          let resultContent
          const resultData = c.result || c.content || c
          if (typeof resultData === 'string') {
            try {
              const parsed = JSON.parse(resultData)
              resultContent = [{ json: parsed }]
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
        })
      }
    }

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
      })
      : [{ text: typeof msg.content === 'string' ? msg.content : '' }]

    return {
      role: msg.role === 'system' ? 'user' : msg.role,
      content: processedContent
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
    })

    toolConfig = {
      tools,
      toolChoice: { auto: {} }
    }
  }

  const body: any = {
    messages,
    inferenceConfig: {
      maxTokens: settings.maxTokens || 2048,
      temperature: 0,
      topP: settings.topP
    }
  }

  if (toolConfig) {
    body.toolConfig = toolConfig
  }

  const hasTools = settings.tools && settings.tools.length > 0
  const useConverseApi = hasTools

  const result = {
    body,
    toolMapping: toolNameMapping,
    useConverseApi
  }

  return result
}

/**
 * Clean JSON schema to only include fields supported by Nova
 * Nova only supports: type, properties, required at top level
 */
function cleanNovaSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  const cleaned: any = {}

  // Only include supported fields
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

  // Allowed fields for properties
  const allowedFields = ['type', 'description', 'enum', 'items', 'properties', 'required']

  for (const field of allowedFields) {
    if (prop[field] !== undefined) {
      if (field === 'items' || field === 'properties') {
        cleaned[field] = cleanNovaSchemaProperty(prop[field])
      } else {
        cleaned[field] = prop[field]
      }
    }
  }

  return cleaned
}
