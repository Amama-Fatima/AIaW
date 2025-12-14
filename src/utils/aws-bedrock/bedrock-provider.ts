import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand
} from '@aws-sdk/client-bedrock-runtime'
import type { LanguageModelV2, LanguageModelV2CallOptions } from '@ai-sdk/provider'

import { convertPromptToBedrock } from './prompt-converter'
import { convertBedrockResponse } from './response-converter'
import { createBedrockStream } from './stream-processor'
import { convertAsyncGeneratorToReadableStream } from './utils'
import type { BedrockConfig, BedrockModelFactory } from './types'

/**
 * Creates a Bedrock provider with AWS credentials
 *
 * @param config - AWS credentials and region
 * @returns Factory function that creates LanguageModelV2 instances
 * @throws Error if credentials are incomplete
 */
export function createBedrock(config: BedrockConfig): BedrockModelFactory {
  if (!config.accessKeyId || !config.secretAccessKey || !config.region) {
    throw new Error(
      'AWS Bedrock credentials are incomplete. ' +
      'Please check accessKeyId, secretAccessKey, and region.'
    )
  }

  const client = new BedrockRuntimeClient({
    region: config.region.trim(),
    credentials: {
      accessKeyId: config.accessKeyId.trim(),
      secretAccessKey: config.secretAccessKey.trim()
    }
  })

  return (modelId: string): LanguageModelV2 => {
    return {
      specificationVersion: 'v2' as const,
      provider: 'aws-bedrock',
      modelId,
      supportedUrls: {},

      /**
       * Non-streaming generation
       *
       * Makes a single request to Bedrock and returns the complete response
       */
      async doGenerate(options: LanguageModelV2CallOptions) {
        const { prompt, ...settings } = options

        // Convert prompt to Bedrock format
        const body = convertPromptToBedrock(modelId, prompt, settings)

        // Extract and remove tool mapping
        const toolMapping = body._toolMapping || {}
        delete body._toolMapping

        // Send request
        const command = new InvokeModelCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(body)
        })

        try {
          const response = await client.send(command)
          const responseBody = JSON.parse(new TextDecoder().decode(response.body))

          return convertBedrockResponse(modelId, responseBody, body, toolMapping)
        } catch (error) {
          console.error('Bedrock API error:', error)
          throw error
        }
      },

      /**
       * Streaming generation
       *
       * Streams tokens as they are generated, allowing for real-time UI updates
       */
      async doStream(options: LanguageModelV2CallOptions) {
        const { prompt, ...settings } = options

        // Convert prompt to Bedrock format
        const body = convertPromptToBedrock(modelId, prompt, settings)

        // Extract and remove tool mapping
        const toolMapping = body._toolMapping || {}
        delete body._toolMapping

        // Send streaming request
        const command = new InvokeModelWithResponseStreamCommand({
          modelId,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify(body)
        })

        try {
          const response = await client.send(command)

          return {
            stream: convertAsyncGeneratorToReadableStream(
              createBedrockStream(
                modelId,
                response.body,
                toolMapping,
                settings.tools || []
              )
            ),
            rawCall: {
              rawPrompt: body,
              rawSettings: settings
            }
          }
        } catch (error) {
          console.error('Bedrock streaming error:', error)
          throw error
        }
      }
    }
  }
}
