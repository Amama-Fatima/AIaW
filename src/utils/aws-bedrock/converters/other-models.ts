export function convertToLlamaFormat(prompt: any[], settings: any): any {
  let formattedPrompt = ''
  const hasTools = settings.tools && settings.tools.length > 0

  if (hasTools) {
    const toolDescriptions = settings.tools.map((tool: any) => {
      return `Tool: ${tool.name}\nDescription: ${tool.description}\nParameters: ${JSON.stringify(tool.parameters)}`
    }).join('\n\n')

    formattedPrompt += `<|start_header_id|>system<|end_header_id|>\n\nYou have access to the following tools:\n\n${toolDescriptions}\n\nTo use a tool, respond with a JSON object in this format:\n{"tool": "tool_name", "parameters": {...}}<|eot_id|>\n`
  }

  formattedPrompt += prompt.map((msg: any) => {
    if (msg.role === 'system') return ''

    if (msg.role === 'tool') {
      const results = msg.content.map((c: any) =>
        `Tool ${c.toolCallId} result: ${typeof c.result === 'string' ? c.result : JSON.stringify(c.result)}`
      ).join('\n')
      return `<|start_header_id|>user<|end_header_id|>\n\n${results}<|eot_id|>`
    }

    const role = msg.role === 'user' ? 'user' : 'assistant'
    const content = Array.isArray(msg.content)
      ? msg.content.map((c: any) => {
        if (c.type === 'text') return c.text
        if (c.type === 'tool-call') {
          return `{"tool": "${c.toolName}", "parameters": ${JSON.stringify(c.args)}}`
        }
        return ''
      }).filter(Boolean).join('\n')
      : typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || ''

    return `<|start_header_id|>${role}<|end_header_id|>\n\n${content}<|eot_id|>`
  }).filter(Boolean).join('\n')

  return {
    prompt: formattedPrompt,
    max_gen_len: settings.maxTokens || 2048,
    temperature: settings.temperature || 0.7,
    top_p: settings.topP || 0.9
  }
}

export function convertToMistralFormat(prompt: any[], settings: any): any {
  let formattedPrompt = ''
  const hasTools = settings.tools && settings.tools.length > 0

  if (hasTools) {
    const toolDescriptions = settings.tools.map((tool: any) => {
      return `[TOOL] ${tool.name}: ${tool.description}\nParameters: ${JSON.stringify(tool.parameters)}`
    }).join('\n')
    formattedPrompt += `[INST] ${toolDescriptions} [/INST]\n`
  }

  formattedPrompt += prompt.map((msg: any) => {
    if (msg.role === 'tool') {
      const results = msg.content.map((c: any) =>
        `[TOOL_RESULT ${c.toolCallId}] ${typeof c.result === 'string' ? c.result : JSON.stringify(c.result)}`
      ).join('\n')
      return `[INST] ${results} [/INST]`
    }

    const content = Array.isArray(msg.content)
      ? msg.content.map((c: any) => {
        if (c.type === 'text') return c.text
        if (c.type === 'tool-call') {
          return `[TOOL_CALL] {"name": "${c.toolName}", "arguments": ${JSON.stringify(c.args)}}`
        }
        return ''
      }).filter(Boolean).join('\n')
      : typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || ''

    return msg.role === 'user' ? `[INST] ${content} [/INST]` : content
  }).join('\n')

  return {
    prompt: formattedPrompt,
    max_tokens: settings.maxTokens || 2048,
    temperature: settings.temperature,
    top_p: settings.topP
  }
}

/**
 * Converts prompt to Amazon Nova format
 */
