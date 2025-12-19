/* eslint-disable brace-style */
export function convertToLlamaFormat(prompt: any[], settings: any): any {
  let formattedPrompt = ''
  const hasTools = settings.tools && settings.tools.length > 0

  if (hasTools) {
    const toolDescriptions = settings.tools.map((tool: any) => {
      let paramsStr = '{}'
      if (tool.parameters) {
        if (typeof tool.parameters === 'object') {
          paramsStr = JSON.stringify(tool.parameters, null, 2)
        } else {
          paramsStr = String(tool.parameters)
        }
      }

      return `### ${tool.name}
${tool.description}

Parameters: ${paramsStr}`
    }).join('\n\n')

    formattedPrompt += `<|start_header_id|>system<|end_header_id|>\n\nYou are a helpful assistant with access to tools.

CRITICAL INSTRUCTIONS:

1. To call a tool, respond with ONLY this JSON format (nothing else):
{"tool": "tool_name", "parameters": {...}}

2. After receiving tool results, you will see the actual data returned.
3. Read the JSON data carefully and provide a response based on what you see.
4. The tool results are real data - never say "undefined" or "no data returned".

Available tools:

${toolDescriptions}<|eot_id|>
`
  }

  formattedPrompt += prompt.map((msg: any) => {
    if (msg.role === 'system') return ''

    if (msg.role === 'tool') {
      const results = msg.content.map((c: any) => {
        let parsedResult = null

        const resultData = c.output?.value || c.result

        if (!resultData) {
          console.warn('No result data found in tool response:', c)
          return `TOOL RESULT from "${c.toolName || 'unknown'}": No data returned`
        }

        if (Array.isArray(resultData)) {
          for (const item of resultData) {
            if (item.type === 'text') {
              const text = item.text || item.contentText

              if (text) {
                try {
                  parsedResult = JSON.parse(text)
                  break
                } catch {
                  parsedResult = text
                  break
                }
              }
            }
          }

          if (!parsedResult) {
            parsedResult = resultData
          }
        }
        else if (typeof resultData === 'string') {
          try {
            parsedResult = JSON.parse(resultData)
          } catch {
            parsedResult = resultData
          }
        }
        else {
          parsedResult = resultData
        }

        const toolName = c.toolName || 'unknown'
        const resultStr = typeof parsedResult === 'string'
          ? parsedResult
          : JSON.stringify(parsedResult, null, 2)

        return `TOOL RESULT from "${toolName}":

${resultStr}

Analyze this data and respond to the user based on what it says.`
      }).join('\n\n')

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

  formattedPrompt += '\n<|start_header_id|>assistant<|end_header_id|>\n\n'

  return {
    prompt: formattedPrompt,
    max_gen_len: settings.maxTokens || 2048,
    temperature: settings.temperature || 0.7,
    top_p: settings.topP || 0.9
  }
}

export function convertToLlamaFormatWithIPython(prompt: any[], settings: any): any {
  let formattedPrompt = '<|begin_of_text|>'
  const hasTools = settings.tools && settings.tools.length > 0

  // Add system message with environment
  if (hasTools) {
    formattedPrompt += `<|start_header_id|>system<|end_header_id|>

    Environment: ipython
    Tools: python
    Cutting Knowledge Date: December 2023
    Today Date: ${new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' })}

    You have access to the following tools:
    ${settings.tools.map((tool: any) =>
      `- ${tool.name}: ${tool.description}`
    ).join('\n')}

        When you need to call a tool, use this format:
    ${settings.tools.map((tool: any) =>
      `    <|python_tag|>tool_call(tool_name="${tool.name}", parameters=${JSON.stringify(tool.parameters)})<|eom_id|>`
    ).join('\n')}

    After receiving tool results, analyze them and provide a helpful response.<|eot_id|>
    `
  }

  formattedPrompt += prompt.map((msg: any) => {
    if (msg.role === 'system') return ''

    if (msg.role === 'tool') {
      // Format tool results as ipython output
      const results = msg.content.map((c: any) => {
        let resultText = ''

        if (Array.isArray(c.result)) {
          const textItems = c.result.filter((item: any) => item.type === 'text')
          if (textItems.length > 0) {
            resultText = textItems[0].contentText || textItems[0].text || ''
          }
        } else if (typeof c.result === 'string') {
          resultText = c.result
        } else {
          resultText = JSON.stringify(c.result)
        }

        return resultText
      }).join('\n')

      return `<|start_header_id|>ipython<|end_header_id|>

${results}<|eot_id|>`
    }

    const role = msg.role === 'user' ? 'user' : 'assistant'
    const content = Array.isArray(msg.content)
      ? msg.content.map((c: any) => {
        if (c.type === 'text') return c.text
        if (c.type === 'tool-call') {
          // Format as python-style tool call
          return `<|python_tag|>${c.toolName}(${JSON.stringify(c.args)})<|eom_id|>`
        }
        return ''
      }).filter(Boolean).join('\n')
      : typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || ''

    return `<|start_header_id|>${role}<|end_header_id|>

${content}<|eot_id|>`
  }).filter(Boolean).join('\n')

  formattedPrompt += '\n<|start_header_id|>assistant<|end_header_id|>\n\n'

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

export function convertToJambaFormat(prompt: any[], settings: any): any {
  const messages = prompt.map((msg: any) => {
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        content: msg.content.map((c: any) => ({
          type: 'tool_result',
          tool_use_id: c.toolCallId,
          content: typeof c.result === 'string' ? c.result : JSON.stringify(c.result)
        }))
      }
    }

    return {
      role: msg.role,
      content: Array.isArray(msg.content)
        ? msg.content.map((c: any) => {
          if (c.type === 'text') return c.text
          if (c.type === 'tool-call') {
            return JSON.stringify({
              type: 'tool_use',
              id: c.toolCallId,
              name: c.toolName,
              input: c.args
            })
          }
          return ''
        }).filter(Boolean).join('\n')
        : typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || ''
    }
  })

  const body: any = {
    messages,
    max_tokens: settings.maxTokens || 2048
  }

  // Add optional parameters only if they're provided
  if (settings.temperature !== undefined) {
    body.temperature = settings.temperature
  }
  if (settings.topP !== undefined) {
    body.top_p = settings.topP
  }

  if (settings.tools && settings.tools.length > 0) {
    body.tools = settings.tools.map((tool: any) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.parameters
      }
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
