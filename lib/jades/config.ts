export type JadesConfig = {
  webhookUrl?: string
  webhookSecret?: string
  apiToken?: string
}

export function getJadesConfig(): JadesConfig {
  return {
    webhookUrl: process.env.JADES_WEBHOOK_URL,
    webhookSecret: process.env.JADES_WEBHOOK_SECRET,
    apiToken: process.env.JADES_API_TOKEN,
  }
}

export function isPushConfigured(c: JadesConfig): boolean {
  return Boolean(c.webhookUrl && c.webhookSecret)
}
