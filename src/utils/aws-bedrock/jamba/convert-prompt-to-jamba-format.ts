function extractBaseToolName(fullName: string): string {
  const match = fullName.match(/^[a-zA-Z0-9]+-(.+)$/) || fullName.match(/^[a-zA-Z0-9]+_(.+)$/)
  const result = match ? match[1] : fullName
  return result
}

export function convertToJambaFormat(
  prompt: any[],
  settings: any
): { body: any; toolMapping: { [key: string]: string }; useConverseApi: boolean } {
  const result = convertToJambaConverseFormat(prompt, settings)
  return result
}

function convertToJambaConverseFormat(
  prompt: any[],
  settings: any
): { body: any; toolMapping: { [key: string]: string }; useConverseApi: true } {
  const separatedPrompt = separateToolResultMessages(prompt)

  const splitPrompt = splitTextAndToolCalls(separatedPrompt)
  const mergedPrompt = mergeConsecutiveAssistantMessages(splitPrompt)

  const finalPrompt = insertDummyAssistantMessages(mergedPrompt)

  const messages = finalPrompt.map((msg: any) => {
    if (msg.role === 'tool') {
      const toolContent = msg.content.map((c: any) => {
        let actualResult

        if (c.output && c.output.type === 'content' && Array.isArray(c.output.value)) {
          const firstValue = c.output.value[0]
          if (firstValue && firstValue.type === 'text') {
            actualResult = firstValue.text
          } else {
            actualResult = JSON.stringify(c.output)
          }
        } else if (c.result) {
          actualResult = typeof c.result === 'string' ? c.result : JSON.stringify(c.result)
        } else if (c.content) {
          actualResult = typeof c.content === 'string' ? c.content : JSON.stringify(c.content)
        } else {
          actualResult = JSON.stringify(c)
        }

        let resultContent
        if (typeof actualResult === 'string') {
          try {
            const parsed = JSON.parse(actualResult)
            resultContent = [{ json: parsed }]
          } catch (e) {
            resultContent = [{ text: actualResult }]
          }
        } else {
          resultContent = [{ json: actualResult }]
        }

        return {
          toolResult: {
            toolUseId: c.toolCallId,
            content: resultContent
          }
        }
      })

      return {
        role: 'user',
        content: toolContent
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
          const format = c.mimeType.split('/')[1] || 'jpeg'
          return {
            image: {
              format,
              source: { bytes: c.data }
            }
          }
        }

        return c
      })
      : [{ text: typeof msg.content === 'string' ? msg.content : '' }]

    const role = msg.role === 'system' ? 'user' : msg.role

    return {
      role,
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

      const cleanedSchema = cleanJambaSchema(originalSchema)

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

  const inferenceConfig = {
    maxTokens: settings.maxTokens || 4096,
    temperature: settings.temperature !== undefined ? settings.temperature : 0.7,
    topP: settings.topP !== undefined ? settings.topP : 1.0
  }

  const body: any = {
    messages,
    inferenceConfig
  }

  if (toolConfig) {
    body.toolConfig = toolConfig
  }

  const systemMessages = finalPrompt.filter(msg => msg.role === 'system')
  if (systemMessages.length > 0) {
    body.system = systemMessages.map(msg => {
      const text = typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || ''
      return { text }
    })
  }

  return {
    body,
    toolMapping: toolNameMapping,
    useConverseApi: true
  }
}

function separateToolResultMessages(prompt: any[]): any[] {
  const separated: any[] = []

  for (let i = 0; i < prompt.length; i++) {
    const msg = prompt[i]

    if (msg.role !== 'user') {
      separated.push(msg)
      continue
    }

    const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }]

    const toolResults = content.filter((c: any) => c.type === 'tool-result')
    const nonToolContent = content.filter((c: any) => c.type !== 'tool-result')

    if (toolResults.length === 0) {
      separated.push(msg)
      continue
    }

    if (nonToolContent.length === 0) {
      separated.push(msg)
      continue
    }

    separated.push({
      role: 'user',
      content: toolResults
    })

    separated.push({
      role: 'user',
      content: nonToolContent
    })
  }

  return separated
}

