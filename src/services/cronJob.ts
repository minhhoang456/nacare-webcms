import ConfigSystem from '@src/config/config'
import Queue, { QueueOptions } from 'bull'

const queueOptions: QueueOptions = {
  redis: {
    db: ConfigSystem.REDIS_CONFIG.db,
    password: ConfigSystem.REDIS_CONFIG.password,
    host: ConfigSystem.REDIS_CONFIG.host,
    port: ConfigSystem.REDIS_CONFIG.port
  },
  prefix: `${process.env.REDIS_PREFIX}bull_queue`,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: true,
    timeout: 120000,
    attempts: 1,
    backoff: {
      type: 'fixed',
      delay: 3000
    }
  },
  settings: {
    stalledInterval: 60000
  }
}
const initCacheQueue = new Queue('init_cache_request', queueOptions)

initCacheQueue.process(async (job) => {
  const { modelName, type } = job.data
  const models: any = await import('@src/services/index')
  let serviceAction: any
  for (const model in models) {
    if (modelName === model) {
      serviceAction = models[modelName]
    }
  }
  if (!serviceAction) {
    return
  }
  switch (type) {
    case 'init-cache': {
      await serviceAction.initCache()
      console.log('🚀 ~ file: initCache.js:21 ~ model', modelName)
      break
    }
    case 'one-minute': {
      await serviceAction.runCronjob1()
      break
    }
    case 'five-minute': {
      await serviceAction.runCronjob5()
      break
    }
    case 'one-hour': {
      await serviceAction.runCronjob1Hour()
      break
    }
    case 'six-hour': {
      await serviceAction.runCronjob6Hour()
      break
    }
    case 'thirty-minute': {
      await serviceAction.runCronjob30Minutes()
      break
    }
    case 'twele-hour': {
      await serviceAction.runCronjob12Hour()
      break
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 2000))
})

initCacheQueue.on('failed', (job, err) => {
  console.error(err)
  console.log(`Failed job ${job.id} and trying to retry number : ${
    job.attemptsMade
  } 
  Data : ${JSON.stringify(job.data)}`)
})
initCacheQueue.on('error', (error) => {
  console.log(error)
})
export const cronJobService = {
  addInitItem: (job: any) => {
    initCacheQueue.add(job)
  }
}
export default cronJobService