export function convertToNovaFormat(prompt: any[], settings: any): any {
  const messages = prompt.map((msg: any) => {
    if (msg.role === 'tool') {
      return {
        role: 'user',
        content: msg.content.map((c: any) => ({
          toolResult: {
            toolUseId: c.toolCallId,
            content: [{
              text: typeof c.result === 'string' ? c.result : JSON.stringify(c.result)
            }]
          }
        }))
      }
    }

    return {
      role: msg.role,
      content: Array.isArray(msg.content)
        ? msg.content.map((c: any) => {
          if (c.type === 'text') return { text: c.text }
          if (c.type === 'tool-call') {
            return {
              toolUse: {
                toolUseId: c.toolCallId,
                name: c.toolName,
                input: c.args
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
    }
  })

  const body: any = {
    messages,
    inferenceConfig: {
      max_new_tokens: settings.maxTokens || 2048,
      temperature: settings.temperature,
      top_p: settings.topP
    }
  }

  if (settings.tools && settings.tools.length > 0) {
    body.toolConfig = {
      tools: settings.tools.map((tool: any) => ({
        toolSpec: {
          name: tool.name,
          description: tool.description || '',
          inputSchema: {
            json: tool.parameters
          }
        }
      }))
    }
  }

  return body
}

/**
 * Converts prompt to Cohere Command R/R+ format
 */
export function convertToCohereFormat(prompt: any[], settings: any): any {
  const messages = prompt.map((msg: any) => {
    if (msg.role === 'system') return null

    if (msg.role === 'tool') {
      return {
        role: 'TOOL',
        tool_results: msg.content.map((c: any) => ({
          call: { name: c.toolName || 'unknown', parameters: {} },
          outputs: [{ result: typeof c.result === 'string' ? c.result : JSON.stringify(c.result) }]
        }))
      }
    }

    return {
      role: msg.role === 'user' ? 'USER' : 'CHATBOT',
      message: Array.isArray(msg.content)
        ? msg.content.map((c: any) => {
          if (c.type === 'text') return c.text
          if (c.type === 'tool-call') {
            return `[Tool Call: ${c.toolName}(${JSON.stringify(c.args)})]`
          }
          return ''
        }).filter(Boolean).join('\n')
        : typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || ''
    }
  }).filter(Boolean)

  const body: any = {
    message: messages[messages.length - 1]?.message || '',
    chat_history: messages.slice(0, -1),
    max_tokens: settings.maxTokens || 2048,
    temperature: settings.temperature
  }

  if (settings.topP !== undefined) {
    body.p = Math.min(settings.topP, 0.99)
  } else {
    body.p = 0.99
  }

  if (settings.tools && settings.tools.length > 0) {
    body.tools = settings.tools.map((tool: any) => ({
      name: tool.name,
      description: tool.description || '',
      parameter_definitions: tool.parameters.properties || {}
    }))
  }

  return body
}

export function convertToGenericFormat(prompt: any[], settings: any): any {
  let textPrompt = ''
  const hasTools = settings.tools && settings.tools.length > 0

  if (hasTools) {
    const toolDescriptions = settings.tools.map((tool: any) => {
      return `Tool: ${tool.name}\n${tool.description}\nParameters: ${JSON.stringify(tool.parameters)}`
    }).join('\n\n')
    textPrompt += `Available Tools:\n${toolDescriptions}\n\nTo use a tool, respond with JSON: {"tool": "name", "parameters": {...}}\n\n`
  }

  textPrompt += prompt.map((msg: any) => {
    if (msg.role === 'tool') {
      const results = msg.content.map((c: any) =>
        `Tool Result (${c.toolCallId}): ${typeof c.result === 'string' ? c.result : JSON.stringify(c.result)}`
      ).join('\n')
      return results
    }

    const content = Array.isArray(msg.content)
      ? msg.content.map((c: any) => {
        if (c.type === 'text') return c.text
        if (c.type === 'tool-call') {
          return `Tool Call: ${c.toolName}(${JSON.stringify(c.args)})`
        }
        return ''
      }).filter(Boolean).join('\n')
      : typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || ''

    return `${msg.role}: ${content}`
  }).join('\n\n')

  return {
    prompt: textPrompt,
    max_tokens: settings.maxTokens || 2048,
    temperature: settings.temperature,
    top_p: settings.topP
  }
}
