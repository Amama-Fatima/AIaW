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
        } else if (typeof resultData === 'string') {
          try {
            parsedResult = JSON.parse(resultData)
          } catch {
            parsedResult = resultData
          }
        } else {
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
