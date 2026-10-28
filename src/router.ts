import path from 'path'
import { FastifyInstance } from 'fastify'
import generateCurdModel from './adapter/model/router'
import autoload from '@fastify/autoload'
import { ZodError } from 'zod'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler
} from 'fastify-type-provider-zod'
import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUI from '@fastify/swagger-ui'

export default async function router(fastify: FastifyInstance) {
  fastify.register(generateCurdModel, { prefix: '/api' })
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      fastify.log.warn(error)
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        issues: error.issues
      })
    }
    return reply.send(error)
  })
  fastify.register(fastifySwagger, {
    hideUntagged: true,
    openapi: {
      info: {
        title: 'API Documentation',
        description: 'Fastify backend services',
        version: '1.0.0'
      },
      servers: [
        {
          url: 'http://localhost:7878',
          description: 'Local host'
        },
        {
          url: 'https://vds.mediaone.dev',
          description: 'Dev'
        }
      ]
    },
    transform: jsonSchemaTransform
  })

  fastify.register(fastifySwaggerUI, {
    uiHooks: {
      onRequest: fastify.basicAuth
    },
    routePrefix: '/documentation'
  })
  fastify.setValidatorCompiler(validatorCompiler)
  fastify.setSerializerCompiler(serializerCompiler)
  fastify.register(autoload, {
    dir: path.join(__dirname, 'controller'),
    options: { prefix: '/api' }
  })
}
