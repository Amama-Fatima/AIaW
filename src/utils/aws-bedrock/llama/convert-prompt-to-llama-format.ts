import { getMaxOutputTokens } from '../utils'

function messageContentToText(content: any): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((c: any) => {
        if (c.type === 'text') return c.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  return content?.text || ''
}

function parseToolInput(content: any): any {
  if (content.input !== undefined) {
    return content.input
  }

  if (content.args !== undefined) {
    return content.args
  }

  return {}
}

function getLlamaPromptHints(systemText: string): string[] {
  const hints: string[] = []

  if (systemText.includes('/emotions/nachoneko/')) {
    hints.push(`Emoticon formatting rules:
- When using an emoticon, output an HTML img tag, not a bare path.
- Use this exact format: <img src="/emotions/nachoneko/1.webp" width="100">
- The file extension must be exactly ".webp". Do not write ".webpt".
- Choose one of the listed /emotions/nachoneko/*.webp paths exactly as written.`)
  }

  return hints
}

export function convertToLlamaFormat(prompt: any[], settings: any): any {
  let formattedPrompt = '<|begin_of_text|>'
  const hasTools = settings.tools && settings.tools.length > 0
  const systemPrompts = prompt
    .filter((msg: any) => msg.role === 'system')
    .map((msg: any) => messageContentToText(msg.content))
    .filter(Boolean)
  const systemSections = [...systemPrompts]
  const systemText = systemPrompts.join('\n\n')

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

    systemSections.push(`You are a helpful assistant with access to tools.

CRITICAL INSTRUCTIONS:

1. To call a tool, respond with ONLY this JSON format (nothing else):
{"tool": "tool_name", "parameters": {...}}

2. After receiving tool results, you will see the actual data returned.
3. Read the JSON data carefully and provide a response based on what you see.
4. The tool results are real data - never say "undefined" or "no data returned".

Available tools:

${toolDescriptions}`)
  }

  systemSections.push(...getLlamaPromptHints(systemText))

  if (systemSections.length > 0) {
    formattedPrompt += `<|start_header_id|>system<|end_header_id|>\n\n${systemSections.join('\n\n')}<|eot_id|>`
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
          return `{"tool": "${c.toolName}", "parameters": ${JSON.stringify(parseToolInput(c))}}`
        }
        return ''
      }).filter(Boolean).join('\n')
      : typeof msg.content === 'string' ? msg.content : msg.content[0]?.text || ''

    return `<|start_header_id|>${role}<|end_header_id|>\n\n${content}<|eot_id|>`
  }).filter(Boolean).join('\n')

  formattedPrompt += '\n<|start_header_id|>assistant<|end_header_id|>\n\n'

  return {
    prompt: formattedPrompt,
    max_gen_len: getMaxOutputTokens(settings, 2048),
    temperature: settings.temperature || 0.7,
    top_p: settings.topP || 0.9
  }
}
