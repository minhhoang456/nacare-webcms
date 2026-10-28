import retry from 'retry'

const retryHelper = {
  createRetryOperationPrisma() {
    return retry.operation({
      retries: 5, // Number of retry attempts
      factor: 2, // Exponential backoff factor
      minTimeout: 1000, // Minimum time between retries in milliseconds
      maxTimeout: 5000, // Maximum time between retries in milliseconds
      randomize: true // Randomize the timeouts
    })
  },
  createRetryOperationUpdateLimiter() {
    return retry.operation({
      retries: 5, // Number of retry attempts
      factor: 2, // Exponential backoff factor
      minTimeout: 200, // Minimum time between retries in milliseconds
      maxTimeout: 300 // Maximum time between retries in milliseconds
    })
  }
}

export default retryHelper
