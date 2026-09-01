#!/usr/bin/env node
// 生成 App 线路表签名密钥对（EC P-256）。私钥进服务端 env，公钥进 APK。
// 手动执行，不参与部署：node scripts/gen-app-route-key.mjs
import { generateKeyPairSync } from 'node:crypto'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' })
const spki = publicKey.export({ type: 'spki', format: 'der' })

console.log('=== 服务端 env（bff-node）===')
console.log(`APP_ROUTE_SIGNING_KEY=${Buffer.from(pkcs8).toString('base64')}`)
console.log()
console.log('=== APK build.gradle（两个 flavor 都要，值相同）===')
console.log(`buildConfigField "String", "APP_ROUTE_PUBLIC_KEY", '"${spki.toString('base64')}"'`)
console.log()
console.log('私钥只在服务端保存，泄露等同于可以把任意用户导向任意域名；换密钥必须重新出包。')
