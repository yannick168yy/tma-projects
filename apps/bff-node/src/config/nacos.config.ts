import { NacosConfigClient } from 'nacos'

export type NacosConnection = {
  serverAddr: string
  namespace: string
  dataId: string
  group: string
}

export function getNacosConnectionFromEnv(): NacosConnection | null {
  const serverAddr = process.env.NACOS_SERVER_ADDR?.trim()
  if (!serverAddr) return null
  return {
    serverAddr,
    namespace: process.env.NACOS_NAMESPACE?.trim() || 'batogo',
    dataId: process.env.NACOS_DATA_ID?.trim() || 'bff-node',
    group: process.env.NACOS_GROUP?.trim() || 'DEFAULT_GROUP',
  }
}

/** Java properties / env file: key=value */
export function parseProperties(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    out[key] = value
  }
  return out
}

export function applyConfigToProcessEnv(config: Record<string, string>): void {
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === '') continue
    process.env[key] = value
  }
}

export async function loadNacosConfig(conn: NacosConnection): Promise<Record<string, string>> {
  const client = new NacosConfigClient({
    serverAddr: conn.serverAddr,
    namespace: conn.namespace,
  })
  const raw = await client.getConfig(conn.dataId, conn.group)
  if (!raw?.trim()) {
    console.warn(`[bff-node] Nacos config empty: ${conn.dataId}@${conn.group} (ns=${conn.namespace})`)
    return {}
  }
  const parsed = parseProperties(raw)
  console.info(
    `[bff-node] Loaded Nacos config ${conn.dataId}@${conn.group} (ns=${conn.namespace}), keys=${Object.keys(parsed).length}`,
  )
  return parsed
}

export async function subscribeNacosConfig(
  conn: NacosConnection,
  onUpdate: (config: Record<string, string>) => void,
): Promise<void> {
  const client = new NacosConfigClient({
    serverAddr: conn.serverAddr,
    namespace: conn.namespace,
  })
  client.subscribe({ dataId: conn.dataId, group: conn.group }, (content: string) => {
    const parsed = parseProperties(content)
    applyConfigToProcessEnv(parsed)
    onUpdate(parsed)
    console.info('[bff-node] Nacos config updated (hot reload applied to process.env)')
  })
}