function splitTextAndToolCalls(prompt: any[]): any[] {
  const split: any[] = []

  for (let i = 0; i < prompt.length; i++) {
    const msg = prompt[i]

    if (msg.role !== 'assistant') {
      split.push(msg)
      continue
    }

    const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }]

    const textContent = content.filter((c: any) => c.type === 'text')
    const toolCalls = content.filter((c: any) => c.type === 'tool-call')

    if (textContent.length === 0 || toolCalls.length === 0) {
      split.push(msg)
      continue
    }

    if (textContent.length > 0) {
      split.push({
        role: 'assistant',
        content: textContent
      })
    }

    if (toolCalls.length > 0) {
      split.push({
        role: 'assistant',
        content: toolCalls
      })
    }
  }

  return split
}

function mergeConsecutiveAssistantMessages(prompt: any[]): any[] {
  const merged: any[] = []
  let i = 0

  while (i < prompt.length) {
    const currentMsg = prompt[i]

    if (currentMsg.role !== 'assistant') {
      merged.push(currentMsg)
      i++
      continue
    }

    const assistantMessages = [currentMsg]
    let j = i + 1

    while (j < prompt.length && prompt[j].role === 'assistant') {
      assistantMessages.push(prompt[j])
      j++
    }

    if (assistantMessages.length === 1) {
      merged.push(currentMsg)
    } else {
      const hasToolCalls = assistantMessages.some(msg => {
        const content = Array.isArray(msg.content) ? msg.content : []
        return content.some((c: any) => c.type === 'tool-call')
      })

      if (hasToolCalls) {
        const lastWithTools = assistantMessages.reverse().find(msg => {
          const content = Array.isArray(msg.content) ? msg.content : []
          return content.some((c: any) => c.type === 'tool-call')
        })
        if (lastWithTools) {
          merged.push(lastWithTools)
        } else {
          merged.push(assistantMessages[0])
        }
      } else {
        const mergedContent: any[] = []
        for (const msg of assistantMessages) {
          const content = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }]
          mergedContent.push(...content)
        }

        merged.push({
          role: 'assistant',
          content: mergedContent
        })
      }
    }

    i = j
  }

  return merged
}

function insertDummyAssistantMessages(prompt: any[]): any[] {
  const result: any[] = []

  for (let i = 0; i < prompt.length; i++) {
    const current = prompt[i]
    result.push(current)

    if (i + 1 < prompt.length) {
      const next = prompt[i + 1]

      if (current.role === 'tool' && next.role === 'user') {
        const nextContent = Array.isArray(next.content) ? next.content : []
        const nextHasText = nextContent.some((c: any) => c.type === 'text')

        if (nextHasText) {
          result.push({
            role: 'assistant',
            content: [{ type: 'text', text: 'Acknowledged.' }]
          })
        }
      }
    }
  }

  return result
}

function cleanJambaSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return schema
  }

  const cleaned: any = {}

  const allowedTopLevel = ['type', 'description', 'properties', 'required', 'enum']

  for (const field of allowedTopLevel) {
    if (schema[field] !== undefined) {
      if (field === 'properties') {
        cleaned.properties = {}
        for (const [key, value] of Object.entries(schema.properties)) {
          cleaned.properties[key] = cleanJambaSchemaProperty(value)
        }
      } else {
        cleaned[field] = schema[field]
      }
    }
  }

  return cleaned
}

function cleanJambaSchemaProperty(prop: any): any {
  if (!prop || typeof prop !== 'object') {
    return prop
  }

  const cleaned: any = {}
  const allowedFields = ['type', 'description', 'enum', 'items', 'properties', 'required']

  for (const field of allowedFields) {
    if (prop[field] !== undefined) {
      if (field === 'items') {
        cleaned[field] = cleanJambaSchemaProperty(prop[field])
      } else if (field === 'properties') {
        cleaned[field] = {}
        for (const [key, value] of Object.entries(prop[field])) {
          cleaned[field][key] = cleanJambaSchemaProperty(value)
        }
      } else {
        cleaned[field] = prop[field]
      }
    }
  }

  return cleaned
}
